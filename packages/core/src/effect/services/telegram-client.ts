import { Effect, Context, Layer } from "effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import { experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Headers from "@effect/platform/Headers";
import { NodeHttpClient } from "@effect/platform-node";
import { Bot, InlineKeyboard } from "grammy";
import type { Context as TelegramContext } from "grammy";
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

interface HandleUserMessageOptions {
  readonly interactionType?: "TEXT" | "VOICE";
  readonly progressMessageId?: number;
  readonly initialProgressText?: string;
}

type WebAppUrlIssue = "invalid" | "nonHttps";

const resolveWebAppUrl = (
  value: string | undefined
): { url?: string; issue?: WebAppUrlIssue } => {
  if (!value) {
    return {};
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return {};
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);

    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }

    if (parsed.protocol !== "https:") {
      return { issue: "nonHttps" };
    }

    return { url: parsed.toString() };
  } catch {
    return { issue: "invalid" };
  }
};

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

    const rawWebAppUrl = config.webAppUrl?.trim();
    const { url: resolvedWebAppUrl, issue: webAppUrlIssue } =
      resolveWebAppUrl(rawWebAppUrl);

    const webAppUnavailableWarning =
      rawWebAppUrl && !resolvedWebAppUrl && webAppUrlIssue
        ? webAppUrlIssue === "nonHttps"
          ? "WEBAPP_URL должен использовать протокол https. Пропускаем регистрацию Mini App в меню."
          : "WEBAPP_URL указан, но не является корректным URL. Пропускаем регистрацию Mini App в меню."
        : undefined;

    const webAppUnavailableResponse = (() => {
      if (resolvedWebAppUrl) {
        return undefined;
      }

      if (!rawWebAppUrl) {
        return "Переменная окружения WEBAPP_URL не задана. Укажите HTTPS адрес мини-приложения, чтобы открыть его через команду /app.";
      }

      if (webAppUrlIssue === "nonHttps") {
        return "WEBAPP_URL должен начинаться с https://. Обновите переменную окружения и перезапустите бота.";
      }

      if (webAppUrlIssue === "invalid") {
        return "WEBAPP_URL указан, но имеет неверный формат. Укажите корректный HTTPS адрес мини-приложения и перезапустите бота.";
      }

      return "Мини-приложение сейчас недоступно. Проверьте значение WEBAPP_URL.";
    })();

    const createPreview = (value: string, limit = 200) => {
      const normalized = value.trim();
      if (normalized.length <= limit) {
        return normalized;
      }
      return `${normalized.slice(0, limit)}...`;
    };

    const toError = (cause: unknown, fallback: string) =>
      cause instanceof Error
        ? cause
        : new Error(`${fallback}: ${String(cause)}`);

    const transcribeTelegramAudio = (
      ctx: TelegramContext,
      fileId: string
    ): Effect.Effect<
      {
        readonly text: string;
        readonly language: string | undefined;
        readonly durationInSeconds: number | undefined;
        readonly filePath: string;
        readonly size: number;
        readonly contentType?: string;
      },
      Error,
      HttpClient.HttpClient
    > =>
      Effect.gen(function* () {
        const file = yield* Effect.tryPromise({
          try: () => ctx.api.getFile(fileId),
          catch: (cause) =>
            toError(cause, "Failed to fetch telegram file metadata"),
        });

        if (!file.file_path) {
          return yield* Effect.fail(
            new Error("File path is missing for Telegram file")
          );
        }

        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;

        const response = yield* Effect.mapError(
          HttpClient.get(fileUrl),
          (cause) => toError(cause, "Failed to download telegram file")
        );

        const okResponse = yield* Effect.mapError(
          HttpClientResponse.filterStatusOk(response),
          (cause) =>
            toError(cause, "Telegram file download returned an error status")
        );

        const arrayBuffer = yield* Effect.mapError(
          okResponse.arrayBuffer,
          (cause) => toError(cause, "Failed to read telegram file body")
        );

        const audioBytes = new Uint8Array(arrayBuffer);
        const contentType = pipe(
          Headers.get(okResponse.headers, "content-type"),
          Option.getOrUndefined
        );

        const transcription = yield* Effect.tryPromise({
          try: () =>
            transcribe({
              model: openai.transcription("gpt-4o-mini-transcribe"),
              audio: audioBytes,
            }),
          catch: (cause) => toError(cause, "Failed to transcribe audio"),
        });

        const text = transcription.text?.trim();
        if (!text) {
          return yield* Effect.fail(new Error("Transcription result is empty"));
        }

        return {
          text,
          language: transcription.language,
          durationInSeconds: transcription.durationInSeconds,
          filePath: file.file_path,
          size: audioBytes.length,
          contentType,
        } as const;
      });

    const handleUserMessage = async (
      ctx: TelegramContext,
      text: string,
      options: HandleUserMessageOptions = {}
    ) => {
      if (!ctx.chat) {
        return;
      }
      const chatId = ctx.chat.id;
      const userId = ctx.from?.id || chatId;
      const interactionType =
        options.interactionType === "VOICE" ? "VOICE" : "TEXT";
      const initialProgressText =
        options.initialProgressText ?? "🤔 Думаю над ответом...";

      const preview = createPreview(text);
      const interactionLabel =
        interactionType === "VOICE" ? "голосовое" : "текстовое";
      const interactionEmoji = interactionType === "VOICE" ? "🎙️" : "📨";
      console.log(
        `${interactionEmoji} Получено ${interactionLabel} сообщение от ${userId}: ${preview}`
      );

      let progressMessageId = options.progressMessageId;

      const ensureProgressMessage = async () => {
        if (progressMessageId !== undefined) {
          try {
            await ctx.api.editMessageText(
              chatId,
              progressMessageId,
              initialProgressText
            );
          } catch (error: any) {
            if (
              error?.error_code === 400 &&
              typeof error?.description === "string" &&
              error.description.includes("message is not modified")
            ) {
              return;
            }
            console.error("Не удалось обновить сообщение прогресса:", error);
          }
        } else {
          const progressMessage = await ctx.reply(initialProgressText);
          progressMessageId = progressMessage.message_id;
        }
      };

      try {
        await ensureProgressMessage();

        if (progressMessageId === undefined) {
          throw new Error("Progress message is not initialized");
        }

        const editMessageSafe = (
          content: string,
          options?: Parameters<typeof ctx.api.editMessageText>[3]
        ) =>
          Effect.promise(() =>
            ctx.api.editMessageText(
              chatId,
              progressMessageId!,
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

        const processEffect = Effect.gen(function* () {
          const aiAgent = yield* aiAgentFactory.getOrCreateAgent(userId);

          const history = yield* messageHistory.getHistory(chatId);
          yield* Effect.sync(() =>
            console.log(
              `🗂️ Loaded conversation history (${history.length} messages)`
            )
          );

          yield* messageHistory.addUserMessage(chatId, text);

          yield* updateProgress("🧠", "Готовлю ответ ассистента...");

          const agentResponse = yield* aiAgent.processMessage(
            {
              userId,
              chatId,
              messageContent: text,
              interactionType,
            },
            history
          );

          const { executions, toolFormatters, plan, subagentExecutionEnabled } =
            agentResponse;

          if (plan.length > 0) {
            console.log("🗺️ Subagent plan:");
            for (const entry of plan) {
              const status = entry.executed
                ? "✅ выполнен"
                : `⏸️ пропущен${entry.reason ? ` (${entry.reason})` : ""}`;
              console.log(`  • ${entry.kind}: ${status}`);
            }
          } else {
            console.log("🗺️ Subagent plan: <empty>");
          }

          if (!subagentExecutionEnabled) {
            console.log(
              "🧪 Subagent execution disabled — returning diagnostic summary"
            );
          }

          const allToolCalls = executions.flatMap(
            (execution) => execution.result.toolCalls ?? []
          );

          if (allToolCalls.length > 0) {
            for (const call of allToolCalls) {
              const completionMessage = `Инструмент ${call.toolName} выполнен`;
              yield* updateProgress("✅", completionMessage);
            }
          }

          const baseText = executions
            .map((execution) => execution.result.text?.trim())
            .filter((value): value is string =>
              Boolean(value && value.length > 0)
            )
            .join("\n\n");
          let aggregatedResponse: AggregatedToolResponse | undefined;

          const allToolResults = executions.flatMap(
            (execution) => execution.result.toolResults ?? []
          );

          if (allToolResults.length > 0) {
            console.log("🔧 Processing tool results to generate response...");
            aggregatedResponse = yield* generateResponseFromToolResults(
              allToolResults,
              toolFormatters
            );
          }

          const textParts: string[] = [];
          const aggregatedText = aggregatedResponse?.text?.trim();
          if (aggregatedText && aggregatedText.length > 0) {
            textParts.push(aggregatedText);
          }
          const baseTextValue = baseText.trim();
          if (baseTextValue.length > 0) {
            textParts.push(baseTextValue);
          }

          const finalText =
            textParts.join("\n\n").trim() ||
            "❌ Извините, не удалось сформировать ответ.";

          const finalResponse: AggregatedToolResponse = {
            text: finalText,
            parseMode: aggregatedResponse?.parseMode,
            replyMarkup: aggregatedResponse?.replyMarkup,
            metadata: aggregatedResponse?.metadata,
          };

          console.log("📝 Final response text:", finalText);

          yield* messageHistory.addAssistantMessage(chatId, finalText);

          yield* finalizeMessage(finalResponse);
        }).pipe(
          Effect.catchAll((error) => {
            console.error("AI processing error:", error);
            const errorMessage =
              "❌ Извините, произошла ошибка при обработке сообщения.";

            return Effect.gen(function* () {
              yield* messageHistory.addAssistantMessage(chatId, errorMessage);
              yield* finalizeMessage({
                text: errorMessage,
              });
            });
          })
        );

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

        console.log(
          `✅ Отправлен AI ответ для ${userId} (${interactionType.toLowerCase()})`
        );
      } catch (error) {
        console.error("Ошибка при обработке сообщения:", error);
        const errorMessage =
          "❌ Произошла ошибка при обработке вашего сообщения.";
        if (progressMessageId !== undefined) {
          try {
            await ctx.api.editMessageText(
              chatId,
              progressMessageId,
              errorMessage
            );
          } catch (editError) {
            console.error(
              "Не удалось обновить сообщение прогресса после ошибки:",
              editError
            );
            await ctx.reply(errorMessage);
          }
        } else {
          await ctx.reply(errorMessage);
        }
      }
    };

    // Setup basic handlers
    const setupHandlers = () => {
      bot.command("start", async (ctx) => {
        await ctx.reply(
          "🤖 Привет! Я AI-ассистент на Effect Framework.\n\n" +
            "Это минимальная версия бота для первой итерации миграции.\n" +
            "Просто напишите мне сообщение!"
        );
      });

      bot.command("app", async (ctx) => {
        if (ctx.chat.type !== "private") {
          await ctx.reply(
            "Давайте перейдем в личные сообщения! 💬\n\nНапишите мне напрямую, и я помогу настроить ваши события."
          );
          return;
        }

        if (!resolvedWebAppUrl) {
          await ctx.reply(
            webAppUnavailableResponse ??
              "Мини-приложение сейчас недоступно. Проверьте значение WEBAPP_URL."
          );
          return;
        }

        const keyboard = new InlineKeyboard().webApp(
          "🚀 Открыть Mini App",
          resolvedWebAppUrl
        );

        await ctx.reply(
          "🚀 Готово! Нажмите кнопку ниже и откройте удобное приложение для управления событиями:",
          {
            reply_markup: keyboard,
          }
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
          // Format: journal:createTask:<entryId>:<YYYYMMDD|0>
          const parts = data.split(":");
          const dateToken = parts[3] || "0";
          let dueAt: Date | null = null;
          if (/^\d{8}$/.test(dateToken)) {
            const y = Number(dateToken.slice(0, 4));
            const m = Number(dateToken.slice(4, 6)) - 1;
            const d = Number(dateToken.slice(6, 8));
            const dt = new Date(Date.UTC(y, m, d));
            // normalize to local day start for simplicity
            dueAt = new Date(
              dt.getUTCFullYear(),
              dt.getUTCMonth(),
              dt.getUTCDate()
            );
          }
          // Extract title from message text (only one suggestion is shown when button exists)
          const messageText = ctx.callbackQuery.message?.text || "";
          const line =
            messageText
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.startsWith("• ")) || "";
          const title = line
            .replace(/^•\s+/, "")
            .replace(/\s+—\s+до\s+.+$/, "")
            .trim();
          const userId = ctx.from?.id || ctx.chat?.id;

          if (!userId || !title) {
            await ctx.answerCallbackQuery({
              text: "❌ Не удалось создать задачу",
              show_alert: true,
            });
            return;
          }

          try {
            await Effect.runPromise(
              taskRepository.create({ userId, title, dueAt })
            );
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
        const text = ctx.message.text;
        if (!text) {
          return;
        }

        await handleUserMessage(ctx, text, { interactionType: "TEXT" });
      });

      bot.on("message:voice", async (ctx) => {
        const voice = ctx.message.voice;
        if (!voice) {
          return;
        }

        const chatId = ctx.chat.id;
        const userId = ctx.from?.id || chatId;
        console.log(
          `🎙️ Получено голосовое сообщение от ${userId}: duration=${
            voice.duration ?? 0
          }s, size=${voice.file_size ?? 0}B`
        );

        let progressMessageId: number | undefined;

        try {
          const progressMessage = await ctx.reply(
            "🎙️ Расшифровываю голосовое сообщение..."
          );
          progressMessageId = progressMessage.message_id;

          const transcription = await Effect.runPromise(
            transcribeTelegramAudio(ctx, voice.file_id).pipe(
              Effect.provide(NodeHttpClient.layer)
            )
          );

          const transcriptionPreview = createPreview(transcription.text);
          console.log(
            `📝 Расшифровка голосового сообщения (${userId}, язык=${
              transcription.language ?? "unknown"
            }): ${transcriptionPreview}`
          );

          await handleUserMessage(ctx, transcription.text, {
            interactionType: "VOICE",
            progressMessageId,
            initialProgressText: "🤔 Думаю над ответом...",
          });
        } catch (error) {
          console.error("Ошибка при обработке голосового сообщения:", error);
          const errorMessage =
            "❌ Не удалось распознать голосовое сообщение. Попробуйте ещё раз или отправьте текст.";
          if (progressMessageId !== undefined) {
            try {
              await ctx.api.editMessageText(
                chatId,
                progressMessageId,
                errorMessage
              );
            } catch (editError) {
              console.error(
                "Не удалось обновить сообщение прогресса (voice):",
                editError
              );
              await ctx.reply(errorMessage);
            }
          } else {
            await ctx.reply(errorMessage);
          }
        }
      });

      bot.on("message:audio", async (ctx) => {
        const audio = ctx.message.audio;
        if (!audio) {
          return;
        }

        const chatId = ctx.chat.id;
        const userId = ctx.from?.id || chatId;
        console.log(
          `🎵 Получено аудио от ${userId}: ${
            audio.file_name ?? "<без имени>"
          }, duration=${audio.duration ?? 0}s, size=${audio.file_size ?? 0}B`
        );

        let progressMessageId: number | undefined;

        try {
          const progressMessage = await ctx.reply("🎧 Обрабатываю аудио...");
          progressMessageId = progressMessage.message_id;

          const transcription = await Effect.runPromise(
            transcribeTelegramAudio(ctx, audio.file_id).pipe(
              Effect.provide(NodeHttpClient.layer)
            )
          );

          const transcriptionPreview = createPreview(transcription.text);
          console.log(
            `📝 Расшифровка аудио (${userId}, язык=${
              transcription.language ?? "unknown"
            }): ${transcriptionPreview}`
          );

          await handleUserMessage(ctx, transcription.text, {
            interactionType: "VOICE",
            progressMessageId,
            initialProgressText: "🤔 Думаю над ответом...",
          });
        } catch (error) {
          console.error("Ошибка при обработке аудио файла:", error);
          const errorMessage =
            "❌ Не удалось распознать аудио. Попробуйте другое сообщение или отправьте текст.";
          if (progressMessageId !== undefined) {
            try {
              await ctx.api.editMessageText(
                chatId,
                progressMessageId,
                errorMessage
              );
            } catch (editError) {
              console.error(
                "Не удалось обновить сообщение прогресса (audio):",
                editError
              );
              await ctx.reply(errorMessage);
            }
          } else {
            await ctx.reply(errorMessage);
          }
        }
      });
    };

    setupHandlers();

    const start = Effect.gen(function* () {
      try {
        console.log("🚀 Запуск Telegram клиента...");

        const commands = [
          { command: "start", description: "🚀 Запустить бота" },
          { command: "clear", description: "🧹 Очистить историю" },
          { command: "integrations", description: "📊 Показать интеграции" },
        ];

        if (resolvedWebAppUrl) {
          commands.push({
            command: "app",
            description: "🚀 Открыть приложение",
          });
        }

        yield* Effect.promise(() => bot.api.setMyCommands(commands));

        if (resolvedWebAppUrl) {
          yield* Effect.promise(() =>
            bot.api.setChatMenuButton({
              menu_button: {
                type: "web_app",
                text: "🚀 Открыть приложение",
                web_app: { url: resolvedWebAppUrl },
              },
            })
          );
        } else if (webAppUnavailableWarning) {
          console.warn(webAppUnavailableWarning);
        }

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
