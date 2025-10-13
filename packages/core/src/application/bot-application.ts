import { Effect, Context, Layer } from "effect";
import {
  BotApplicationError,
  TelegramClientError,
  MessageHistoryError,
} from "../errors";
import { TelegramClient } from "../bot/telegram/telegram-bot";
import { MessageHistory } from "../services/message-history";

// Service interface
export interface BotApplication {
  readonly start: Effect.Effect<
    void,
    BotApplicationError | TelegramClientError
  >;
  readonly stop: Effect.Effect<void, BotApplicationError | TelegramClientError>;
  readonly sendEcho: (
    chatId: number,
    originalMessage: string
  ) => Effect.Effect<
    void,
    BotApplicationError | TelegramClientError | MessageHistoryError
  >;
}

// Service tag
export const BotApplication = Context.GenericTag<BotApplication>(
  "@services/BotApplication"
);

// Implementation
const makeBotApplication = Effect.gen(function* () {
  const telegramClient = yield* TelegramClient;
  const messageHistory = yield* MessageHistory;
  // CryptographyService доступен для будущего использования
  // const cryptography = yield* CryptographyService

  const start = Effect.gen(function* () {
    try {
      console.log("🚀 Запуск Bot Application...");
      yield* telegramClient.start;
      console.log("✅ Bot Application запущен успешно!");
    } catch (cause) {
      return yield* Effect.fail(
        new BotApplicationError({
          message: "Failed to start Bot Application",
          cause,
        })
      );
    }
  });

  const stop = Effect.gen(function* () {
    try {
      console.log("🛑 Остановка Bot Application...");
      yield* telegramClient.stop;
      console.log("✅ Bot Application остановлен успешно!");
    } catch (cause) {
      return yield* Effect.fail(
        new BotApplicationError({
          message: "Failed to stop Bot Application",
          cause,
        })
      );
    }
  });

  const sendEcho = (
    chatId: number,
    originalMessage: string
  ): Effect.Effect<
    void,
    BotApplicationError | TelegramClientError | MessageHistoryError
  > =>
    Effect.gen(function* () {
      try {
        // Create echo response
        const echoMessage = `Эхо: ${originalMessage}`;

        // Send message through Telegram client
        yield* telegramClient.sendMessage(chatId, echoMessage);

        // Add to message history
        yield* messageHistory.addAssistantMessage(chatId, echoMessage);

        console.log(`📤 Echo sent to chat ${chatId}: ${echoMessage}`);
      } catch (cause) {
        return yield* Effect.fail(
          new BotApplicationError({
            message: `Failed to send echo to chat ${chatId}`,
            cause,
          })
        );
      }
    });

  return BotApplication.of({
    start,
    stop,
    sendEcho,
  });
});

// Live layer
export const BotApplicationLive = Layer.effect(
  BotApplication,
  makeBotApplication
);
