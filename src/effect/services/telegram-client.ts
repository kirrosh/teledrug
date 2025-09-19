import { Effect, Context, Layer } from "effect";
import { Bot } from "grammy";
import { TelegramClientError } from "../errors";
import { UserConfigStorage } from "./user-config-storage";
import { AIAgentFactory } from "./ai-agent";
import { MessageHistory } from "./message-history";
import { IntegrationRegistry } from "./integration-registry";
import type { BotConfig, UpdateContext } from "../types";
import type { ToolResultFormatter } from "../types/integrations";

// Helper function to generate response from tool results
const generateResponseFromToolResults = (
  toolResults: any[],
  formatters: Record<string, ToolResultFormatter>
) =>
  Effect.gen(function* () {
    if (!toolResults || toolResults.length === 0) {
      return "❌ Извините, не удалось получить результаты.";
    }

    const responses: string[] = [];

    for (const toolResult of toolResults) {
      const formatter = formatters[toolResult.toolName];

      if (formatter) {
        const formatted = yield* formatter(toolResult.output);
        responses.push(formatted);
      } else if (toolResult.output && typeof toolResult.output === "object") {
        responses.push(
          `🛠️ ${toolResult.toolName}: ${JSON.stringify(
            toolResult.output,
            null,
            2
          )}`
        );
      } else {
        responses.push(
          `🛠️ ${toolResult.toolName}: ${String(toolResult.output)}`
        );
      }
    }

    return (
      responses.join("\n\n").trim() ||
      "❌ Извините, не удалось обработать результаты."
    );
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
              ctx.api.editMessageText(chatId, progressMessageId, content, options)
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
                  console.error("Не удалось обновить сообщение прогресса:", error);
                })
              )
            );

          const updateProgress = (emoji: string, message: string) =>
            editMessageSafe(`${emoji} ${message}`);

          const finalizeMessage = (finalText: string, useMarkdown: boolean) => {
            const options = useMarkdown ? { parse_mode: "Markdown" as const } : undefined;

            const editEffect = options
              ? editMessageSafe(finalText, options)
              : editMessageSafe(finalText);

            return editEffect.pipe(
              Effect.catchAll(() =>
                Effect.promise(() =>
                  options ? ctx.reply(finalText, options) : ctx.reply(finalText)
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
                const progressMessageText =
                  toolProgressMessages[call.toolName] ||
                  `Использую инструмент ${call.toolName}...`;
                yield* updateProgress("🛠️", progressMessageText);
              }
            }

            // Handle different response types from AI SDK v5
            let responseText = result.text?.trim() || "";
            let useMarkdown = false;

            // If no direct text but we have tool results, generate response from them
            if (
              !responseText &&
              result.toolResults &&
              result.toolResults.length > 0
            ) {
              console.log("🔧 Processing tool results to generate response...");
              responseText = yield* generateResponseFromToolResults(
                result.toolResults,
                toolFormatters
              );
              useMarkdown = true;
            }

            // Final fallback
            if (!responseText) {
              responseText = "❌ Извините, не удалось сформировать ответ.";
            }

            console.log("📝 Final response text:", responseText);

            // Add AI response to history
            yield* messageHistory.addAssistantMessage(chatId, responseText);

            yield* finalizeMessage(responseText, useMarkdown);
          }).pipe(
            Effect.catchAll((error) => {
              console.error("AI processing error:", error);
              const errorMessage =
                "❌ Извините, произошла ошибка при обработке сообщения.";

              return Effect.gen(function* () {
                yield* messageHistory.addAssistantMessage(
                  chatId,
                  errorMessage
                );
                yield* finalizeMessage(errorMessage, false);
              });
            })
          );

          // Run the effect with proper context including IntegrationRegistry
          await Effect.runPromise(
            processEffect.pipe(
              Effect.provide(
                Layer.succeed(IntegrationRegistry, integrationRegistry)
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
