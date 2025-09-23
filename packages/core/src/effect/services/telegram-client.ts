import { Effect, Context, Layer } from "effect";
import { Bot } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { TelegramClientError } from "../errors";
import { UserConfigStorage } from "./user-config-storage";
import { AIAgentFactory } from "./ai-agent";
import { MessageHistory } from "./message-history";
import { IntegrationRegistry } from "./integration-registry";
import { JournalRepository } from "./journal-repository";
import { TaskRepository } from "./task-repository";
import { ToolProgressReporter } from "../core/tool-progress";
import type { BotConfig, UpdateContext } from "../types";
import type {
  ToolFormatterResult,
  ToolResultFormatter,
} from "../types/integrations";

interface AggregatedToolResponse {
  readonly text: string;
  readonly parseMode?: "Markdown" | "HTML";
  readonly replyMarkup?: InlineKeyboardMarkup;
  readonly metadata?: Record<string, unknown>;
}

// Helper function to generate response from tool results
const generateResponseFromToolResults = (
  toolResults: any[],
  formatters: Record<string, ToolResultFormatter>
) =>
  Effect.gen(function* () {
    if (!toolResults || toolResults.length === 0) {
      return {
        text: "❌ Извините, не удалось получить результаты.",
      } satisfies AggregatedToolResponse;
    }

    const responses: ToolFormatterResult[] = [];

    for (const toolResult of toolResults) {
      const formatter = formatters[toolResult.toolName];

      if (formatter) {
        const formatted = yield* formatter(toolResult.output);
        responses.push(formatted);
      } else if (toolResult.output && typeof toolResult.output === "object") {
        responses.push({
          text: `🛠️ ${toolResult.toolName}: ${JSON.stringify(
            toolResult.output,
            null,
            2
          )}`,
        });
      } else {
        responses.push({
          text: `🛠️ ${toolResult.toolName}: ${String(toolResult.output)}`,
        });
      }
    }

    const text = responses
      .map((response) => response.text?.trim())
      .filter((value): value is string => Boolean(value && value.length > 0))
      .join("\n\n")
      .trim();

    const parseMode = responses.find(
      (response) => response.parseMode
    )?.parseMode;
    const replyMarkup = responses.find(
      (response) => response.replyMarkup
    )?.replyMarkup;

    const metadataEntries = responses
      .map((response) => response.metadata)
      .filter((meta): meta is Record<string, unknown> => Boolean(meta));

    const metadata = metadataEntries.length
      ? metadataEntries.reduce<Record<string, unknown>>(
          (acc, current) => ({ ...acc, ...current }),
          {}
        )
      : undefined;

    return {
      text: text || "❌ Извините, не удалось обработать результаты.",
      parseMode,
      replyMarkup,
      metadata,
    } satisfies AggregatedToolResponse;
  });

// Service interface
export interface TelegramClient {
  readonly start: Effect.Effect<void, TelegramClientError>;
  readonly stop: Effect.Effect<void, TelegramClientError>;
  readonly sendMessage: (
    chatId: number,
    text: string
  ) => Effect.Effect<number, TelegramClientError>;
  readonly handleUpdate: (
    update: UpdateContext
  ) => Effect.Effect<void, TelegramClientError>;
}

// Service tag
export const TelegramClient = Context.GenericTag<TelegramClient>(
  "@services/TelegramClient"
);

// Implementation
const makeTelegramClient = (config: BotConfig) =>
  Effect.gen(function* () {
    const userConfigStorage = yield* UserConfigStorage;
    const aiAgentFactory = yield* AIAgentFactory;
    const messageHistory = yield* MessageHistory;
    const integrationRegistry = yield* IntegrationRegistry;
    const journalRepository = yield* JournalRepository;
    const taskRepository = yield* TaskRepository;

    // Create bot instance directly
    const bot = new Bot(config.telegramToken);

    // Setup basic handlers
    const setupHandlers = () => {
      bot.command("start", async (ctx) => {
        await ctx.reply(
          "🤖 Привет! Я AI-ассистент на Effect Framework.\n\n" +
            "Это минимальная версия бота для первой итерации миграции.\n" +
            "Просто напишите мне сообщение!"
        );
      });

      bot.command("clear", async (ctx) => {
        await ctx.reply("🗑️ История очищена!");
        console.log(`🗑️ Очистка истории для чата ${ctx.chat.id}`);
      });

      bot.command("integrations", async (ctx) => {
        const chatId = ctx.chat.id;
        const userId = ctx.from?.id || chatId;

        console.log(`📊 Запрос интеграций для пользователя ${userId}`);

        try {
          // Get user integrations using Effect Cache
          const effect = userConfigStorage.get(userId).pipe(
            Effect.map((config) => {
              if (config.integrations.length === 0) {
                return "📊 **Интеграции:**\n\nУ вас пока нет настроенных интеграций.";
              }

              const integrationsText = config.integrations
                .map((integration) => {
                  const status = integration.enabled ? "✅" : "❌";
                  return `${status} **${integration.name}**`;
                })
                .join("\n");

              return `📊 **Интеграции:**\n\n${integrationsText}`;
            }),
            Effect.catchAll((error) => {
              console.error("Ошибка при получении интеграций:", error);
              if (
                error._tag === "UserConfigError" &&
                error.message.includes("not found")
              ) {
                return Effect.succeed(
                  "📊 **Интеграции:**\n\nПользователь не найден. Используйте /start для инициализации."
                );
              }
              return Effect.succeed(
                "❌ Ошибка при получении списка интеграций."
              );
            })
          );

          // Run the effect and get result
          const result = await Effect.runPromise(effect);

          await ctx.reply(result, { parse_mode: "Markdown" });
        } catch (error) {
          console.error("Ошибка в команде /integrations:", error);
          await ctx.reply("❌ Произошла ошибка при получении интеграций.");
        }
      });

      bot.on("callback_query:data", async (ctx) => {
        const data = ctx.callbackQuery.data || "";

        if (!data.startsWith("journal:")) {
          await ctx.answerCallbackQuery();
          return;
        }

        if (data.startsWith("journal:delete:")) {
          const [, , entryIdRaw] = data.split(":");
          if (!entryIdRaw) {
            await ctx.answerCallbackQuery({
              text: "❌ Не удалось удалить запись",
              show_alert: true,
            });
            return;
          }
          const entryId = Number.parseInt(entryIdRaw, 10);
          const userId = ctx.from?.id || ctx.chat?.id;

          if (!userId || Number.isNaN(entryId)) {
            await ctx.answerCallbackQuery({
              text: "❌ Не удалось удалить запись",
              show_alert: true,
            });
            return;
          }

          try {
            const deleted = await Effect.runPromise(
              journalRepository.deleteEntry(entryId, userId)
            );

            if (deleted) {
              await ctx.answerCallbackQuery({ text: "🗑 Запись удалена" });
              try {
                await ctx.editMessageText("Запись не сохранена");
              } catch (error) {
                console.error(
                  "Не удалось обновить сообщение после удаления:",
                  error
                );
              }
            } else {
              await ctx.answerCallbackQuery({
                text: "⚠️ Запись уже удалена",
                show_alert: false,
              });
            }
          } catch (error) {
            console.error("Ошибка при удалении записи дневника:", error);
            await ctx.answerCallbackQuery({
              text: "❌ Не удалось удалить запись",
              show_alert: true,
            });
          }

          return;
        }

        if (data.startsWith("journal:createTask:")) {
          // Format: journal:createTask:<entryId>:<encodedTitle>
          const parts = data.split(":");
          const encodedTitle = parts[3] || "";
          const title = decodeURIComponent(encodedTitle);
          const userId = ctx.from?.id || ctx.chat?.id;

          if (!userId || !title) {
            await ctx.answerCallbackQuery({
              text: "❌ Не удалось создать задачу",
              show_alert: true,
            });
            return;
          }

          try {
            await Effect.runPromise(taskRepository.create({ userId, title }));
            await ctx.answerCallbackQuery({ text: "✅ Задача создана" });
            await ctx.reply(`✅ Создана задача: ${title}`);
          } catch (error) {
            console.error("Ошибка создания задачи из записи:", error);
            await ctx.answerCallbackQuery({
              text: "❌ Ошибка создания задачи",
              show_alert: true,
            });
          }

          return;
        }

        await ctx.answerCallbackQuery();
      });

      // Handle text messages with AI Agent
      bot.on("message:text", async (ctx) => {
        const chatId = ctx.chat.id;
        const userId = ctx.from?.id || chatId;
        const text = ctx.message.text;

        console.log(`📨 Получено сообщение от ${userId}: ${text}`);

        try {
          const progressMessage = await ctx.reply("🤔 Думаю над ответом...");
          const progressMessageId = progressMessage.message_id;

          const editMessageSafe = (
            content: string,
            options?: Parameters<typeof ctx.api.editMessageText>[3]
          ) =>
            Effect.promise(() =>
              ctx.api.editMessageText(
                chatId,
                progressMessageId,
                content,
                options
              )
            ).pipe(
              Effect.catchAll((error: any) =>
                Effect.sync(() => {
                  if (
                    error?.error_code === 400 &&
                    typeof error?.description === "string" &&
                    error.description.includes("message is not modified")
                  ) {
                    return;
                  }
                  console.error(
                    "Не удалось обновить сообщение прогресса:",
                    error
                  );
                })
              )
            );

          const updateProgress = (emoji: string, message: string) =>
            editMessageSafe(`${emoji} ${message}`);

          const finalizeMessage = (response: AggregatedToolResponse) => {
            const options = (
              response.parseMode || response.replyMarkup
                ? {
                    ...(response.parseMode
                      ? { parse_mode: response.parseMode }
                      : {}),
                    ...(response.replyMarkup
                      ? { reply_markup: response.replyMarkup }
                      : {}),
                  }
                : undefined
            ) as Parameters<typeof ctx.api.editMessageText>[3] | undefined;

            const editEffect = options
              ? editMessageSafe(response.text, options)
              : editMessageSafe(response.text);

            return editEffect.pipe(
              Effect.catchAll(() =>
                Effect.promise(() =>
                  ctx.reply(response.text, {
                    parse_mode: response.parseMode,
                    reply_markup: response.replyMarkup,
                  })
                ).pipe(
                  Effect.catchAll((fallbackError) =>
                    Effect.sync(() =>
                      console.error(
                        "Не удалось отправить итоговое сообщение:",
                        fallbackError
                      )
                    )
                  )
                )
              )
            );
          };

          const toolProgressLayer = Layer.succeed(ToolProgressReporter, {
            report: (toolName: string, message: string) =>
              updateProgress(
                "🛠️",
                message && message.trim().length > 0
                  ? message
                  : `Использую инструмент ${toolName}...`
              ),
          });

          // Create AI agent processing effect
          const processEffect = Effect.gen(function* () {
            // Get or create AI agent for user
            const aiAgent = yield* aiAgentFactory.getOrCreateAgent(userId);

            // Get conversation history
            const history = yield* messageHistory.getHistory(chatId);

            // Add user message to history
            yield* messageHistory.addUserMessage(chatId, text);

            yield* updateProgress("🧠", "Готовлю ответ ассистента...");

            // Process message through AI
            const agentResponse = yield* aiAgent.processText(
              userId,
              text,
              history
            );

            const { result, toolFormatters, toolProgressMessages } =
              agentResponse;

            if (result.toolCalls && result.toolCalls.length > 0) {
              for (const call of result.toolCalls) {
                const completionMessage = `Инструмент ${call.toolName} выполнен`;
                yield* updateProgress("✅", completionMessage);
              }
            }

            // Handle different response types from AI SDK v5
            const baseText = result.text?.trim() || "";
            let aggregatedResponse: AggregatedToolResponse | undefined;

            if (result.toolResults && result.toolResults.length > 0) {
              console.log("🔧 Processing tool results to generate response...");
              aggregatedResponse = yield* generateResponseFromToolResults(
                result.toolResults,
                toolFormatters
              );
            }

            const finalText =
              (aggregatedResponse?.text || baseText)?.trim() ||
              "❌ Извините, не удалось сформировать ответ.";

            const finalResponse: AggregatedToolResponse = {
              text: finalText,
              parseMode: aggregatedResponse?.parseMode,
              replyMarkup: aggregatedResponse?.replyMarkup,
              metadata: aggregatedResponse?.metadata,
            };

            console.log("📝 Final response text:", finalText);

            // Add AI response to history
            yield* messageHistory.addAssistantMessage(chatId, finalText);

            yield* finalizeMessage(finalResponse);
          }).pipe(
            Effect.catchAll((error) => {
              console.error("AI processing error:", error);
              const errorMessage =
                "❌ Извините, произошла ошибка при обработке сообщения.";

              return Effect.gen(function* () {
                yield* messageHistory.addAssistantMessage(chatId, errorMessage);
                yield* finalizeMessage(errorMessage, false);
              });
            })
          );

          // Run the effect with proper context including IntegrationRegistry
          await Effect.runPromise(
            processEffect.pipe(
              Effect.provide(
                Layer.mergeAll(
                  Layer.succeed(IntegrationRegistry, integrationRegistry),
                  toolProgressLayer
                )
              )
            )
          );

          console.log(`✅ Отправлен AI ответ для ${userId}`);
        } catch (error) {
          console.error("Ошибка при обработке сообщения:", error);
          await ctx.reply(
            "❌ Произошла ошибка при обработке вашего сообщения."
          );
        }
      });
    };

    setupHandlers();

    const start = Effect.gen(function* () {
      try {
        console.log("🚀 Запуск Telegram клиента...");

        // Set bot commands
        yield* Effect.promise(() =>
          bot.api.setMyCommands([
            { command: "start", description: "🚀 Запустить бота" },
            { command: "clear", description: "🧹 Очистить историю" },
            { command: "integrations", description: "📊 Показать интеграции" },
          ])
        );

        yield* Effect.promise(() => bot.start());
        console.log("✅ Telegram клиент запущен!");
      } catch (cause) {
        return yield* Effect.fail(
          new TelegramClientError({
            message: "Failed to start Telegram client",
            cause,
          })
        );
      }
    });

    const stop = Effect.gen(function* () {
      try {
        console.log("🛑 Остановка Telegram клиента...");
        yield* Effect.promise(() => bot.stop());
        console.log("✅ Telegram клиент остановлен!");
      } catch (cause) {
        return yield* Effect.fail(
          new TelegramClientError({
            message: "Failed to stop Telegram client",
            cause,
          })
        );
      }
    });

    const sendMessage = (
      chatId: number,
      text: string
    ): Effect.Effect<number, TelegramClientError> =>
      Effect.gen(function* () {
        try {
          const result = yield* Effect.promise(() =>
            bot.api.sendMessage(chatId, text)
          );
          return result.message_id;
        } catch (cause) {
          return yield* Effect.fail(
            new TelegramClientError({
              message: `Failed to send message to chat ${chatId}`,
              cause,
            })
          );
        }
      });

    const handleUpdate = (
      update: UpdateContext
    ): Effect.Effect<void, TelegramClientError> =>
      Effect.gen(function* () {
        // Basic update handling - just echo
        const response = `Обработал обновление: ${update.text}`;
        yield* sendMessage(update.chatId, response);
        console.log(`📨 Обработано обновление: ${update.text}`);
      });

    return TelegramClient.of({
      start,
      stop,
      sendMessage,
      handleUpdate,
    });
  });

// Live layer
export const TelegramClientLive = (config: BotConfig) =>
  Layer.effect(TelegramClient, makeTelegramClient(config));
