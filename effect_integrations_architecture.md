# Архитектура интеграций на Effect Framework

## Проблема с текущей архитектурой

### Что не работает в старом подходе
1. **Наследование классов** - не вписывается в Effect парадигму
2. **Статическое создание экземпляров** - сложно тестировать и инжектировать зависимости
3. **Императивная инициализация** - нет контроля над ресурсами и жизненным циклом
4. **Слабая типобезопасность** - нет валидации конфигураций на этапе компиляции
5. **Отсутствие композиции** - сложно комбинировать интеграции

## Новая архитектура на Effect

### Основные принципы

1. **Functional Services** вместо классов
2. **Dependency Injection** через Context
3. **Resource Management** через Scope и Layer
4. **Type Safety** через Schema
5. **Compositional Design** - легкое добавление новых интеграций

## Структура архитектуры

### 1. Core Types и Schemas

```typescript
// src/effect/types/integrations.ts
import { Schema } from "@effect/schema"
import { Data } from "effect"

// Базовые типы
export const InteractionType = Schema.Literal("TEXT", "VOICE", "IMAGE", "FORWARD")
export type InteractionType = Schema.Schema.Type<typeof InteractionType>

// Метаданные инструмента
export const ToolMetadata = Schema.Struct({
  name: Schema.String,
  permissions: Schema.Struct({
    read: Schema.Boolean,
    write: Schema.Boolean
  }),
  supportedInteractionTypes: Schema.Array(InteractionType),
  progressMessage: Schema.String,
  progressEmoji: Schema.String,
  description: Schema.String
})
export type ToolMetadata = Schema.Schema.Type<typeof ToolMetadata>

// Конфигурация интеграции
export const IntegrationConfig = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  description: Schema.String
})
export type IntegrationConfig = Schema.Schema.Type<typeof IntegrationConfig>

// Учетные данные (extensible)
export const IntegrationCredentials = Schema.Record(Schema.String, Schema.Unknown)
export type IntegrationCredentials = Schema.Schema.Type<typeof IntegrationCredentials>

// Tool Result
export const ToolResult = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.Optional(Schema.Unknown),
  error: Schema.Optional(Schema.String)
})
export type ToolResult = Schema.Schema.Type<typeof ToolResult>

// Progress Step
export const ProgressStep = Schema.Struct({
  type: Schema.Literal("tool_call", "progress", "completed"),
  message: Schema.String,
  emoji: Schema.String,
  metadata: Schema.Optional(Schema.Record(Schema.String, Schema.Unknown))
})
export type ProgressStep = Schema.Schema.Type<typeof ProgressStep>
```

### 2. Integration Service Interface

```typescript
// src/effect/services/integration.ts
import { Effect, Context } from "effect"
import { Tool } from "ai"

// Базовый интерфейс интеграции
export interface Integration {
  readonly config: IntegrationConfig
  readonly authenticate: (credentials: IntegrationCredentials) => Effect.Effect<boolean, IntegrationError>
  readonly getTools: (interactionType: InteractionType) => Effect.Effect<readonly Tool[], IntegrationError>
  readonly executeToolCall: (toolName: string, parameters: unknown) => Effect.Effect<ToolResult, ToolError>
  readonly getToolMetadata: (toolName: string) => Effect.Effect<ToolMetadata, MetadataError>
  readonly getProgressStep: (toolName: string) => Effect.Effect<ProgressStep, MetadataError>
  readonly disconnect: Effect.Effect<void, IntegrationError>
}

// Context tag для интеграции
export interface IntegrationService {
  readonly name: string
  readonly integration: Integration
}

// Ошибки
export class IntegrationError extends Data.TaggedError("IntegrationError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ToolError extends Data.TaggedError("ToolError")<{
  readonly toolName: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class MetadataError extends Data.TaggedError("MetadataError")<{
  readonly toolName: string
  readonly message: string
}> {}
```

### 3. Integration Registry

```typescript
// src/effect/services/integration-registry.ts
import { Effect, Context, Layer, Ref, Cache, Duration } from "effect"

export interface IntegrationRegistry {
  readonly register: (name: string, service: IntegrationService) => Effect.Effect<void>
  readonly get: (name: string) => Effect.Effect<Option.Option<IntegrationService>, RegistryError>
  readonly getUserIntegrations: (userId: number) => Effect.Effect<readonly IntegrationService[], RegistryError>
  readonly authenticateUserIntegration: (userId: number, integrationName: string, credentials: IntegrationCredentials) => Effect.Effect<boolean, AuthError>
  readonly getUserTools: (userId: number, interactionType: InteractionType) => Effect.Effect<readonly Tool[], ToolError>
}

export const IntegrationRegistry = Context.GenericTag<IntegrationRegistry>("@services/IntegrationRegistry")

const makeIntegrationRegistry = Effect.gen(function* () {
  const userRepository = yield* UserRepository
  const encryptionService = yield* EncryptionService

  // Cache для активных интеграций пользователей
  const userIntegrationsCache = yield* Cache.make({
    capacity: 1000,
    timeToLive: Duration.minutes(30),
    lookup: (userId: number) =>
      Effect.gen(function* () {
        const userIntegrations = yield* userRepository.getAllDecryptedIntegrations(userId)

        // Создаем сервисы интеграций для пользователя
        const services: IntegrationService[] = []

        for (const integration of userIntegrations) {
          const service = yield* createIntegrationService(integration)
          services.push(service)
        }

        return services
      })
  })

  // Registry для типов интеграций
  const integrationTypes = yield* Ref.make(new Map<string, () => IntegrationService>())

  const register = (name: string, factory: () => IntegrationService) =>
    Ref.update(integrationTypes, map => map.set(name, factory))

  const getUserIntegrations = (userId: number) =>
    userIntegrationsCache.get(userId)

  const getUserTools = (userId: number, interactionType: InteractionType) =>
    Effect.gen(function* () {
      const services = yield* getUserIntegrations(userId)
      const allTools: Tool[] = []

      for (const service of services) {
        const tools = yield* service.integration.getTools(interactionType)
        allTools.push(...tools)
      }

      return allTools
    })

  return IntegrationRegistry.of({
    register,
    get: (name: string) => /* implementation */,
    getUserIntegrations,
    authenticateUserIntegration: /* implementation */,
    getUserTools
  })
})

export const IntegrationRegistryLive = Layer.effect(IntegrationRegistry, makeIntegrationRegistry)
```

### 4. Пример: Yandex Calendar Integration

```typescript
// src/effect/integrations/yandex-calendar/service.ts
import { Effect, Context, Layer, Scope, Resource } from "effect"
import { createDAVClient } from "tsdav"

// Конфигурация специфичная для Yandex Calendar
export const YandexCalendarConfig = Schema.Struct({
  ...IntegrationConfig.fields,
  calendarUrl: Schema.String,
  username: Schema.String,
  password: Schema.String
})
export type YandexCalendarConfig = Schema.Schema.Type<typeof YandexCalendarConfig>

// Client как ресурс с автоматическим управлением
const makeCalendarClient = (config: YandexCalendarConfig) =>
  Resource.make(
    Effect.promise(() => createDAVClient({
      serverUrl: config.calendarUrl,
      credentials: {
        username: config.username,
        password: config.password
      },
      authMethod: "Basic"
    })),
    (client) => Effect.promise(() => client.disconnect?.() ?? Promise.resolve())
  )

// Yandex Calendar Integration Service
const makeYandexCalendarIntegration = (config: YandexCalendarConfig) =>
  Effect.gen(function* () {
    const client = yield* makeCalendarClient(config)

    // Tool metadata - статическая конфигурация
    const toolsMetadata = new Map<string, ToolMetadata>([
      ["getEvents", {
        name: "getEvents",
        permissions: { read: true, write: false },
        supportedInteractionTypes: ["TEXT", "VOICE"] as InteractionType[],
        progressMessage: "Проверяю календарь...",
        progressEmoji: "📅",
        description: "Получение событий из календаря"
      }],
      ["createEvent", {
        name: "createEvent",
        permissions: { read: false, write: true },
        supportedInteractionTypes: ["TEXT", "VOICE", "IMAGE", "FORWARD"] as InteractionType[],
        progressMessage: "Создаю событие...",
        progressEmoji: "📝",
        description: "Создание события в календаре"
      }]
    ])

    const authenticate = (credentials: IntegrationCredentials) =>
      Effect.gen(function* () {
        try {
          // Валидация учетных данных
          const validatedConfig = yield* Schema.decodeUnknown(YandexCalendarConfig)(credentials)

          // Тестовое подключение
          const testClient = yield* makeCalendarClient(validatedConfig)

          return true
        } catch {
          return false
        }
      })

    const getTools = (interactionType: InteractionType) =>
      Effect.gen(function* () {
        const availableTools: Tool[] = []

        for (const [toolName, metadata] of toolsMetadata) {
          if (metadata.supportedInteractionTypes.includes(interactionType)) {
            const tool = yield* createTool(toolName, metadata, client)
            availableTools.push(tool)
          }
        }

        return availableTools
      })

    const executeToolCall = (toolName: string, parameters: unknown) =>
      Effect.gen(function* () {
        switch (toolName) {
          case "getEvents":
            return yield* executeGetEvents(client, parameters)
          case "createEvent":
            return yield* executeCreateEvent(client, parameters)
          default:
            return yield* Effect.fail(new ToolError({
              toolName,
              message: `Unknown tool: ${toolName}`
            }))
        }
      })

    const getToolMetadata = (toolName: string) =>
      Effect.gen(function* () {
        const metadata = toolsMetadata.get(toolName)
        if (!metadata) {
          return yield* Effect.fail(new MetadataError({
            toolName,
            message: `Tool metadata not found: ${toolName}`
          }))
        }
        return metadata
      })

    const getProgressStep = (toolName: string) =>
      Effect.gen(function* () {
        const metadata = yield* getToolMetadata(toolName)
        return {
          type: "tool_call" as const,
          message: metadata.progressMessage,
          emoji: metadata.progressEmoji,
          metadata: {
            toolName,
            integration: config.name,
            permissions: metadata.permissions
          }
        }
      })

    const disconnect = Effect.succeed(void 0) // Ресурс управляется автоматически

    return {
      config,
      authenticate,
      getTools,
      executeToolCall,
      getToolMetadata,
      getProgressStep,
      disconnect
    } satisfies Integration
  })

// Layer для Yandex Calendar Integration
export const YandexCalendarIntegrationLive = (config: YandexCalendarConfig) =>
  Layer.scoped(
    Context.GenericTag<Integration>("YandexCalendarIntegration"),
    makeYandexCalendarIntegration(config)
  )

// Фабрика для создания сервиса интеграции
export const createYandexCalendarService = (credentials: IntegrationCredentials): Effect.Effect<IntegrationService, ValidationError> =>
  Effect.gen(function* () {
    const config = yield* Schema.decodeUnknown(YandexCalendarConfig)(credentials)
    const integration = yield* makeYandexCalendarIntegration(config)

    return {
      name: "YandexCalendar",
      integration
    }
  })
```

### 5. AI Agent Integration

```typescript
// src/effect/services/ai-agent.ts (обновленный)
import { Effect, Context, Layer } from "effect"
import { generateText } from "ai"

export interface AIAgent {
  readonly processMessage: (
    userId: number,
    content: string,
    interactionType: InteractionType,
    history: readonly string[]
  ) => Effect.Effect<GenerateTextResult, AIError>
}

const makeAIAgent = Effect.gen(function* () {
  const integrationRegistry = yield* IntegrationRegistry
  const messageHistory = yield* MessageHistory

  const processMessage = (
    userId: number,
    content: string,
    interactionType: InteractionType,
    history: readonly string[]
  ) =>
    Effect.gen(function* () {
      // Проверяем есть ли у пользователя интеграции
      const userIntegrations = yield* integrationRegistry.getUserIntegrations(userId)

      if (userIntegrations.length === 0) {
        return yield* Effect.fail(new AIError({
          message: "У пользователя нет активных интеграций"
        }))
      }

      // Получаем доступные инструменты для типа взаимодействия
      const tools = yield* integrationRegistry.getUserTools(userId, interactionType)

      // Формируем prompt
      const messages = yield* buildMessages(content, history)

      // Вызываем LLM
      const result = yield* Effect.promise(() =>
        generateText({
          model: openai("gpt-4"),
          messages,
          tools,
          maxToolRoundtrips: 1
        })
      )

      // Если LLM вызвал tool - выполняем его
      if (result.toolCalls && result.toolCalls.length > 0) {
        const toolCall = result.toolCalls[0]

        // Находим интеграцию, которая содержит этот tool
        const integration = yield* findIntegrationByTool(userIntegrations, toolCall.toolName)

        // Выполняем tool call
        const toolResult = yield* integration.executeToolCall(toolCall.toolName, toolCall.args)

        result.toolResults = [toolResult]
      }

      return result
    })

  return AIAgent.of({ processMessage })
})

export const AIAgentLive = Layer.effect(AIAgent, makeAIAgent)
```

## Преимущества новой архитектуры

### 1. Композиционность
- Легко добавлять новые интеграции
- Комбинировать интеграции в runtime
- Тестировать изолированно

### 2. Типобезопасность
- Валидация конфигураций через Schema
- Типизированные tool results
- Compile-time проверки

### 3. Resource Management
- Автоматическое управление подключениями
- Graceful shutdown
- Connection pooling через Cache

### 4. Testability
- Моки через Layer.succeed
- Изолированное тестирование каждого компонента
- Property-based testing

### 5. Performance
- Кеширование интеграций пользователей
- Lazy loading конфигураций
- Параллельное выполнение tool calls

## Пример добавления новой интеграции

```typescript
// 1. Создать схему конфигурации
const GoogleCalendarConfig = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
  refreshToken: Schema.String
})

// 2. Создать service factory
export const createGoogleCalendarService = (credentials: IntegrationCredentials) =>
  Effect.gen(function* () {
    const config = yield* Schema.decodeUnknown(GoogleCalendarConfig)(credentials)
    const integration = yield* makeGoogleCalendarIntegration(config)

    return {
      name: "GoogleCalendar",
      integration
    }
  })

// 3. Зарегистрировать в registry
const registerIntegrations = Effect.gen(function* () {
  const registry = yield* IntegrationRegistry

  yield* registry.register("YandexCalendar", createYandexCalendarService)
  yield* registry.register("GoogleCalendar", createGoogleCalendarService)
  yield* registry.register("Notion", createNotionService)
  // ...
})
```

## Workflow пользователя

1. **Добавление интеграции**:
   ```
   User -> Bot: /add_integration yandex_calendar
   Bot -> Registry: создает сервис интеграции
   Registry -> DB: сохраняет encrypted credentials
   ```

2. **Обработка сообщения**:
   ```
   User -> Bot: "создай встречу на завтра"
   Bot -> Registry: getUserTools(userId, "TEXT")
   Registry -> [Integration]: getTools("TEXT")
   Bot -> LLM: generateText(message, tools)
   LLM -> Bot: toolCall("createEvent", params)
   Bot -> Integration: executeToolCall("createEvent", params)
   ```

3. **Кеширование и производительность**:
   ```
   Registry кеширует активные интеграции пользователя на 30 минут
   Подключения к внешним API управляются через Resource
   Автоматический disconnect при завершении работы
   ```

Эта архитектура обеспечивает максимальную гибкость, типобезопасность и производительность при работе с интеграциями в Effect Framework.

<function_calls>
<invoke name="TodoWrite">
<parameter name="todos">[{"content": "\u041f\u0440\u043e\u0430\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0443 Effect", "status": "completed", "activeForm": "\u0410\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u044e \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0443 Effect"}, {"content": "\u0418\u0437\u0443\u0447\u0438\u0442\u044c \u0441\u0442\u0430\u0440\u0443\u044e \u0440\u0435\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044e \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0439 \u0447\u0435\u0440\u0435\u0437 \u043d\u0430\u0441\u043b\u0435\u0434\u043e\u0432\u0430\u043d\u0438\u0435", "status": "completed", "activeForm": "\u0418\u0437\u0443\u0447\u0430\u044e \u0441\u0442\u0430\u0440\u0443\u044e \u0440\u0435\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044e \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0439"}, {"content": "\u0421\u043f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0443 \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0439 \u043d\u0430 Effect", "status": "completed", "activeForm": "\u041f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u0443\u044e \u043d\u043e\u0432\u0443\u044e \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0443 \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0439"}, {"content": "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044e \u043d\u043e\u0432\u043e\u0439 \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u044b \u0432 MD \u0444\u0430\u0439\u043b\u0435", "status": "completed", "activeForm": "\u0421\u043e\u0437\u0434\u0430\u044e \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044e \u043d\u043e\u0432\u043e\u0439 \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u044b"}]