import { Effect, Context, Layer } from "effect";
import { Bot } from "grammy";
import { TelegramClientError } from "../../errors";
import { UserConfigStorage } from "../../services/user-config-storage";
import { AIAgentFactory } from "../../services/ai-agent";
import { MessageHistory } from "../../services/message-history";
import { IntegrationRegistry } from "../../services/integration-registry";
import { TaskRepository } from "../../services/task-repository";
import type { BotConfig, UpdateContext } from "../../types";
import { createMessageProcessor } from "./message-processor";
import { createAudioTranscriber } from "./audio-transcriber";
import { createImageAnalyzer } from "./image-analyzer";
import { registerCommandHandlers } from "./handlers/commands";
import { registerCallbackHandlers } from "./handlers/callbacks";
import { registerMessageHandlers } from "./handlers/messages";
import { logger } from "../../utils/logger";

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
    const taskRepository = yield* TaskRepository;

    const bot = new Bot(config.telegramToken);

    // Global error handler for Grammy
    bot.catch((err) => {
      const ctx = err.ctx;
      console.error("💥 Grammy Error Handler caught an error");
      console.error("See logs/error-*.log for full details");

      // Log full error to file
      try {
        logger.grammy(ctx, err.error);
        console.error("✅ Error logged to file successfully");
      } catch (logError) {
        console.error("❌ Failed to log error to file:", logError);
      }

      // Try to reply to user
      try {
        ctx.reply("❌ Произошла ошибка. Попробуйте позже.").catch(() => {});
      } catch {
        // Ignore reply errors
      }
    });

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

    const messageProcessor = createMessageProcessor({
      aiAgentFactory,
      integrationRegistry,
      messageHistory,
    });

    const audioTranscriber = createAudioTranscriber(config.telegramToken);
    const imageAnalyzer = createImageAnalyzer(config.telegramToken);

    registerCommandHandlers(bot, userConfigStorage, {
      resolvedWebAppUrl,
      webAppUnavailableResponse,
    });

    registerCallbackHandlers(bot);
    registerMessageHandlers(bot, messageProcessor, audioTranscriber, imageAnalyzer);

    const start = Effect.gen(function* () {
      try {
        console.log("🚀 Запуск Telegram клиента...");

        const commands = [
          { command: "start", description: "🚀 Запустить бота" },
          { command: "clear", description: "🧹 Очистить историю" },
          { command: "integrations", description: "📊 Показать интеграции" },
          { command: "connect_google", description: "🗓️ Подключить Google Calendar" },
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
