import { Layer } from "effect";
import { CryptographyServiceLive } from "../services/cryptography";
import { MessageHistoryLive } from "../services/message-history";
import { TelegramClientLive } from "../services/telegram-client";
import { BotApplicationLive } from "../services/bot-application";
import { EncryptionServiceLive } from "../services/encryption";
import { UserRepositoryLive } from "../services/user-repository";
import { UserConfigStorageLive } from "../services/user-config-storage";
import type { BotConfig } from "../types";

// Create main application layer
export const createMainLayer = (config: BotConfig) => {
  // Base infrastructure services
  const baseServices = Layer.mergeAll(
    CryptographyServiceLive,
    MessageHistoryLive,
    EncryptionServiceLive
  );

  // Database layer that depends on encryption
  const databaseLayer = UserRepositoryLive.pipe(
    Layer.provide(EncryptionServiceLive)
  );

  // Config storage that depends on repository
  const configLayer = UserConfigStorageLive.pipe(
    Layer.provide(databaseLayer)
  );

  // Telegram client that depends on config
  const telegramLayer = TelegramClientLive(config).pipe(
    Layer.provide(configLayer)
  );

  // Combine all services
  const allServices = Layer.mergeAll(
    baseServices,
    databaseLayer,
    configLayer,
    telegramLayer
  );

  return BotApplicationLive.pipe(
    Layer.provide(allServices)
  );
};

// Default main layer using environment config
export const MainLayer = createMainLayer({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
});
