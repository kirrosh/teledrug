# План миграции TeleDrug на Effect Framework

## Обзор миграции

Данный документ описывает поэтапную миграцию текущего Telegram бота с классической архитектуры на Effect Framework. Миграция будет проходить итеративно, обеспечивая работоспособность системы на каждом этапе.

## Текущая архитектура

Согласно диаграмме классов, система состоит из 16 основных классов:

### Основные компоненты:
- **BotService** - точка входа приложения
- **TelegramBot** - обработка Telegram API
- **AIAgent** - взаимодействие с LLM
- **UserManager** - управление пользователями
- **Integration** - система интеграций (Яндекс Календарь)

### Вспомогательные компоненты:
- **EncryptionService** - шифрование данных
- **ConversationHistory** - история сообщений
- **ResponseManager** - управление ответами
- **UserRepository** - работа с БД

## Приоритизация компонентов для миграции

### Уровень 1: Утилиты и базовая инфраструктура
1. **EncryptionService** - независимый сервис
2. **ConversationHistory** - простое управление состоянием
3. **UserRepository** - доступ к данным
4. **UserConfigStorage** - кэширование

### Уровень 2: Основные сервисы
5. **UserManager** - управление пользователями
6. **TelegramBot** - базовый бот
7. **BotService** - точка входа

### Уровень 3: AI и интеграции
8. **Integration** (абстрактный)
9. **YandexCalendarIntegration**
10. **IntegrationRegistry**
11. **ChatContext**
12. **AIAgent**
13. **AIAgentFactory**

### Уровень 4: Дополнительные обработчики
14. **ResponseManager**
15. **CalendarSetupHandler**
16. **CalendarTestHandler**

## Effect Features для интеграции

### 1. Context (Dependency Injection)
**Применение:**
- Замена всех конструкторов с зависимостями
- Избавление от Map-кэшей экземпляров
- Автоматическое управление жизненным циклом

**Затрагиваемые классы:**
- `AIAgentFactory` - кэш агентов → Context
- `UserManager` - зависимость от storage → Context
- `BotService` - все зависимости → Context

**Преимущества:**
- Типобезопасное DI
- Автоматическая инъекция зависимостей
- Упрощение тестирования

### 2. Effect System
**Применение:**
- Все асинхронные операции
- Обработка ошибок
- Композиция операций

**Затрагиваемые операции:**
- Запросы к Telegram API
- Работа с базой данных
- Вызовы LLM API
- Операции с файловой системой

**Преимущества:**
- Декларативное описание эффектов
- Композиция и переиспользование
- Централизованная обработка ошибок

### 3. Schema/Data
**Применение:**
- Валидация входных данных
- Типобезопасность конфигураций
- Парсинг ответов API

**Затрагиваемые компоненты:**
- Все Config классы
- `ChatContext`
- Ответы внешних API

**Преимущества:**
- Runtime валидация
- Автоматическая генерация типов
- Centralized error handling

### 4. Layer System
**Применение:**
- Конфигурация приложения
- Управление зависимостями
- Environment-specific настройки

**Заменяет:**
- Ручное создание экземпляров в `BotService`
- Hardcoded конфигурации

**Преимущества:**
- Декларативная конфигурация
- Environment-based слои
- Композиция конфигураций

### 5. Resource Management
**Применение:**
- Управление подключениями
- Автоматическая очистка ресурсов
- Graceful shutdown

**Затрагиваемые ресурсы:**
- Telegram Bot соединение
- Подключения к БД
- HTTP клиенты для интеграций

**Преимущества:**
- Автоматический cleanup
- Безопасное завершение
- Resource pooling

### 6. EventBus/PubSub
**Применение:**
- Межкомпонентное взаимодействие
- Обновления прогресса
- Event-driven архитектура

**Заменяет:**
- Прямые вызовы в `ResponseManager`
- Callback-based обновления

**Преимущества:**
- Слабая связанность
- Масштабируемость
- Testability

## Итеративный план миграции

### Итерация 1: Минимальный бот на Effect (2-3 дня)

**Цель:** Запустить простейшего бота без AI и интеграций

**Компоненты для миграции:**
```typescript
// 1. EncryptionService → Effect Service
interface EncryptionService {
  readonly encrypt: (text: string) => Effect.Effect<string, EncryptionError>
  readonly decrypt: (encryptedText: string) => Effect.Effect<string, DecryptionError>
}

// 2. ConversationHistory → Effect Service с Context
interface ConversationHistory {
  readonly addUserMessage: (chatId: number, message: string) => Effect.Effect<void>
  readonly addAssistantMessage: (chatId: number, message: string) => Effect.Effect<void>
  readonly getHistory: (chatId: number) => Effect.Effect<string[]>
}

// 3. TelegramBot (упрощенная версия)
interface TelegramBot {
  readonly start: Effect.Effect<void, BotError>
  readonly stop: Effect.Effect<void, BotError>
  readonly handleUpdate: (update: Update) => Effect.Effect<void, BotError>
}

// 4. BotService → Effect Layer
const BotServiceLive = Layer.effect(
  BotService,
  Effect.gen(function* () {
    const bot = yield* TelegramBot
    const history = yield* ConversationHistory
    return BotService.of({ bot, history })
  })
)
```

**Результат:** Бот отвечает эхо-сообщениями

**Структура файлов:**
```
src/
  services/
    encryption.ts
    conversation-history.ts
    telegram-bot.ts
    bot-service.ts
  layers/
    main.ts
  index.ts (новая точка входа)
```

### Итерация 2: База данных (2-3 дня)

**Цель:** Добавить персистентность пользователей

**Компоненты для добавления:**
```typescript
// UserRepository с Effect + Schema
interface UserRepository {
  readonly getUser: (userId: number) => Effect.Effect<Option.Option<User>, DatabaseError>
  readonly createUser: (userData: CreateUserRequest) => Effect.Effect<User, DatabaseError>
  readonly updateUser: (userId: number, updates: UpdateUserRequest) => Effect.Effect<User, DatabaseError>
}

// UserConfigStorage с Resource Management
interface UserConfigStorage {
  readonly get: (userId: number) => Effect.Effect<Option.Option<UserConfig>, StorageError>
  readonly save: (config: UserConfig) => Effect.Effect<void, StorageError>
  readonly invalidate: (userId: number) => Effect.Effect<void>
}

// Schema для валидации
const UserConfigSchema = Schema.Struct({
  userId: Schema.Number,
  username: Schema.String,
  integrations: Schema.Array(UserIntegrationConfigSchema),
  aiSettings: AISettingsSchema,
  preferences: Schema.Record(Schema.String, Schema.Unknown)
})
```

**Результат:** Бот сохраняет информацию о пользователях

### Итерация 3: AI интеграция (3-4 дня)

**Цель:** Добавить обработку сообщений через LLM

**Компоненты для добавления:**
```typescript
// ChatContext с Schema + валидация
const ChatContextSchema = Schema.Struct({
  interactionType: Schema.Literal("TEXT", "VOICE", "IMAGE", "FORWARD"),
  userId: Schema.Number,
  chatId: Schema.Number,
  messageContent: Schema.String,
  mediaContent: Schema.Optional(Schema.Unknown),
  metadata: Schema.Optional(Schema.Record(Schema.String, Schema.Unknown))
})

// AIAgent как Effect Service
interface AIAgent {
  readonly processMessage: (
    context: ChatContext,
    history: readonly string[]
  ) => Effect.Effect<GenerateTextResult, AIError>
}

// AIAgentFactory с Context
interface AIAgentFactory {
  readonly getOrCreateAgent: (userId: number) => Effect.Effect<AIAgent, FactoryError>
  readonly refreshAgent: (userId: number) => Effect.Effect<AIAgent, FactoryError>
}
```

**Результат:** Бот отвечает через AI без инструментов

### Итерация 4: Система интеграций (4-5 дней)

**Цель:** Добавить календарь и другие интеграции

**Компоненты для добавления:**
```typescript
// Integration как Effect abstraction
interface Integration {
  readonly authenticate: (credentials: IntegrationCredentials) => Effect.Effect<boolean, AuthError>
  readonly getTools: () => Effect.Effect<readonly IntegrationTool[], IntegrationError>
  readonly executeToolCall: (toolName: string, parameters: unknown) => Effect.Effect<ToolResult, ToolError>
}

// IntegrationRegistry с типобезопасностью
interface IntegrationRegistry {
  readonly register: <T extends Integration>(name: string, integration: T) => Effect.Effect<void>
  readonly get: (name: string) => Effect.Effect<Option.Option<Integration>, RegistryError>
  readonly getAll: () => Effect.Effect<ReadonlyMap<string, Integration>>
}

// YandexCalendarIntegration
const YandexCalendarIntegration = Integration.make({
  name: "yandex-calendar",
  authenticate: (credentials) => Effect.gen(function* () {
    // OAuth flow
  }),
  getTools: () => Effect.succeed([
    createEventTool,
    getEventsTool,
    updateEventTool,
    deleteEventTool
  ])
})
```

**Результат:** Бот работает с календарем через AI инструменты

### Итерация 5: Продвинутые фичи (3-4 дня)

**Цель:** Добавить прогресс обработки и дополнительные обработчики

**Компоненты для добавления:**
```typescript
// ResponseManager с EventBus
interface ResponseManager {
  readonly startProgress: (chatId: number, step: ProgressStep) => Effect.Effect<void>
  readonly updateProgress: (chatId: number, step: ProgressStep) => Effect.Effect<void>
  readonly finishProgress: (chatId: number, result: string) => Effect.Effect<void>
}

// Event system
type BotEvent =
  | { _tag: "ProgressStarted"; chatId: number; step: ProgressStep }
  | { _tag: "ProgressUpdated"; chatId: number; step: ProgressStep }
  | { _tag: "ProgressFinished"; chatId: number; result: string }

const EventBus = Context.GenericTag<EventBus.EventBus<BotEvent>>("EventBus")
```

**Результат:** Полнофункциональный бот с прогрессом

## Ключевые архитектурные изменения

### 1. От классов к сервисам
**Было:**
```typescript
class UserManager {
  private userConfigStorage: UserConfigStorage

  constructor() {
    this.userConfigStorage = new UserConfigStorage()
  }
}
```

**Стало:**
```typescript
interface UserManager {
  readonly getOrCreateUser: (userId: number, username: string) => Effect.Effect<UserConfig, UserManagerError>
}

const UserManagerLive = Layer.effect(
  UserManager,
  Effect.gen(function* () {
    const storage = yield* UserConfigStorage
    const repository = yield* UserRepository

    return UserManager.of({ storage, repository })
  })
)
```

### 2. От конструкторов к Context
**Было:**
```typescript
const aiAgentFactory = new AIAgentFactory(userManager, openaiApiKey)
const botService = new BotService(telegramBot, aiAgentFactory, ...)
```

**Стало:**
```typescript
const MainLayer = Layer.mergeAll(
  UserManagerLive,
  AIAgentFactoryLive,
  TelegramBotLive,
  BotServiceLive
)

const program = Effect.gen(function* () {
  const botService = yield* BotService
  yield* botService.start
}).pipe(Effect.provide(MainLayer))
```

### 3. От callback к Effect
**Было:**
```typescript
async handleMessage(ctx, text, history) {
  try {
    const result = await this.aiAgent.processMessage(...)
    await ctx.reply(result.text)
  } catch (error) {
    await ctx.reply("Произошла ошибка")
  }
}
```

**Стало:**
```typescript
const handleMessage = (ctx: Context, text: string, history: readonly string[]) =>
  Effect.gen(function* () {
    const aiAgent = yield* AIAgent
    const chatContext = ChatContext.make({ text, userId: ctx.from.id })
    const result = yield* aiAgent.processMessage(chatContext, history)
    yield* Effect.promise(() => ctx.reply(result.text))
  }).pipe(
    Effect.catchAll(error =>
      Effect.promise(() => ctx.reply("Произошла ошибка"))
    )
  )
```

## Риски и митigation

### 1. Сложность изучения Effect
**Риск:** Команда может не освоить Effect быстро
**Митigation:**
- Поэтапная миграция
- Документация паттернов
- Code review процесс

### 2. Performance impact
**Риск:** Effect может быть медленнее текущего решения
**Митigation:**
- Бенчмарки на каждой итерации
- Профилирование критических путей
- Откат к предыдущей версии при необходимости

### 3. Bundle size
**Риск:** Effect может увеличить размер приложения
**Митigation:**
- Tree-shaking оптимизация
- Selective imports
- Bundle analysis

### 4. Ecosystem compatibility
**Риск:** Конфликты с существующими библиотеками
**Митigation:**
- Постепенная замена библиотек
- Effect-compatible обертки
- Тестирование интеграций

## Критерии успеха

### Техническические метрики:
- [ ] Время ответа бота < 2 сек (было < 1.5 сек)
- [ ] Покрытие тестами > 80%
- [ ] Отсутствие memory leaks
- [ ] Graceful shutdown < 10 сек

### Функциональные требования:
- [ ] Все существующие фичи работают
- [ ] Новые интеграции легко добавляются
- [ ] Конфигурация через environment variables
- [ ] Логирование и мониторинг

### Developer Experience:
- [ ] Типобезопасность во всех компонентах
- [ ] Простота добавления новых фич
- [ ] Читаемость кода
- [ ] Документированные паттерны

## Timeline

**Общий срок:** 14-19 дней (3-4 недели)

- **Итерация 1:** 2-3 дня
- **Итерация 2:** 2-3 дня
- **Итерация 3:** 3-4 дня
- **Итерация 4:** 4-5 дней
- **Итерация 5:** 3-4 дня

**Буферное время:** +20% на непредвиденные сложности

## Следующие шаги

1. [ ] Ревью плана командой
2. [ ] Setup Effect зависимостей
3. [ ] Создание базовой структуры проекта
4. [ ] Начало Итерации 1
5. [ ] Настройка CI/CD для новой архитектуры

## Заключение

Миграция на Effect Framework позволит создать более надежную, масштабируемую и maintainable архитектуру. Итеративный подход обеспечит стабильность системы на каждом этапе и позволит команде постепенно освоить новые концепции.