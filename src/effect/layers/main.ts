import { Layer } from "effect";
import { CryptographyServiceLive } from "../services/cryptography";
import { MessageHistoryLive } from "../services/message-history";
import { TelegramClientLive } from "../services/telegram-client";
import { BotApplicationLive } from "../services/bot-application";
import type { BotConfig } from "../types";

// Create main application layer
export const createMainLayer = (config: BotConfig) => {
  const dependencies = Layer.mergeAll(
    CryptographyServiceLive,
    MessageHistoryLive,
    TelegramClientLive(config)
  );

  return Layer.provide(BotApplicationLive, dependencies);
};

// Default main layer using environment config
export const MainLayer = createMainLayer({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
});
