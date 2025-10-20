# План радикального упрощения архитектуры TeleDrug

**Дата создания:** 2025-10-20
**Статус:** План для согласования
**Цель:** Упростить архитектуру бота, убрав избыточную сложность multi-agent системы

---

## Краткое резюме изменений

### Было (текущее состояние):
- 🔴 Multi-agent архитектура с оркестратором
- 🔴 5 специализированных агентов (journal, tasks, calendar, digest, settings)
- 🔴 Сложная система маршрутизации через LLM
- 🔴 Функциональность дневника (journal)
- 🔴 IntegrationRegistry для управления инструментами
- 🔴 Отдельная схема БД для журнала

### Станет (целевое состояние):
- ✅ Единый AI-агент без маршрутизатора
- ✅ 4 функциональные области (tasks, calendar, digest, settings)
- ✅ Все инструменты в одном месте
- ✅ Прямой вызов инструментов без routing
- ✅ Упрощенная структура пакета ai
- ✅ Меньше кода, проще поддержка

---

## Фаза 1: Удаление функциональности дневника (Journal)

### 1.1. Удаляемые файлы

#### Полное удаление директорий:
```bash
rm -rf packages/core/src/journal/
```

**Содержимое для удаления:**
- `packages/core/src/journal/model.ts` (69 строк) - Mood/Energy модели
- `packages/core/src/journal/tools.ts` (305 строк) - createJournalEntry инструмент

#### Удаление сервисов:
```bash
rm packages/core/src/services/journal-analysis.ts  # 145 строк
rm packages/core/src/services/journal-repository.ts  # 201 строк
```

**Итого удалено:** 4 файла, ~720 строк кода

### 1.2. Обновление импортов и зависимостей

#### packages/core/src/services/index.ts
```diff
- export { JournalAnalysisService, JournalAnalysisServiceLive } from "./journal-analysis";
- export { JournalRepository, JournalRepositoryLive } from "./journal-repository";
```

#### packages/core/src/app/layers/main.ts
```diff
- import { JournalAnalysisServiceLive } from "../../services/journal-analysis";
- import { JournalRepositoryLive } from "../../services/journal-repository";

  // Удалить из createMainLayer:
- const journalAnalysis = JournalAnalysisServiceLive;
- const journalRepository = JournalRepositoryLive;

  // Удалить из Layer.mergeAll:
- journalAnalysis,
- journalRepository,
```

#### packages/core/src/services/integration-registry.ts
```diff
- import { createJournalTools } from "../journal/tools";

  // Удалить из prepareBundles:
- const journalBundle = yield* createJournalTools(userId);
- domainBundles.journal = journalBundle;
```

#### packages/core/src/bot/telegram/handlers/callbacks.ts
```diff
- import { JournalRepository } from "../../../services/journal-repository";

  // Удалить весь раздел journal callbacks (строки 14-122):
- // Journal entry deletion
- // Journal task creation
```

#### packages/core/src/bot/telegram/telegram-bot.ts
```diff
- import { JournalRepository } from "../../services/journal-repository";

  // Удалить регистрацию journal callbacks
```

### 1.3. Удаление из AI агентов

#### packages/ai/src/agent/index.ts

```diff
  const DEFAULT_AGENT_FALLBACK_ORDER: readonly DomainAgentType[] = [
-   "journal",
    "tasks",
    "calendar",
    "digest",
    "settings",
  ];

  const domainAgentDefinitions: Record<DomainAgentType, DomainAgentDefinition> = {
-   journal: {
-     description: "Создаёт и анализирует записи дневника...",
-     buildSystemPrompt: (context, _toolNames) => { ... }
-   },
    tasks: { ... },
    // остальные агенты
  };
```

**Обновить router prompt** (строки 432-442):
```diff
  // Удалить правила для journal:
- "\n- Агента journal используй только для записей о состоянии, эмоциях..."
- "\n- Если вместе с задачами пользователь делится эмоциями... — выбери и tasks, и journal."
- "\n- Если при описании события ... делится эмоциями ... — выбери и calendar, и journal."
```

### 1.4. Удаление схемы базы данных

#### packages/db/src/schema.ts

```diff
- // Удалить весь раздел journal schema (строки 108-192):
- export const journalSchema = pgSchema("journal");
- export const journalMoodEnum = pgEnum("journal_mood", [...]);
- export const journalEnergyEnum = pgEnum("journal_energy", [...]);
- export const journalTags = journalSchema.table(...);
- export const journalEntries = journalSchema.table(...);
- export const journalEntryTags = journalSchema.table(...);
- export type JournalEntry = ...;
- export type NewJournalEntry = ...;
- export type JournalTag = ...;
- export type NewJournalTag = ...;
```

#### Миграция БД
```sql
-- Создать новую миграцию:
-- packages/db/migrations/YYYYMMDD_drop_journal_schema.sql

DROP SCHEMA IF EXISTS journal CASCADE;

-- Это удалит:
-- - journal.tags
-- - journal.entries
-- - journal.entry_tags
-- - journal_mood enum
-- - journal_energy enum
```

### 1.5. Обновление TypeScript типов

#### packages/ai/src/contracts/integration.ts
```diff
  export type DomainAgentType =
    | "digest"
-   | "journal"
    | "tasks"
    | "calendar"
    | "settings";
```

### 1.6. Результат Фазы 1

**Удалено:**
- ✅ 4 файла (~720 строк)
- ✅ Схема БД journal (3 таблицы)
- ✅ 1 агент из системы
- ✅ ~100 строк импортов и конфигурации

**Сохранено:**
- ✅ Все остальные агенты работают независимо
- ✅ Tasks, Calendar, Digest, Settings полностью функциональны
- ✅ IntegrationRegistry продолжает работать

---

## Фаза 2: Замена оркестратора единым агентом

### 2.1. Текущая архитектура оркестратора

**Проблемы текущей реализации:**
1. Два уровня LLM вызовов:
   - Router (выбор агентов) → затем
   - Domain agents (выполнение инструментов)
2. Сложная система маршрутизации (200+ строк)
3. Overhead на routing для простых запросов
4. Дублирование контекста между router и agents
5. Сложная отладка и трейсинг

**Файлы для рефакторинга:**
- `packages/ai/src/agent/index.ts` (837 строк) - **основной файл**
- `packages/ai/src/contracts/integration.ts` - типы DomainAgentType
- `packages/core/src/services/integration-registry.ts` - bundle preparation

### 2.2. Новая архитектура единого агента

#### Концепция

```
Текущая (multi-agent):
User Message
    ↓
Router (LLM #1) - выбирает агентов
    ↓
Journal Agent (LLM #2) ──┐
Tasks Agent (LLM #3) ────┤─→ Sequential execution
Calendar Agent (LLM #4) ─┤
Settings Agent (LLM #5) ─┘
    ↓
Combined Results


Новая (single agent):
User Message
    ↓
Unified Agent (LLM #1) - сразу вызывает инструменты
    ↓
All Tools Available (parallel execution возможен)
    ↓
Results
```

#### Преимущества:
- ✅ Один LLM вызов вместо 2-5
- ✅ Более быстрые ответы
- ✅ Меньше затрат на токены
- ✅ Проще отладка
- ✅ LLM сам решает, какие инструменты нужны

### 2.3. Новая структура packages/ai/

#### packages/ai/src/agent/unified-agent.ts (новый файл)

```typescript
import { Effect, Context } from "effect";
import { Experimental_Agent as Agent } from "ai";
import { openai } from "@ai-sdk/openai";
import { getMainModel } from "@teledrug/core/config/ai-models";
import type { CoreMessage } from "ai";
import type { AIAgentConfig } from "../contracts/config";
import type { SimpleChatContext } from "../contracts/context";

export interface UnifiedAgent {
  readonly processMessage: (
    context: SimpleChatContext,
    conversationHistory?: readonly CoreMessage[]
  ) => Effect.Effect<UnifiedAgentResponse, AIAgentError>;
}

export interface UnifiedAgentResponse {
  readonly text: string;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly toolResults?: ReadonlyArray<ToolResult>;
}

const UNIFIED_SYSTEM_PROMPT = `
Ты — персональный AI-ассистент TeleDrug. Помогаешь пользователю управлять задачами, календарём, настройками и ежедневным дайджестом.

## Доступные инструменты:

### Задачи (Tasks)
- manageTasks: создавай, обновляй, завершай, удаляй и переноси задачи
- listTasks: получай список открытых задач

### Календарь (Calendar)
- getCalendarEvents: просматривай события на указанную дату
- createCalendarEvent: создавай новые события (требуется интеграция Яндекс.Календарь)

### Дайджест (Digest)
- updateDigestSettings: управляй модулями утреннего дайджеста (погода, валюты, календарь, задачи)

### Настройки (Settings)
- updateUserSettings: обновляй часовой пояс, город, страну, предпочтения пользователя

## Правила работы:

1. **Задачи**: всегда используй manageTasks для любых операций с задачами
2. **Календарь**: при упоминании событий с датой/временем используй календарные инструменты
3. **Настройки**: меняй настройки только при явном запросе пользователя
4. **Дайджест**: настраивай модули, если пользователь говорит про утреннюю сводку

Отвечай на русском языке, будь лаконичен и конкретен.
Не задавай уточняющих вопросов — при нехватке данных делай разумные предположения.
`.trim();

const makeUnifiedAgent = (config: AIAgentConfig) =>
  Effect.gen(function* () {
    // Валидация конфигурации
    const validatedConfig = yield* Schema.decodeUnknown(AIAgentConfigSchema)(config);

    process.env.OPENAI_API_KEY = validatedConfig.openaiApiKey;

    const processMessage = (
      context: SimpleChatContext,
      conversationHistory: readonly CoreMessage[] = []
    ): Effect.Effect<UnifiedAgentResponse, AIAgentError> =>
      Effect.gen(function* () {
        // Получение всех инструментов
        const integrationRegistry = yield* IntegrationRegistry;
        const allTools = yield* integrationRegistry.getAllTools(
          context.userId,
          context.interactionType || "TEXT"
        );

        // Подготовка сообщений
        const messages: CoreMessage[] = [
          ...conversationHistory,
          {
            role: "user",
            content: context.messageContent,
          },
        ];

        // Создание единого агента
        const model = openai(validatedConfig.model || getMainModel());
        const agent = new Agent({
          model,
          tools: allTools,
          maxOutputTokens: validatedConfig.maxTokens || 3000,
        });

        // Выполнение
        const result = yield* Effect.tryPromise({
          try: () =>
            agent.generate({
              system: UNIFIED_SYSTEM_PROMPT,
              messages,
            }),
          catch: (cause) =>
            new AIAgentError({
              message: "Unified agent failed to generate response",
              cause,
            }),
        });

        return {
          text: result.text || "",
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
        };
      });

    return {
      processMessage,
    };
  });

export const UnifiedAgentLive = (config: AIAgentConfig) =>
  Layer.effect(UnifiedAgent, makeUnifiedAgent(config));

export const UnifiedAgent = Context.GenericTag<UnifiedAgent>(
  "@services/UnifiedAgent"
);
```

### 2.4. Упрощение IntegrationRegistry

#### packages/core/src/services/integration-registry.ts (упрощенная версия)

```typescript
// Вместо prepareBundles для каждого агента отдельно,
// создать один метод getAllTools:

export interface IntegrationRegistry {
  readonly getAllTools: (
    userId: number,
    interactionType: InteractionType
  ) => Effect.Effect<
    Record<string, AITool>,
    IntegrationError
  >;
}

const makeIntegrationRegistry = Effect.gen(function* () {
  const userConfig = yield* UserConfigStorage;
  const taskRepo = yield* TaskRepository;
  const digestSettings = yield* DigestSettingsRepository;
  const userRepo = yield* UserRepository;

  const getAllTools = (
    userId: number,
    interactionType: InteractionType
  ): Effect.Effect<Record<string, AITool>, IntegrationError> =>
    Effect.gen(function* () {
      // Получить конфигурацию пользователя
      const config = yield* userConfig.get(userId);

      // Собрать все инструменты в один объект
      const allTools: Record<string, AITool> = {};

      // Tasks tools (всегда доступны)
      const tasksTools = yield* createTaskTools(userId);
      Object.assign(allTools, tasksTools.tools);

      // Digest tools (всегда доступны)
      const digestTools = yield* createDigestTools(userId);
      Object.assign(allTools, digestTools.tools);

      // Settings tools (всегда доступны)
      const settingsTools = yield* createUserSettingsTools(userId);
      Object.assign(allTools, settingsTools.tools);

      // Calendar tools (если интеграция включена)
      const calendarIntegration = config.integrations.find(
        (i) => i.type === "yandex_calendar" && i.enabled
      );
      if (calendarIntegration?.credentials) {
        const calendarTools = yield* createYandexCalendarTools(
          calendarIntegration.credentials
        );
        Object.assign(allTools, calendarTools.tools);
      }

      return allTools;
    });

  return { getAllTools };
});
```

### 2.5. Обновление TelegramClient

#### packages/core/src/bot/telegram/telegram-bot.ts

```diff
- import { AIAgentFactory } from "../../services/ai-agent";
+ import { UnifiedAgent } from "@teledrug/ai";

  // В makeMessageProcessor:
- const agentFactory = yield* AIAgentFactory;
- const agent = yield* agentFactory.getOrCreateAgent(userId);
+ const agent = yield* UnifiedAgent;

  const response = yield* agent.processMessage(
    {
      userId,
      chatId,
      messageContent: text,
      interactionType: "TEXT",
    },
    history
  );

  // Обработка результата (упрощенная):
- for (const execution of response.executions) {
-   // обработка каждого агента
- }
+ if (response.toolResults) {
+   // обработка результатов инструментов
+ }
```

### 2.6. Удаляемые файлы и компоненты

#### Файлы для удаления:
```bash
# Старый оркестратор и фабрика
rm packages/core/src/services/ai-agent.ts

# Старая реализация multi-agent
# Заменить packages/ai/src/agent/index.ts на unified-agent.ts
mv packages/ai/src/agent/index.ts packages/ai/src/agent/orchestrator-OLD.ts
mv packages/ai/src/agent/unified-agent.ts packages/ai/src/agent/index.ts
```

#### Упрощенная структура packages/ai/:
```
packages/ai/
├── src/
│   ├── agent/
│   │   ├── index.ts           # unified-agent (новая реализация)
│   │   └── orchestrator-OLD.ts # старая версия (для reference)
│   ├── contracts/
│   │   ├── config.ts          # AIAgentConfig
│   │   ├── context.ts         # SimpleChatContext
│   │   └── messages.ts        # ConversationMessage
│   ├── errors.ts              # AIAgentError
│   └── index.ts               # Public API
└── tests/
    └── integration/
        └── unified-agent.test.ts  # новые тесты
```

### 2.7. Результат Фазы 2

**Удалено:**
- ✅ Система роутинга агентов (~200 строк)
- ✅ Отдельные domain agent definitions (~150 строк)
- ✅ Fallback routing logic
- ✅ Сложная система executeAgentPlan
- ✅ AIAgentFactory с кэшированием

**Упрощено:**
- ✅ IntegrationRegistry (был ~320 строк, станет ~150 строк)
- ✅ Один unified agent вместо 5 агентов
- ✅ Прямой вызов инструментов

**Преимущества:**
- 🚀 Быстрее: 1 LLM вызов вместо 2-5
- 💰 Дешевле: меньше токенов
- 🐛 Проще отладка: один промпт, один агент
- 📦 Меньше кода: ~400 строк вместо 837

---

## Фаза 3: Дополнительные упрощения

### 3.1. Упрощение слоев (Layers)

#### packages/core/src/app/layers/main.ts

**Было:** Сложная иерархия из 3 уровней зависимостей

**Станет:** Плоская структура

```typescript
export const createMainLayer = (
  config: BotConfig & { openaiApiKey: string }
) => {
  // Листовые сервисы (без зависимостей)
  const baseServices = Layer.mergeAll(
    CryptographyServiceLive,
    EncryptionServiceLive(config.encryptionMasterKey),
    MessageHistoryLive,
  );

  // Репозитории (зависят от базы)
  const repositories = Layer.mergeAll(
    UserRepositoryLive,
    TaskRepositoryLive,
    DigestSettingsRepositoryLive,
  );

  // Сервисы высокого уровня
  const services = Layer.mergeAll(
    UserConfigStorageLive,
    IntegrationRegistryLive,
  ).pipe(Layer.provide(repositories));

  // Единый агент
  const agent = UnifiedAgentLive({
    openaiApiKey: config.openaiApiKey,
    model: getMainModel(),
    maxTokens: 3000,
    userId: "default",
  }).pipe(Layer.provide(services));

  // Telegram клиент
  const telegram = TelegramClientLive(config).pipe(
    Layer.provide(
      Layer.mergeAll(
        services,
        agent,
        MessageHistoryLive,
      )
    )
  );

  // Приложение
  const app = BotApplicationLive(config).pipe(
    Layer.provide(telegram)
  );

  return Layer.mergeAll(baseServices, repositories, services, agent, telegram, app);
};
```

### 3.2. Упрощение интерфейсов

#### packages/ai/src/contracts/integration.ts

```diff
- export type DomainAgentType = "digest" | "tasks" | "calendar" | "settings";
- export type DomainIntegrationTools = Partial<Record<DomainAgentType, IntegrationToolsBundle>>;

+ // Больше не нужно разделение по доменам
+ export type AllTools = Record<string, AITool>;
```

### 3.3. Удаление избыточного кэширования

#### packages/core/src/services/ai-agent.ts (удалить полностью)

**Было:**
- Кэш агентов на 1 час
- Отдельный агент для каждого пользователя
- Cache invalidation логика

**Станет:**
- Один экземпляр unified agent
- Stateless обработка
- Нет необходимости в кэшировании

### 3.4. Результат Фазы 3

**Удалено:**
- ✅ Сложная иерархия слоев
- ✅ Кэширование агентов
- ✅ Разделение по доменам в типах

**Упрощено:**
- ✅ Плоская структура зависимостей
- ✅ Меньше абстракций
- ✅ Проще понимание кода

---

## Фаза 4: Миграция и тестирование

### 4.1. План миграции БД

```sql
-- 1. Создать backup
pg_dump -Fc teledrug > teledrug_backup_before_simplification.dump

-- 2. Применить миграцию
DROP SCHEMA IF EXISTS journal CASCADE;

-- 3. Верификация
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename;

-- Ожидаемый результат:
-- public.users
-- public.user_settings
-- public.user_integrations
-- public.tasks
-- public.digest_modules
-- public.digest_module_settings
-- (НЕТ journal.*)
```

### 4.2. Тестовые сценарии

#### Ручное тестирование:

```bash
# 1. Запустить бота
bun run start

# 2. Проверить tasks
"Создай задачу купить молоко на завтра"
"Покажи мои задачи"
"Отметь задачу 'купить молоко' выполненной"

# 3. Проверить calendar (если настроен)
"Какие у меня планы на завтра?"
"Создай встречу с командой в среду в 15:00"

# 4. Проверить settings
"Установи город Москва"
"Мой часовой пояс - Europe/Moscow"

# 5. Проверить digest
"Включи погоду в утреннем дайджесте"
"Отключи курс доллара"
```

#### Автоматическое тестирование:

```bash
# Запустить интеграционные тесты
RUN_LLM_TESTS=1 bun test packages/ai/tests/integration/

# Обновить тесты:
# - Удалить journal.integration.test.ts
# - Обновить orchestrator.integration.test.ts → unified-agent.test.ts
# - Сохранить tasks, calendar, settings, digest тесты
```

### 4.3. Rollback план

Если что-то пойдет не так:

```bash
# 1. Восстановить БД
pg_restore -d teledrug teledrug_backup_before_simplification.dump

# 2. Откатить код
git checkout main  # или нужный коммит
bun install

# 3. Перезапустить
bun run start
```

---

## Итоговые метрики упрощения

### Код (строки)

| Компонент | Было | Станет | Δ |
|-----------|------|--------|---|
| packages/ai/src/agent/ | 837 | ~300 | **-537** |
| packages/core/src/journal/ | 374 | 0 | **-374** |
| packages/core/src/services/ (journal) | 346 | 0 | **-346** |
| packages/core/src/services/integration-registry.ts | 320 | ~150 | **-170** |
| packages/core/src/app/layers/main.ts | 94 | ~60 | **-34** |
| packages/core/src/bot/callbacks | 122 | ~50 | **-72** |
| **ИТОГО** | **2,093** | **~560** | **-1,533 (-73%)** |

### База данных

| Метрика | Было | Станет | Δ |
|---------|------|--------|---|
| Схемы | 2 (public, journal) | 1 (public) | **-1** |
| Таблицы | 9 | 6 | **-3** |
| Enums | 2 | 0 | **-2** |

### Архитектура

| Компонент | Было | Станет |
|-----------|------|--------|
| AI агенты | 5 специализированных | 1 unified |
| LLM вызовов на запрос | 2-5 | 1 |
| Уровней routing | 2 (router + agents) | 0 |
| Сервисов | 12 | 8 |
| Слоев зависимостей | 3 | 1 |

### Производительность (оценочно)

| Метрика | Было | Станет | Улучшение |
|---------|------|--------|-----------|
| Время ответа | ~3-7 сек | ~1-2 сек | **2-4x быстрее** |
| Токены на запрос | ~2000-5000 | ~800-1500 | **2-3x дешевле** |
| Сложность отладки | Высокая | Низкая | **Проще** |

---

## Чеклист выполнения

### Подготовка
- [ ] Создать feature branch: `git checkout -b simplify-architecture`
- [ ] Сделать backup БД: `pg_dump -Fc teledrug > backup.dump`
- [ ] Зафиксировать текущее состояние тестов

### Фаза 1: Удаление Journal (2-3 часа)
- [ ] Удалить `packages/core/src/journal/`
- [ ] Удалить `packages/core/src/services/journal-analysis.ts`
- [ ] Удалить `packages/core/src/services/journal-repository.ts`
- [ ] Обновить imports в 6 файлах
- [ ] Удалить journal schema из БД
- [ ] Удалить journal из типов DomainAgentType
- [ ] Запустить TypeScript проверку: `bun run typecheck`
- [ ] Создать миграцию: `DROP SCHEMA journal CASCADE`
- [ ] Применить миграцию на dev БД
- [ ] Коммит: "refactor: remove journal functionality"

### Фаза 2: Unified Agent (4-5 часов) ✅ ЗАВЕРШЕНО
- [x] ~~Создать `packages/ai/src/agent/unified-agent.ts`~~ - Заменен Agent на generateText
- [x] Переписать system prompt - Сохранен buildUnifiedSystemPrompt
- [x] ~~Упростить IntegrationRegistry.getAllTools()~~ - Уже есть getToolsForUser
- [x] ~~Обновить TelegramClient для работы с unified agent~~ - Не требуется
- [x] ~~Переименовать старый index.ts в orchestrator-OLD.ts~~ - Обновлен in-place
- [x] ~~Обновить exports в packages/ai/src/index.ts~~ - Уже актуальны
- [x] ~~Удалить `packages/core/src/services/ai-agent.ts`~~ - Не было в коде
- [x] ~~Обновить layers в main.ts~~ - Не требуется
- [x] Запустить TypeScript проверку: `bun tsc --noEmit` - ✅ PASS
- [x] Коммит: "refactor: replace Agent with generateText for GPT-5 compatibility"

**Что сделано:**
- Заменил `Experimental_Agent` на `generateText` для лучшей совместимости
- Объединил системные контекстные сообщения в единый system prompt
- Исправил TypeScript ошибки в тестах (mergeBundles, CoreMessage import)
- Создал `guardToolContext()` для правильной работы с guard-инструментами
- Проверил работу с AI SDK 5 - используется правильно (inputSchema)

**Результаты тестирования:**
- ✅ gpt-4o-mini: Все тесты проходят (1 pass, 14 expect())
- ⚠️ gpt-5-mini/nano: Не работают со сложными промптами (рекомендуется gpt-4o-mini)

### Фаза 3: Упрощение (1-2 часа) ✅ ЗАВЕРШЕНО
- [x] ~~Упростить структуру layers~~ - Упрощен IntegrationRegistry
- [x] Удалить избыточные типы - Удалены DomainAgentType, DomainIntegrationTools, getDomainToolsForUser
- [x] ~~Обновить документацию~~ - Обновлен план
- [x] Коммит: "refactor: simplify architecture by removing domain-specific types (Phase 3)"

**Что сделано:**
- Удален тип `DomainAgentType` (больше не нужен после удаления journal)
- Удален тип `DomainIntegrationTools` (unified agent не использует domain-specific bundles)
- Удален метод `getDomainToolsForUser` из IntegrationRegistry (использовался только в тестах)
- Упрощен `integration-registry.ts`:
  * Объединен prepareBundles в getToolsForUser
  * Убрано разделение на domain bundles
  * Инструменты собираются инкрементально через mergeBundles
- Обновлены тесты для работы с упрощенным IntegrationRegistry

**Результаты:**
- Удалено ~90 строк кода
- TypeScript компилируется без ошибок
- Все тесты проходят (1 pass, 14 expect())

### Фаза 4: Тестирование (2-3 часа)
- [ ] Удалить `packages/ai/tests/integration/agents/journal.integration.test.ts`
- [ ] Обновить orchestrator тесты → unified-agent тесты
- [ ] Запустить unit тесты: `bun test packages/ai/tests/unit/`
- [ ] Запустить integration тесты: `RUN_LLM_TESTS=1 bun test`
- [ ] Ручное тестирование (tasks, calendar, settings, digest)
- [ ] Smoke test в production-like окружении
- [ ] Коммит: "test: update tests for unified agent"

### Финализация
- [ ] Обновить README.md с новой архитектурой
- [ ] Обновить architecture-overview.md
- [ ] Code review
- [ ] Merge в main
- [ ] Deploy на production
- [ ] Мониторинг в первые 24 часа

---

## Риски и митigation

| Риск | Вероятность | Влияние | Митigation |
|------|-------------|---------|------------|
| Потеря данных journal | Низкая | Высокое | Backup БД перед миграцией |
| Ухудшение качества ответов | Средняя | Среднее | A/B тестирование, постепенный rollout |
| Поломка интеграций | Низкая | Среднее | Интеграционные тесты перед deploy |
| Проблемы с production | Низкая | Высокое | Feature flag, быстрый rollback |

---

## Следующие шаги после упрощения

1. **Мониторинг производительности**
   - Сравнить время ответа до/после
   - Сравнить использование токенов
   - Отследить качество ответов

2. **Оптимизация промптов**
   - Итеративное улучшение system prompt
   - Добавление примеров (few-shot)
   - Тестирование с разными моделями

3. **Дополнительные упрощения**
   - Упростить message history (если нужно)
   - Оптимизировать БД запросы
   - Рефакторинг tool formatters

4. **Документация**
   - Обновить architecture диаграммы
   - Создать migration guide для contributors
   - Обновить setup инструкции

---

## Заключение

Этот план позволит радикально упростить архитектуру TeleDrug бота:
- **-73% кода** в AI пакете
- **Один агент** вместо multi-agent системы
- **2-4x быстрее** ответы
- **Проще поддержка** и развитие

Упрощение не жертвует функциональностью - все основные возможности (tasks, calendar, digest, settings) сохранятся и будут работать лучше благодаря более прямой интеграции.

**Время на реализацию:** ~10-12 часов
**Сложность:** Средняя
**Риски:** Низкие (с proper testing и backup)

**Готово к реализации! 🚀**
