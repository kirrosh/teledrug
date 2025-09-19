# План миграции AI сервисов на Effect Framework

## Текущий статус проекта

### ✅ Что уже реализовано (Effect)
- **Базовая инфраструктура**: EncryptionService, MessageHistory, TelegramClient, BotApplication
- **Утилиты**: UserRepository, UserConfigStorage
- **Структура**: Layers, Services, Error handling
- **Статус**: Простой эхо-бот работает

### ❌ Что нужно мигрировать (классы → Effect сервисы)
- **AIAgent** (`src/ai/agent.ts`) - основная логика работы с LLM
- **AIAgentFactory** (`src/core/ai-agent-factory.ts`) - фабрика агентов
- **ChatContext** (`src/core/chat-context.ts`) - контекст сообщений
- **ResponseManager** (`src/core/response-manager.ts`) - live сообщения
- **Integration** + **YandexCalendarIntegration** - система интеграций
- **IntegrationRegistry** - реестр интеграций

## Анализ компонентов

### Система обработки сообщений

#### 1. **Input Types** (уже определены)
```typescript
enum InteractionType {
  TEXT,    // Текстовые сообщения
  VOICE,   // Голосовые сообщения (через Whisper)
  IMAGE,   // Изображения (только write-инструменты)
  FORWARD  // Пересланные сообщения (только write-инструменты)
}
```

#### 2. **Обязательное условие**: Интеграции должны быть в БД
- Если у пользователя НЕТ интеграций → сообщения в LLM НЕ отправляются
- Если есть интеграции → загружаются инструменты + отправка в LLM

#### 3. **Ограничения инструментов по типам**
- **TEXT/VOICE**: Все инструменты (read + write)
- **IMAGE/FORWARD**: Только write-инструменты (создание событий)

#### 4. **Результат LLM**: Только вызов одного tool
- Ответ LLM = выполнение единственного active tool
- Нет обычных текстовых ответов без tool calls

## Поэтапный план миграции

### Итерация 1: AI Agent Service (2-3 дня)

**Цель**: Мигрировать AIAgent на Effect

```typescript
// AI Agent как Effect Service
interface AIAgent {
  readonly processMessage: (
    context: ChatContext,
    history: readonly string[]
  ) => Effect.Effect<GenerateTextResult, AIError>
}

const AIAgentLive = Layer.effect(
  AIAgent,
  Effect.gen(function* () {
    // Внедряем зависимости через Effect Context
    const messageHistory = yield* MessageHistory
    const userRepository = yield* UserRepository

    const processMessage = (context: ChatContext, history: readonly string[]) =>
      Effect.gen(function* () {
        // Проверяем наличие интеграций
        const userIntegrations = yield* userRepository.getUserIntegrations(context.userId)

        if (userIntegrations.length === 0) {
          return yield* Effect.fail(new NoIntegrationsError())
        }

        // Фильтруем инструменты по типу взаимодействия
        const availableTools = context.getAvailableTools(userIntegrations)

        // Вызываем LLM через AI SDK
        const result = yield* Effect.promise(() => generateText({
          model: openai("gpt-5-nano"),
          messages: context.buildMessages(history),
          tools: availableTools
        }))

        return result
      })

    return AIAgent.of({ processMessage })
  })
)
```

**Ключевые изменения**:
- Убираем класс AIAgent
- Все операции через Effect
- Зависимости через Context
- Обработка ошибок через Effect.fail

### Итерация 2: ChatContext Service (1-2 дня)

**Цель**: Превратить ChatContext в Effect-совместимую структуру

```typescript
// ChatContext как Data с валидацией
const ChatContextSchema = Schema.Struct({
  interactionType: Schema.Literal("TEXT", "VOICE", "IMAGE", "FORWARD"),
  userId: Schema.Number,
  chatId: Schema.Number,
  messageContent: Schema.String,
  mediaContent: Schema.Optional(Schema.Unknown),
  metadata: Schema.Optional(Schema.Record(Schema.String, Schema.Unknown))
})

type ChatContext = Schema.Schema.Type<typeof ChatContextSchema>

// Factory для создания контекста
interface ChatContextFactory {
  readonly createContext: (config: ChatContextConfig) => Effect.Effect<ChatContext, ValidationError>
}

const ChatContextFactoryLive = Layer.effect(
  ChatContextFactory,
  Effect.gen(function* () {
    const createContext = (config: ChatContextConfig) =>
      Effect.gen(function* () {
        // Валидируем входные данные
        const context = yield* Schema.decodeUnknown(ChatContextSchema)(config)
        return context
      })

    return ChatContextFactory.of({ createContext })
  })
)
```

### Итерация 3: Integrations System (3-4 дня)

**Цель**: Мигрировать систему интеграций

```typescript
// Integration как Effect abstraction
interface Integration {
  readonly name: string
  readonly authenticate: (credentials: IntegrationCredentials) => Effect.Effect<boolean, AuthError>
  readonly getTools: () => Effect.Effect<readonly IntegrationTool[], IntegrationError>
  readonly executeToolCall: (toolName: string, parameters: unknown) => Effect.Effect<ToolResult, ToolError>
}

// Registry с типобезопасностью
interface IntegrationRegistry {
  readonly register: <T extends Integration>(integration: T) => Effect.Effect<void>
  readonly getByName: (name: string) => Effect.Effect<Option.Option<Integration>, RegistryError>
  readonly getUserIntegrations: (userId: number) => Effect.Effect<readonly Integration[], RegistryError>
}

// YandexCalendarIntegration
const YandexCalendarIntegrationLive = Layer.effect(
  Integration,
  Effect.gen(function* () {
    const authenticate = (credentials: IntegrationCredentials) =>
      Effect.gen(function* () {
        // OAuth flow через Effect
        const client = yield* Effect.promise(() => createDAVClient({
          serverUrl: credentials.calendarUrl,
          credentials: {
            username: credentials.username,
            password: credentials.password
          }
        }))

        return true // успешная аутентификация
      })

    const getTools = () => Effect.succeed([
      createEventTool,
      getEventsTool,
      updateEventTool
    ])

    return Integration.of({ authenticate, getTools, executeToolCall })
  })
)
```

### Итерация 4: ResponseManager + Live Messages (2 дня)

**Цель**: Добавить систему live сообщений через Effect

```typescript
// Live сообщения через EventBus
type BotEvent =
  | { _tag: "ProgressStarted"; chatId: number; step: ProgressStep }
  | { _tag: "ProgressUpdated"; chatId: number; step: ProgressStep }
  | { _tag: "ProgressFinished"; chatId: number; result: string }

interface ResponseManager {
  readonly startProgress: (chatId: number, step: ProgressStep) => Effect.Effect<void>
  readonly updateProgress: (chatId: number, step: ProgressStep) => Effect.Effect<void>
  readonly finishProgress: (chatId: number, result: string) => Effect.Effect<void>
}

const ResponseManagerLive = Layer.effect(
  ResponseManager,
  Effect.gen(function* () {
    const eventBus = yield* EventBus
    const telegramClient = yield* TelegramClient

    const activeMessages = new Map<number, { messageId: number; lastUpdate: number }>()

    const startProgress = (chatId: number, step: ProgressStep) =>
      Effect.gen(function* () {
        const message = yield* telegramClient.sendMessage(chatId, `${step.emoji} ${step.message}`)
        activeMessages.set(chatId, { messageId: message.message_id, lastUpdate: Date.now() })

        yield* eventBus.publish({ _tag: "ProgressStarted", chatId, step })
      })

    return ResponseManager.of({ startProgress, updateProgress, finishProgress })
  })
)
```

### Итерация 5: Tool System (2-3 дня)

**Цель**: Effect-совместимая система инструментов

```typescript
// Tool с permissions и live updates
interface EffectTool {
  readonly name: string
  readonly permissions: { read: boolean; write: boolean }
  readonly supportedInteractionTypes: readonly InteractionType[]
  readonly execute: (parameters: unknown) => Effect.Effect<ToolResult, ToolError>
  readonly getProgressStep: () => ProgressStep
}

// Tool factory
interface ToolFactory {
  readonly createTool: <P>(config: ToolConfig<P>) => Effect.Effect<EffectTool, ToolError>
}

// Пример создания инструмента
const createEventTool = yield* ToolFactory.createTool({
  name: "createEvent",
  permissions: { read: false, write: true },
  supportedInteractionTypes: [InteractionType.TEXT, InteractionType.VOICE, InteractionType.IMAGE, InteractionType.FORWARD],
  progressStep: {
    message: "Создаю событие в календаре...",
    emoji: "📝"
  },
  execute: (parameters: CreateEventParams) =>
    Effect.gen(function* () {
      const calendarClient = yield* CalendarClient
      const result = yield* calendarClient.createEvent(parameters)
      return result
    })
})
```

## Архитектурные изменения

### 1. От классов к Effect Services

**Было**:
```typescript
class AIAgent {
  constructor(config, integrations) { ... }
  async processMessage(context, history) { ... }
}
```

**Стало**:
```typescript
interface AIAgent {
  readonly processMessage: (context, history) => Effect.Effect<Result, Error>
}

const AIAgentLive = Layer.effect(AIAgent, makeAIAgent)
```

### 2. Dependency Injection через Context

**Было**:
```typescript
const aiAgent = new AIAgent(config, integrations)
const botService = new BotService(telegramBot, aiAgent)
```

**Стало**:
```typescript
const MainLayer = Layer.mergeAll(
  AIAgentLive,
  IntegrationRegistryLive,
  BotApplicationLive
)

const program = Effect.provide(MainLayer)
```

### 3. Обработка ошибок

**Было**:
```typescript
try {
  const result = await aiAgent.processMessage(...)
} catch (error) {
  console.error(error)
}
```

**Стало**:
```typescript
const result = yield* aiAgent.processMessage(...).pipe(
  Effect.catchAll(error =>
    Effect.gen(function* () {
      yield* Console.error(`AI Error: ${error}`)
      return fallbackResponse
    })
  )
)
```

### 4. Валидация данных

**Было**:
```typescript
if (!context.messageContent) {
  throw new Error("Message content is required")
}
```

**Стало**:
```typescript
const context = yield* Schema.decodeUnknown(ChatContextSchema)(input).pipe(
  Effect.catchAll(error => Effect.fail(new ValidationError(error)))
)
```

## Новые Effect Features

### 1. Schema/Data для типобезопасности
- Валидация ChatContext
- Проверка конфигураций интеграций
- Типобезопасные ответы API

### 2. Resource Management
- Автоматическое управление подключениями к календарю
- Graceful shutdown интеграций
- Connection pooling

### 3. EventBus для live сообщений
- Декларативные события прогресса
- Слабая связанность компонентов
- Простое тестирование

### 4. Concurrency
- Параллельная обработка tool calls
- Асинхронные обновления прогресса
- Rate limiting для Telegram API

## Критерии успеха

### Функциональные требования
- [ ] Бот обрабатывает все типы сообщений (TEXT, VOICE, IMAGE, FORWARD)
- [ ] Проверка наличия интеграций перед отправкой в LLM
- [ ] Фильтрация инструментов по типу взаимодействия
- [ ] Результат LLM = только tool calls
- [ ] Live обновления прогресса выполнения

### Технические метрики
- [ ] Типобезопасность во всех компонентах
- [ ] Время ответа < 3 сек
- [ ] Graceful shutdown < 5 сек
- [ ] Отсутствие memory leaks

### Developer Experience
- [ ] Простота добавления новых интеграций
- [ ] Декларативная конфигурация
- [ ] Читаемый код без колбеков

## Timeline

**Общий срок**: 10-14 дней

- **Итерация 1**: AIAgent Service (2-3 дня)
- **Итерация 2**: ChatContext Service (1-2 дня)
- **Итерация 3**: Integrations System (3-4 дня)
- **Итерация 4**: ResponseManager (2 дня)
- **Итерация 5**: Tool System (2-3 дня)

**Буферное время**: +20% на тестирование и отладку

## Следующие шаги

1. [ ] Ревью плана
2. [ ] Начать с Итерации 1: AIAgent Service
3. [ ] Setup дополнительных Effect зависимостей (EventBus, Resource)
4. [ ] Создание базовых схем валидации
5. [ ] Интеграционное тестирование после каждой итерации

## Приоритеты от пользователя

1. **Обработчики входных данных** - различные типы сообщений от пользователя
2. **AI Agent** - локализованная логика работы с LLM
3. **История сообщений** - для передачи контекста в LLM (коротко, без медиа)
4. **Система интеграций** - обязательное условие для работы бота
5. **Tool permissions** - read/write права для инструментов
6. **Live сообщения** - отображение прогресса пользователю

Этот план обеспечивает поэтапную миграцию с сохранением всего функционала и улучшением архитектуры через Effect Framework.