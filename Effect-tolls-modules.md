Отличная работа с архитектурой! Давай проведу ревью и отвечу на твои вопросы, а затем предложу более совершенную архитектуру.

## Ревью текущей архитектуры

### Сильные стороны:

✅ Правильное использование Effect паттернов (Layer, Context, Resource)
✅ Хорошая типобезопасность через Schema
✅ Грамотное управление ресурсами
✅ Кеширование и оптимизация производительности

### Проблемы:

1. **Tight coupling** между интеграцией и инструментами
2. **Отсутствие модульности** - инструменты не могут существовать отдельно
3. **Дублирование логики** форматирования в каждой интеграции
4. **Сложность тестирования** отдельных инструментов

## Ответы на вопросы

### 1. Про отдельный слой для интеграций

Да, правильно понимаешь. Каждая интеграция должна быть отдельным Layer. Но предлагаю пойти дальше - сделать **композицию слоев**:

```typescript
// Композиция слоев для интеграции
const YandexCalendarLayer =
  AuthenticationLayer >+>      // Слой авторизации
  ToolsLayer >+>               // Слой инструментов
  FormatterLayer >+>           // Слой форматирования
  IntegrationLayer            // Основной слой интеграции
```

### 2. Доступ к конфигу пользователя

Да, через Dependency Injection. Но лучше сделать это явным:

```typescript
export interface UserContext {
  readonly userId: number;
  readonly credentials: IntegrationCredentials;
  readonly preferences: UserPreferences;
}

export const UserContext = Context.GenericTag<UserContext>(
  "@services/UserContext"
);
```

### 3. Локализация интеграций

Предлагаю **Module Pattern** - каждая интеграция как самодостаточный модуль.

## Улучшенная архитектура

### 1. Tool как отдельная сущность Effect

```typescript
// src/effect/core/tool.ts
import { Effect, Context, Data, Schema } from "effect";
import { Tool as AITool } from "ai";

// Tool Configuration Schema
export const ToolConfig = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.Unknown),
  permissions: Schema.Struct({
    read: Schema.Boolean,
    write: Schema.Boolean,
  }),
  supportedInteractionTypes: Schema.Array(InteractionType),
});

// Tool Service - отдельная сущность
export interface ToolService<TParams = unknown, TResult = unknown> {
  readonly config: ToolConfig;
  readonly execute: (params: TParams) => Effect.Effect<TResult, ToolError>;
  readonly format: (result: TResult) => Effect.Effect<string, FormatError>;
  readonly toAITool: () => Effect.Effect<AITool, Never>;
  readonly progress: ProgressStep;
}

// Generic Tool Context Tag
export interface Tool<TParams = unknown, TResult = unknown> {
  readonly _tag: unique symbol;
}

export const Tool = <TParams = unknown, TResult = unknown>(
  tag: string
): Context.Tag<Tool<TParams, TResult>, ToolService<TParams, TResult>> =>
  Context.GenericTag<ToolService<TParams, TResult>>(`@tools/${tag}`);

// Tool Factory
export const makeTool = <TParams, TResult>(
  config: ToolConfig,
  execute: (
    params: TParams,
    auth: AuthContext
  ) => Effect.Effect<TResult, ToolError>,
  format: (result: TResult) => string
) =>
  Effect.gen(function* () {
    // Получаем контекст авторизации из слоя
    const auth = yield* AuthContext;

    return {
      config,
      execute: (params: TParams) => execute(params, auth),
      format: (result: TResult) => Effect.succeed(format(result)),
      toAITool: () =>
        Effect.succeed({
          name: config.name,
          description: config.description,
          parameters: config.parameters,
          execute: async (params) => {
            const result = await Effect.runPromise(
              execute(params as TParams, auth)
            );
            return format(result);
          },
        }),
      progress: {
        type: "tool_call" as const,
        message: `Executing ${config.name}...`,
        emoji: "⚡",
      },
    } satisfies ToolService<TParams, TResult>;
  });
```

### 2. Authentication как отдельный слой

```typescript
// src/effect/core/authentication.ts
export interface AuthContext {
  readonly credentials: IntegrationCredentials;
  readonly isAuthenticated: boolean;
  readonly refresh: () => Effect.Effect<void, AuthError>;
}

export const AuthContext = Context.GenericTag<AuthContext>("@auth/Context");

// Authentication Provider для каждой интеграции
export const makeAuthProvider =
  <TCredentials>(
    validate: (credentials: TCredentials) => Effect.Effect<boolean, AuthError>,
    refresh?: (
      credentials: TCredentials
    ) => Effect.Effect<TCredentials, AuthError>
  ) =>
  (credentials: TCredentials) =>
    Layer.effect(
      AuthContext,
      Effect.gen(function* () {
        const isAuthenticated = yield* validate(credentials);

        return {
          credentials,
          isAuthenticated,
          refresh: refresh
            ? () => Effect.flatMap(refresh(credentials), validate)
            : () => Effect.succeed(void 0),
        };
      })
    );
```

### 3. Integration Module Pattern

```typescript
// src/effect/integrations/yandex-calendar/index.ts

// 1. Authentication Layer
const YandexAuthLayer = makeAuthProvider<YandexCredentials>(
  (creds) => Effect.gen(function* () {
    const client = yield* createDAVClient(creds)
    return yield* client.login()
  })
)

// 2. Individual Tool Layers
const GetEventsToolTag = Tool<GetEventsParams, CalendarEvent[]>("yandex-calendar/get-events")

const GetEventsToolLayer = Layer.effect(
  GetEventsToolTag,
  makeTool(
    {
      name: "getEvents",
      description: "Get calendar events",
      parameters: GetEventsSchema,
      permissions: { read: true, write: false },
      supportedInteractionTypes: ["TEXT", "VOICE"]
    },
    (params, auth) => Effect.gen(function* () {
      const client = yield* getAuthenticatedClient(auth)
      return yield* client.getEvents(params)
    }),
    (events) => events.map(e => `${e.title} at ${e.date}`).join("\n")
  )
)

const CreateEventToolTag = Tool<CreateEventParams, CalendarEvent>("yandex-calendar/create-event")

const CreateEventToolLayer = Layer.effect(
  CreateEventToolTag,
  makeTool(
    {
      name: "createEvent",
      description: "Create calendar event",
      parameters: CreateEventSchema,
      permissions: { read: false, write: true },
      supportedInteractionTypes: ["TEXT", "VOICE", "IMAGE", "FORWARD"]
    },
    (params, auth) => Effect.gen(function* () {
      const client = yield* getAuthenticatedClient(auth)
      return yield* client.createEvent(params)
    }),
    (event) => `Event "${event.title}" created for ${event.date}`
  )
)

// 3. Tool Registry для интеграции
export interface YandexCalendarTools {
  readonly getEvents: ToolService<GetEventsParams, CalendarEvent[]>
  readonly createEvent: ToolService<CreateEventParams, CalendarEvent>
}

const YandexCalendarToolsTag = Context.GenericTag<YandexCalendarTools>("@yandex-calendar/Tools")

const YandexCalendarToolsLayer = Layer.effect(
  YandexCalendarToolsTag,
  Effect.gen(function* () {
    const getEvents = yield* GetEventsToolTag
    const createEvent = yield* CreateEventToolTag

    return { getEvents, createEvent }
  })
)

// 4. Integration Facade
export interface YandexCalendarIntegration {
  readonly name: string
  readonly version: string
  readonly authenticate: (credentials: YandexCredentials) => Effect.Effect<boolean, AuthError>
  readonly getTools: (interactionType: InteractionType) => Effect.Effect<readonly AITool[], Never>
  readonly executeToolCall: (toolName: string, params: unknown) => Effect.Effect<string, ToolError>
}

const YandexCalendarIntegrationTag = Context.GenericTag<YandexCalendarIntegration>("@integrations/YandexCalendar")

const YandexCalendarIntegrationLayer = Layer.effect(
  YandexCalendarIntegrationTag,
  Effect.gen(function* () {
    const tools = yield* YandexCalendarToolsTag
    const auth = yield* AuthContext

    return {
      name: "YandexCalendar",
      version: "1.0.0",

      authenticate: (credentials) => validateCredentials(credentials),

      getTools: (interactionType) => Effect.gen(function* () {
        const availableTools: AITool[] = []

        for (const [name, tool] of Object.entries(tools)) {
          if (tool.config.supportedInteractionTypes.includes(interactionType)) {
            availableTools.push(yield* tool.toAITool())
          }
        }

        return availableTools
      }),

      executeToolCall: (toolName, params) => Effect.gen(function* () {
        const tool = tools[toolName as keyof YandexCalendarTools]
        if (!tool) {
          return yield* Effect.fail(new ToolError({ toolName, message: "Tool not found" }))
        }

        const result = yield* tool.execute(params)
        return yield* tool.format(result)
      })
    }
  })
)

// 5. Композиция всех слоев
export const YandexCalendarModule = (credentials: YandexCredentials) =>
  YandexAuthLayer(credentials) >+>
  GetEventsToolLayer >+>
  CreateEventToolLayer >+>
  YandexCalendarToolsLayer >+>
  YandexCalendarIntegrationLayer

// 6. Export публичного API модуля
export {
  YandexCalendarIntegrationTag as YandexCalendar,
  type YandexCalendarIntegration,
  type YandexCredentials
}
```

### 4. Tool Formatter как отдельный сервис

```typescript
// src/effect/core/formatter.ts
export interface FormatterService {
  readonly format: <T>(
    data: T,
    template: FormatterTemplate
  ) => Effect.Effect<string, FormatError>;

  readonly formatForLLM: <T>(
    data: T,
    interactionType: InteractionType
  ) => Effect.Effect<string, FormatError>;

  readonly formatProgress: (
    step: ProgressStep,
    locale: string
  ) => Effect.Effect<string, FormatError>;
}

export const FormatterService = Context.GenericTag<FormatterService>(
  "@services/Formatter"
);

// Formatter Templates
export interface FormatterTemplate {
  readonly type: "text" | "markdown" | "html" | "json";
  readonly locale: string;
  readonly style: "verbose" | "concise" | "technical";
}

// LLM-specific formatters
const makeFormatterService = Effect.gen(function* () {
  const userContext = yield* UserContext;

  return {
    format: (data, template) =>
      Effect.gen(function* () {
        switch (template.type) {
          case "markdown":
            return formatAsMarkdown(data, template);
          case "json":
            return JSON.stringify(data, null, 2);
          default:
            return String(data);
        }
      }),

    formatForLLM: (data, interactionType) =>
      Effect.gen(function* () {
        switch (interactionType) {
          case "VOICE":
            return formatForVoice(data);
          case "IMAGE":
            return formatWithVisualContext(data);
          default:
            return formatAsText(data);
        }
      }),

    formatProgress: (step, locale) =>
      Effect.succeed(localizeProgress(step, locale)),
  };
});
```

### 5. Integration Registry с новой архитектурой

```typescript
// src/effect/services/integration-registry-v2.ts
export interface IntegrationRegistryV2 {
  readonly registerModule: <TIntegration>(
    name: string,
    module: Layer.Layer<TIntegration, IntegrationError, UserContext>
  ) => Effect.Effect<void>;

  readonly loadUserIntegration: <TIntegration>(
    userId: number,
    integrationName: string
  ) => Effect.Effect<TIntegration, LoadError>;

  readonly getUserTools: (
    userId: number,
    interactionType: InteractionType
  ) => Effect.Effect<readonly AITool[], ToolError>;
}

const makeIntegrationRegistryV2 = Effect.gen(function* () {
  // Registry модулей интеграций
  const modules = new Map<string, Layer.Layer<any, any, any>>();

  // Cache активных интеграций пользователей
  const userIntegrationsCache = yield* Cache.make({
    capacity: 1000,
    timeToLive: Duration.minutes(30),
    lookup: (key: string) => loadIntegrationForUser(key),
  });

  const registerModule = (name: string, module: Layer.Layer<any, any, any>) =>
    Effect.sync(() => {
      modules.set(name, module);
    });

  const loadUserIntegration = (userId: number, integrationName: string) =>
    Effect.gen(function* () {
      const module = modules.get(integrationName);
      if (!module) {
        return yield* Effect.fail(
          new LoadError({ message: `Integration ${integrationName} not found` })
        );
      }

      // Получаем credentials пользователя
      const userCredentials = yield* getUserCredentials(
        userId,
        integrationName
      );

      // Создаем UserContext Layer
      const userContextLayer = Layer.succeed(UserContext, {
        userId,
        credentials: userCredentials,
        preferences: yield* getUserPreferences(userId),
      });

      // Композируем слои
      const integrationLayer = userContextLayer >>> module;

      // Создаем runtime с интеграцией
      const runtime = yield* Layer.toRuntime(integrationLayer);

      // Возвращаем сервис интеграции
      return yield* Runtime.runPromise(runtime)(Effect.succeed(void 0));
    });

  return {
    registerModule,
    loadUserIntegration,
    getUserTools: (userId, interactionType) =>
      Effect.gen(function* () {
        const userIntegrations = yield* getUserIntegrations(userId);
        const allTools: AITool[] = [];

        for (const integration of userIntegrations) {
          const tools = yield* integration.getTools(interactionType);
          allTools.push(...tools);
        }

        return allTools;
      }),
  };
});
```

### 6. Использование новой архитектуры

```typescript
// src/app/integrations/setup.ts

// Регистрация модулей интеграций
const setupIntegrations = Effect.gen(function* () {
  const registry = yield* IntegrationRegistryV2;

  // Регистрируем модули
  yield* registry.registerModule("YandexCalendar", YandexCalendarModule);
  yield* registry.registerModule("GoogleCalendar", GoogleCalendarModule);
  yield* registry.registerModule("Notion", NotionModule);
  yield* registry.registerModule("Todoist", TodoistModule);
});

// Использование в AI Agent
const processWithTools = (userId: number, message: string) =>
  Effect.gen(function* () {
    const registry = yield* IntegrationRegistryV2;

    // Получаем tools для пользователя
    const tools = yield* registry.getUserTools(userId, "TEXT");

    // Вызываем LLM с tools
    const result = yield* generateText({
      model: openai("gpt-4"),
      messages: [{ role: "user", content: message }],
      tools,
    });

    // Если есть tool calls - выполняем
    if (result.toolCalls?.length > 0) {
      for (const call of result.toolCalls) {
        // Находим интеграцию по имени tool
        const integrationName = extractIntegrationName(call.toolName);
        const integration = yield* registry.loadUserIntegration(
          userId,
          integrationName
        );

        // Выполняем tool call
        const toolResult = yield* integration.executeToolCall(
          call.toolName,
          call.args
        );

        // Форматируем результат
        const formatter = yield* FormatterService;
        const formatted = yield* formatter.formatForLLM(toolResult, "TEXT");

        result.toolResults.push(formatted);
      }
    }

    return result;
  });
```

## Преимущества улучшенной архитектуры

### 1. **Полная модульность**

- Инструменты существуют отдельно от интеграций
- Каждый инструмент - самостоятельный сервис
- Легко переиспользовать инструменты между интеграциями

### 2. **Разделение ответственности**

- Authentication - отдельный слой
- Formatting - отдельный сервис
- Tools - независимые сущности
- Integration - только фасад

### 3. **Лучшая тестируемость**

```typescript
// Тестирование отдельного инструмента
test("GetEvents tool", () =>
  Effect.gen(function* () {
    const tool = yield* pipe(
      GetEventsToolLayer,
      Layer.provide(TestAuthLayer),
      Layer.build
    );

    const result = yield* tool.execute({ date: "2024-01-01" });
    expect(result).toHaveLength(3);
  }));
```

### 4. **Гибкость композиции**

```typescript
// Создание кастомной интеграции из существующих tools
const CustomCalendarIntegration =
  YandexAuthLayer >+>
  GetEventsToolLayer >+>       // из Yandex
  CreateEventToolLayer >+>      // из Google
  CustomFormatterLayer >+>      // свой formatter
  IntegrationFacadeLayer
```

### 5. **Type-safe Tool Composition**

```typescript
// Типобезопасная композиция tools
const composeTools = <A, B>(
  tool1: ToolService<A, any>,
  tool2: ToolService<B, any>
) =>
  Effect.gen(function* () {
    const result1 = yield* tool1.execute(params1);
    const result2 = yield* tool2.execute(params2);
    return combine(result1, result2);
  });
```

Эта архитектура обеспечивает максимальную гибкость, модульность и переиспользование кода, при этом сохраняя все преимущества Effect Framework.
