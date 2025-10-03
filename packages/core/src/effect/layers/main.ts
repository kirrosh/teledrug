import { Layer, pipe } from "effect";
import { CryptographyServiceLive } from "../services/cryptography";
import { MessageHistoryLive } from "../services/message-history";
import { TelegramClientLive } from "../services/telegram-client";
import { BotApplicationLive } from "../services/bot-application";
import { EncryptionServiceLive } from "../services/encryption";
import { UserRepositoryLive } from "../services/user-repository";
import { UserConfigStorageLive } from "../services/user-config-storage";
import { AIAgentFactoryLive } from "../services/ai-agent";
import { IntegrationRegistryLive } from "../services/integration-registry";
import { DigestSettingsRepositoryLive } from "../services/digest-settings";
import { JournalAnalysisServiceLive } from "../services/journal-analysis";
import { JournalRepositoryLive } from "../services/journal-repository";
import { TaskRepositoryLive } from "../services/task-repository";
import type { BotConfig } from "../types";

// Create main application layer
export const createMainLayer = (
  config: BotConfig & { openaiApiKey: string }
) => {
  // Level 0: Слои без зависимостей (листья дерева)
  const cryptography = CryptographyServiceLive;
  const encryption = EncryptionServiceLive;
  const messageHistory = MessageHistoryLive;
  const journalAnalysis = JournalAnalysisServiceLive;
  const journalRepository = JournalRepositoryLive;
  const taskRepository = TaskRepositoryLive;

  // Level 1: UserRepository требует EncryptionService
  const digestSettings = DigestSettingsRepositoryLive;

  const userRepository = pipe(
    UserRepositoryLive,
    Layer.provide(encryption),
    Layer.provide(digestSettings)
  );

  // Level 2: UserConfigStorage требует UserRepository
  const userConfig = pipe(
    UserConfigStorageLive,
    Layer.provide(userRepository) // ✅ Явно предоставляем зависимость
  );

  // Level 2: IntegrationRegistry требует UserRepository
  const integrationRegistry = pipe(
    IntegrationRegistryLive,
    Layer.provide(digestSettings),
    Layer.provide(userRepository),
    Layer.provide(journalAnalysis),
    Layer.provide(journalRepository),
    Layer.provide(taskRepository)
  );

  // Level 1: AIAgent требует IntegrationRegistry
  const aiAgent = pipe(
    AIAgentFactoryLive({
      openaiApiKey: config.openaiApiKey,
      model: "gpt-4o-mini",
      maxTokens: 3000,
      userId: "default",
    }),
    Layer.provide(integrationRegistry) // ✅ Явно предоставляем зависимость
  );

  // Level 3: TelegramClient требует множество сервисов
  const telegram = pipe(
    TelegramClientLive(config),
    Layer.provide(
      Layer.mergeAll(
        userConfig, // Уже включает userRepository и encryption
        aiAgent, // Уже включает integrationRegistry
        messageHistory,
        cryptography,
        integrationRegistry, // ✅ Явно добавляем для TelegramClient
        journalRepository,
        taskRepository
      )
    )
  );

  // Level 4: BotApplication требует TelegramClient и другие сервисы
  // Собираем финальный контекст со всеми сервисами
  const finalContext = Layer.mergeAll(
    // Базовые независимые сервисы
    cryptography,
    encryption,
    messageHistory,
    journalAnalysis,
    journalRepository,
    integrationRegistry,

    // Сервисы с разрешенными зависимостями
    digestSettings,
    userRepository, // Уже имеет encryption и digest settings
    userConfig, // Уже имеет userRepository
    aiAgent, // Уже имеет integrationRegistry
    telegram // Уже имеет все необходимое
  );

  return pipe(BotApplicationLive, Layer.provide(finalContext));
};

// Default main layer using environment config
export const MainLayer = createMainLayer({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
  openaiApiKey: process.env.OPENAI_API_KEY!,
  webAppUrl: process.env.WEBAPP_URL,
});
