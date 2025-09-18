import { Layer } from "effect";
import { CryptographyServiceLive } from "../services/cryptography";
import { MessageHistoryLive } from "../services/message-history";
import { TelegramClientLive } from "../services/telegram-client";
import { BotApplicationLive } from "../services/bot-application";
import { EncryptionServiceLive } from "../services/encryption";
import { UserRepositoryLive } from "../services/user-repository";
import { UserConfigStorageLive } from "../services/user-config-storage";
import { AIAgentFactoryLive, type AIAgentConfig } from "../services/ai-agent";
import type { BotConfig } from "../types";

// Create main application layer
export const createMainLayer = (
  config: BotConfig & { openaiApiKey: string }
) => {
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
  const configLayer = UserConfigStorageLive.pipe(Layer.provide(databaseLayer));

  // AI Agent Factory
  const aiAgentConfig: AIAgentConfig = {
    openaiApiKey: config.openaiApiKey,
    model: "gpt-5-nano",
    maxTokens: 1000,
    userId: "default", // Will be overridden per user
  };

  const aiAgentLayer = AIAgentFactoryLive(aiAgentConfig);

  // Telegram client that depends on config, AI, and message history
  const telegramLayer = TelegramClientLive(config).pipe(
    Layer.provide(Layer.mergeAll(configLayer, aiAgentLayer, baseServices))
  );

  // Combine all services
  const allServices = Layer.mergeAll(
    baseServices,
    databaseLayer,
    configLayer,
    aiAgentLayer,
    telegramLayer
  );

  return BotApplicationLive.pipe(Layer.provide(allServices));
};

// Default main layer using environment config
export const MainLayer = createMainLayer({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
});
