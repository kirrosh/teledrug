# Диаграмма классов TypeScript приложения

## Основная архитектура

```mermaid
classDiagram
    %% Основные сервисы
    class BotService {
        -telegramBot: TelegramBot
        -userManager: UserManager
        -aiAgentFactory: AIAgentFactory
        -responseManager: ResponseManager
        -telegramToken: string
        +constructor(config: BotServiceConfig)
        +start(): Promise~void~
        +stop(): Promise~void~
        -handleTextMessage(ctx, text, history): Promise~void~
        -handleVoiceMessage(ctx, audio, history): Promise~void~
        -handlePhotoMessage(ctx, photos, history): Promise~void~
        -handleForwardMessage(ctx, message, history): Promise~void~
        -registerIntegrations(): void
        -setupHandlers(): void
    }

    class TelegramBot {
        -bot: Bot
        -handlers: Partial~MessageHandlers~
        -conversationHistory: ConversationHistory
        -calendarSetup: CalendarSetupHandler
        -calendarTest: CalendarTestHandler
        -chatMessages: Map~number, number[]~
        -ensureUserCallback: Function
        -availableIntegrations: Integration[]
        -fileCache: Map~string, Buffer~
        +constructor(config: TelegramBotConfig)
        +start(): Promise~void~
        +stop(): Promise~void~
        +setHandlers(handlers): void
        +setEnsureUserCallback(callback): void
        +setUserManager(userManager): void
        -handleText(ctx, text, history): Promise~void~
        -handleVoice(ctx, audio, history): Promise~void~
        -handlePhoto(ctx, photos, history): Promise~void~
        -handleForward(ctx, message, history): Promise~void~
        -createChatContext(ctx, type, content): ChatContext
        -processWithAI(chatContext, ctx, history): Promise~void~
    }

    class AIAgent {
        -config: AIAgentConfig
        -integrations: Integration[]
        +constructor(config: AIAgentConfig, integrations: Integration[])
        +processMessage(chatContext: ChatContext, history, progressCallback): Promise~GenerateTextResult~
        +chat(userMessage: string, history): Promise~GenerateTextResult~
        +chatWithProgress(userMessage: string, history, progressCallback): Promise~GenerateTextResult~
        +getIntegrations(): Integration[]
        -selectModel(interactionType): Model
        -buildSystemPrompt(chatContext): string
    }

    class AIAgentFactory {
        -userManager: UserManager
        -openaiApiKey: string
        -agents: Map~string|number, AIAgent~
        +constructor(userManager: UserManager, openaiApiKey: string)
        +getOrCreateAgent(userId): Promise~AIAgent~
        +refreshAgent(userId): Promise~AIAgent~
        +clearCache(): void
        +getIntegrationsForUser(userId): Promise~Integration[]~
    }

    %% Управление пользователями
    class UserManager {
        -userConfigStorage: UserConfigStorage
        -userIntegrations: Map~string|number, Integration[]~
        +constructor()
        +getOrCreateUser(userId, username): Promise~UserConfig~
        +getUserIntegrations(userId): Promise~Integration[]~
        +addUserIntegration(userId, name, credentials): Promise~void~
        +removeUserIntegration(userId, name): Promise~void~
        +getUserConfig(userId): Promise~UserConfig~
        +updateUserConfig(userId, updates): Promise~void~
    }

    class UserConfigStorage {
        -userRepository: UserRepository
        -configCache: Map~string|number, UserConfig~
        +get(userId): Promise~UserConfig~
        +save(config: UserConfig): Promise~void~
        +update(userId, updates): Promise~void~
        +addIntegration(userId, integration): Promise~void~
        +removeIntegration(userId, name): Promise~void~
        +createDefaultConfig(userId, username): Promise~UserConfig~
    }

    class UserRepository {
        +getUser(userId): Promise~User~
        +getOrCreateUser(userId, username): Promise~User~
        +addIntegration(userId, type, credentials, settings): Promise~void~
        +removeIntegration(userId, type): Promise~void~
        +getAllDecryptedIntegrations(userId): Promise~UserIntegration[]~
    }

    %% Контекст и управление ответами
    class ChatContext {
        -interactionType: InteractionType
        -userId: string|number
        -chatId: string|number
        -messageContent: string
        -mediaContent: any
        -metadata: any
        -availableIntegrations: Integration[]
        +constructor(config: ChatContextConfig)
        +getAvailableTools(): Record~string, Tool~
        +buildMessages(systemPrompt, history): ModelMessage[]
        +getInteractionType(): InteractionType
        +getUserId(): string|number
        +getMessageContent(): string
        +getMediaContent(): any
        +getMetadata(): any
        +updateMessageContent(content): void
        -isToolAvailable(integration, toolName): boolean
        -buildCurrentMessage(): ModelMessage
    }

    class ResponseManager {
        -activeResponses: Map~number, ResponseData~
        -MIN_UPDATE_DELAY: number
        +startProgress(ctx, initialStep): Promise~void~
        +updateProgress(ctx, step): Promise~void~
        +finishProgress(ctx, finalResult): Promise~number~
        +cleanup(): void
    }

    %% Интеграции
    class Integration {
        <<abstract>>
        #config: IntegrationConfig
        #credentials: IntegrationCredentials
        #isAuthenticated: boolean
        #toolsMetadata: Map~string, ToolMetadata~
        #currentMessageContext: any
        +constructor(config: IntegrationConfig)
        +authenticate(credentials): Promise~boolean~
        +getTools(): IntegrationTool[]
        +formatToolResult(toolName, result): string
        +disconnect(): Promise~void~
        +getName(): string
        +getDescription(): string
        +isConnected(): boolean
        +initialize(credentials): Promise~void~
        +setMessageContext(context): void
        +getToolMetadata(toolName): ToolMetadata
        +getProgressStep(toolName): ProgressStep
        #initializeToolsMetadata(): void
    }

    class YandexCalendarIntegration {
        +constructor()
        +authenticate(credentials): Promise~boolean~
        +getTools(): IntegrationTool[]
        +formatToolResult(toolName, result): string
        +disconnect(): Promise~void~
        -createEventTool(): Tool
        -getEventsTool(): Tool
        -updateEventTool(): Tool
        -deleteEventTool(): Tool
        -initializeToolsMetadata(): void
    }

    class IntegrationRegistry {
        -integrations: Map~string, IntegrationClass~
        +register(name: string, integrationClass): void
        +get(name: string): IntegrationClass
        +getAll(): Map~string, IntegrationClass~
    }

    %% Обработчики
    class CalendarSetupHandler {
        -userManager: UserManager
        -setupSessions: Map~number, SetupSession~
        +constructor()
        +setUserManager(userManager): void
        +handleAddYandexCalendar(ctx): Promise~void~
        +handleUserMessage(ctx, text): Promise~boolean~
        +isInSetupSession(userId): boolean
    }

    class CalendarTestHandler {
        +constructor()
        +handleTestCalendarCommand(ctx): Promise~void~
    }

    %% Модули
    class ConversationHistory {
        -histories: Map~number, string[]~
        +addUserMessage(chatId, message): void
        +addAssistantMessage(chatId, message): void
        +getHistory(chatId): string[]
        +clearHistory(chatId): void
        +getHistoryLength(chatId): number
    }

    %% Безопасность
    class EncryptionService {
        -algorithm: string
        -key: Buffer
        +constructor()
        +encrypt(text: string): string
        +decrypt(encryptedText: string): string
        +generateKey(): Buffer
    }

    %% Связи между классами
    BotService --> TelegramBot : uses
    BotService --> UserManager : uses
    BotService --> AIAgentFactory : uses
    BotService --> ResponseManager : uses
    BotService --> IntegrationRegistry : uses

    TelegramBot --> ConversationHistory : uses
    TelegramBot --> CalendarSetupHandler : uses
    TelegramBot --> CalendarTestHandler : uses
    TelegramBot --> ChatContext : creates

    AIAgentFactory --> AIAgent : creates
    AIAgentFactory --> UserManager : uses

    AIAgent --> Integration : uses
    AIAgent --> ChatContext : uses

    UserManager --> UserConfigStorage : uses
    UserConfigStorage --> UserRepository : uses
    UserRepository --> EncryptionService : uses

    ChatContext --> Integration : uses
    ResponseManager --> TelegramBot : updates

    YandexCalendarIntegration --|> Integration : extends
    IntegrationRegistry --> Integration : manages

    CalendarSetupHandler --> UserManager : uses
```

## Типы взаимодействий

```mermaid
enumeration InteractionType {
    TEXT
    VOICE
    IMAGE
    FORWARD
}
```

## Конфигурации

```mermaid
classDiagram
    class BotServiceConfig {
        +telegramToken: string
        +openaiApiKey: string
    }

    class TelegramBotConfig {
        +token: string
    }

    class AIAgentConfig {
        +openaiApiKey: string
        +model: string
        +temperature: number
        +userId: string|number
    }

    class IntegrationConfig {
        +name: string
        +description: string
        +version: string
    }

    class UserConfig {
        +userId: string|number
        +username: string
        +integrations: UserIntegrationConfig[]
        +aiSettings: AISettings
        +preferences: Record~string, any~
    }

    class UserIntegrationConfig {
        +name: string
        +credentials: Record~string, any~
        +enabled: boolean
        +settings: Record~string, any~
    }

    class ChatContextConfig {
        +interactionType: InteractionType
        +userId: string|number
        +chatId: string|number
        +messageContent: string
        +mediaContent: any
        +metadata: any
        +integrations: Integration[]
    }
```

## Основные паттерны архитектуры

1. **Factory Pattern**: `AIAgentFactory` создает AI агентов с нужными интеграциями
2. **Registry Pattern**: `IntegrationRegistry` управляет доступными интеграциями
3. **Strategy Pattern**: Разные типы взаимодействий обрабатываются по-разному
4. **Observer Pattern**: `ResponseManager` отслеживает прогресс обработки
5. **Repository Pattern**: `UserRepository` абстрагирует работу с базой данных
6. **Template Method**: `Integration` определяет общий интерфейс для всех интеграций

## Поток обработки сообщений

1. `TelegramBot` получает сообщение
2. Создается `ChatContext` с контекстом сообщения
3. `BotService` получает AI агента через `AIAgentFactory`
4. `AIAgent` обрабатывает сообщение с помощью доступных интеграций
5. `ResponseManager` показывает прогресс пользователю
6. Результат отправляется обратно через `TelegramBot`
