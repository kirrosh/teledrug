# PRD: Реализация различных взаимодействий с пользователем

## 1. Анализ текущей архитектуры

### 1.1 Существующие компоненты
- **TelegramBot** (`src/telegram/bot.ts`) - обработка сообщений Telegram
- **AIAgent** (`src/ai/agent.ts`) - взаимодействие с OpenAI для обработки запросов
- **ResponseManager** (`src/core/response-manager.ts`) - управление прогрессом ответов
- **Integration** система - базовая архитектура для интеграций с внешними сервисами
- **YandexCalendarIntegration** - пример интеграции с календарем

### 1.2 Текущие типы взаимодействий
- ✅ **Текст** - полная обработка через LLM и все доступные инструменты
- ❌ **Голос** - не реализовано
- ❌ **Изображения** - не реализовано
- ❌ **Форвард сообщений** - частично реализовано

## 2. Требования к новым типам взаимодействий

### 2.1 Голосовые сообщения
- **Входные данные**: Аудиофайлы (voice, audio) от пользователя
- **Обработка**: Преобразование speech-to-text → обработка как текстовое сообщение
- **Доступные инструменты**: Все (read, write) - полная функциональность
- **Особенности**: Добавление индикации "Распознаю голосовое сообщение..."

### 2.2 Изображения/медиафайлы
- **Входные данные**: Изображения (не видео, размер ограничен)
- **Обработка**: Анализ изображения через Vision модель
- **Доступные инструменты**: Только создание событий (write, только `createEvent`)
- **Ограничения**: Большие изображения и видео отклоняются

### 2.3 Форвард сообщений
- **Входные данные**: Пересланные сообщения из других чатов
- **Обработка**: Извлечение текста/контента → анализ
- **Доступные инструменты**: Только создание событий (write, только `createEvent`)
- **Особенности**: Анализ контекста пересланного сообщения

## 3. Архитектура системы тегов для инструментов

### 3.1 Классификация инструментов по правам доступа

```typescript
interface ToolPermissions {
  read: boolean;    // Чтение данных (getEvents, getLastEvents)
  write: boolean;   // Запись данных (createEvent, updateEvent, deleteEvent)
}

interface ToolMetadata {
  name: string;
  permissions: ToolPermissions;
  supportedInteractionTypes: InteractionType[];
}
```

### 3.2 Типы взаимодействий
```typescript
enum InteractionType {
  TEXT = 'text',           // Полный доступ (read + write)
  VOICE = 'voice',         // Полный доступ (read + write)
  IMAGE = 'image',         // Только создание (write: только createEvent)
  FORWARD = 'forward'      // Только создание (write: только createEvent)
}
```

## 4. ChatContext - класс контекста чата для фильтрации инструментов

### 4.1 ChatContext класс
```typescript
export class ChatContext {
  private interactionType: InteractionType;
  private userId: string | number;
  private chatId: string | number;
  private messageContent: string;
  private mediaContent?: any; // для изображений/аудио
  private availableIntegrations: Integration[];

  constructor(config: ChatContextConfig) {
    this.interactionType = config.interactionType;
    this.userId = config.userId;
    this.chatId = config.chatId;
    this.messageContent = config.messageContent;
    this.mediaContent = config.mediaContent;
    this.availableIntegrations = config.integrations;
  }

  // Фильтрация доступных инструментов для текущего типа взаимодействия
  getAvailableTools(): Record<string, CoreTool> {
    const availableTools: Record<string, CoreTool> = {};

    for (const integration of this.availableIntegrations) {
      const tools = integration.getTools();
      for (const { name, tool } of tools) {
        // Проверяем доступность инструмента для текущего типа взаимодействия
        if (this.isToolAvailable(integration, name)) {
          availableTools[name] = tool;
        }
      }
    }

    return availableTools;
  }

  // Проверка доступности конкретного инструмента
  private isToolAvailable(integration: Integration, toolName: string): boolean {
    const toolMetadata = integration.getToolMetadata(toolName);

    // Проверяем поддержку типа взаимодействия
    if (!toolMetadata.supportedInteractionTypes.includes(this.interactionType)) {
      return false;
    }

    // Дополнительные ограничения для разных типов взаимодействий
    switch (this.interactionType) {
      case InteractionType.IMAGE:
      case InteractionType.FORWARD:
        // Только инструменты с write-правами и только createEvent
        return toolMetadata.permissions.write && toolName === 'createEvent';

      case InteractionType.TEXT:
      case InteractionType.VOICE:
        // Полный доступ к инструментам
        return true;

      default:
        return false;
    }
  }

  // Построение сообщений для Vercel AI SDK
  buildMessages(systemPrompt: string, conversationHistory?: string[]): CoreMessage[] {
    const messages: CoreMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Добавляем историю разговора
    if (conversationHistory && conversationHistory.length > 0) {
      for (let i = 0; i < conversationHistory.length; i++) {
        const content = conversationHistory[i];
        if (content) {
          messages.push({
            role: i % 2 === 0 ? "user" : "assistant",
            content,
          });
        }
      }
    }

    // Добавляем текущее сообщение с учетом типа взаимодействия
    messages.push(this.buildCurrentMessage());

    return messages;
  }

  // Построение текущего сообщения с учетом медиаконтента
  private buildCurrentMessage(): CoreMessage {
    const baseMessage: CoreMessage = {
      role: "user",
      content: this.messageContent,
    };

    // Для изображений добавляем визуальный контент
    if (this.interactionType === InteractionType.IMAGE && this.mediaContent) {
      return {
        role: "user",
        content: [
          {
            type: "text",
            text: this.messageContent || "Анализируй это изображение и создай событие если нужно"
          },
          {
            type: "image",
            image: this.mediaContent // base64 или URL
          }
        ]
      };
    }

    return baseMessage;
  }

  getInteractionType(): InteractionType {
    return this.interactionType;
  }
}
```

### 4.2 Пример реализации для календаря
```typescript
export class CreateEventTool extends BaseTool {
  constructor() {
    super({
      name: 'createEvent',
      permissions: { read: false, write: true },
      supportedInteractionTypes: [
        InteractionType.TEXT,
        InteractionType.VOICE,
        InteractionType.IMAGE,
        InteractionType.FORWARD
      ],
      progressMessage: 'Создаю событие в календаре...',
      progressEmoji: '📝'
    });
  }

  async execute(input: any, interactionType: InteractionType): Promise<any> {
    // Логика создания события
    // Может различаться в зависимости от типа взаимодействия

    switch(interactionType) {
      case InteractionType.IMAGE:
        // Специальная обработка для изображений
        return this.handleImageInput(input);
      case InteractionType.FORWARD:
        // Специальная обработка для пересланных сообщений
        return this.handleForwardInput(input);
      default:
        return this.handleTextInput(input);
    }
  }

  formatResult(result: any, interactionType: InteractionType): string {
    // Различное форматирование для разных типов взаимодействий
    const baseResult = this.formatBaseResult(result);

    switch(interactionType) {
      case InteractionType.IMAGE:
        return `🖼️ На основе изображения:\n${baseResult}`;
      case InteractionType.FORWARD:
        return `📤 На основе пересланного сообщения:\n${baseResult}`;
      default:
        return baseResult;
    }
  }
}
```

## 5. Обновленная система Integration с метаданными инструментов

### 5.1 Расширение базового класса Integration
```typescript
import { CoreTool } from "ai";

export interface ToolMetadata {
  name: string;
  permissions: ToolPermissions;
  supportedInteractionTypes: InteractionType[];
  progressMessage: string;
  progressEmoji: string;
  description: string;
}

export abstract class Integration {
  protected config: IntegrationConfig;
  protected credentials?: IntegrationCredentials;
  protected isAuthenticated: boolean = false;

  // Новое: метаданные инструментов
  protected toolsMetadata: Map<string, ToolMetadata> = new Map();

  constructor(config: IntegrationConfig) {
    this.config = config;
    this.initializeToolsMetadata();
  }

  // Абстрактный метод для инициализации метаданных
  protected abstract initializeToolsMetadata(): void;

  // Получение метаданных конкретного инструмента
  getToolMetadata(toolName: string): ToolMetadata {
    const metadata = this.toolsMetadata.get(toolName);
    if (!metadata) {
      throw new Error(`Tool metadata not found: ${toolName}`);
    }
    return metadata;
  }

  // Получение всех метаданных инструментов
  getAllToolsMetadata(): ToolMetadata[] {
    return Array.from(this.toolsMetadata.values());
  }

  // Проверка поддержки типа взаимодействия конкретным инструментом
  isToolAvailableForInteraction(toolName: string, interactionType: InteractionType): boolean {
    const metadata = this.toolsMetadata.get(toolName);
    return metadata ? metadata.supportedInteractionTypes.includes(interactionType) : false;
  }

  // Получение прогресс-сообщения для инструмента
  getToolProgressStep(toolName: string): ProgressStep {
    const metadata = this.getToolMetadata(toolName);
    return {
      type: 'tool_call',
      message: metadata.progressMessage,
      emoji: metadata.progressEmoji,
      metadata: {
        toolName,
        integration: this.getName(),
        permissions: metadata.permissions
      }
    };
  }

  // Существующие методы остаются без изменений
  abstract authenticate(credentials: IntegrationCredentials): Promise<boolean>;
  abstract getTools(): IntegrationTool[];
  abstract formatToolResult(toolName: string, result: any): string;
  abstract disconnect(): Promise<void>;

  getName(): string {
    return this.config.name;
  }

  getDescription(): string {
    return this.config.description;
  }

  isConnected(): boolean {
    return this.isAuthenticated;
  }

  async initialize(credentials: IntegrationCredentials): Promise<void> {
    this.credentials = credentials;
    this.isAuthenticated = await this.authenticate(credentials);

    if (!this.isAuthenticated) {
      throw new Error(`Failed to authenticate ${this.config.name} integration`);
    }
  }
}
```

### 5.2 Пример реализации для YandexCalendarIntegration
```typescript
export class YandexCalendarIntegration extends Integration {

  protected initializeToolsMetadata(): void {
    // Инициализируем метаданные для каждого инструмента
    this.toolsMetadata.set('getEvents', {
      name: 'getEvents',
      permissions: { read: true, write: false },
      supportedInteractionTypes: [InteractionType.TEXT, InteractionType.VOICE],
      progressMessage: 'Проверяю календарь...',
      progressEmoji: '📅',
      description: 'Получение списка событий из календаря'
    });

    this.toolsMetadata.set('getLastEvents', {
      name: 'getLastEvents',
      permissions: { read: true, write: false },
      supportedInteractionTypes: [InteractionType.TEXT, InteractionType.VOICE],
      progressMessage: 'Загружаю последние события...',
      progressEmoji: '📊',
      description: 'Получение последних событий из календаря'
    });

    this.toolsMetadata.set('createEvent', {
      name: 'createEvent',
      permissions: { read: false, write: true },
      supportedInteractionTypes: [
        InteractionType.TEXT,
        InteractionType.VOICE,
        InteractionType.IMAGE,
        InteractionType.FORWARD
      ],
      progressMessage: 'Создаю событие в календаре...',
      progressEmoji: '📝',
      description: 'Создание нового события в календаре'
    });
  }

  getTools(): IntegrationTool[] {
    // Возвращаем инструменты как обычно, метаданные хранятся отдельно
    return [
      {
        name: "getEvents",
        tool: tool({
          description: this.getToolMetadata('getEvents').description,
          inputSchema: getEventsSchema,
          execute: async ({ dateRange, limit }) => {
            // ... существующая логика
          },
        }),
      },
      // ... остальные инструменты
    ];
  }

  // Переопределяем getProgressStep для использования метаданных
  getProgressStep(toolName: string): ProgressStep {
    return this.getToolProgressStep(toolName);
  }
}
```

## 6. Обновление обработчиков в TelegramBot

### 6.1 Обработчик голосовых сообщений с ChatContext
```typescript
async handleVoice(ctx: Context, audio: any, history: string[]): Promise<void> {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;

  if (!userId) return;

  try {
    // 1. Получить аудиофайл через Telegram Bot API
    const fileUrl = await this.getFileUrl(ctx, audio.file_id);
    const audioBuffer = await this.downloadFile(fileUrl);

    // 2. Распознать речь с помощью Whisper API
    const transcription = await this.transcribeAudio(audioBuffer);

    // 3. Создать ChatContext для голосового взаимодействия
    const chatContext = new ChatContext({
      interactionType: InteractionType.VOICE,
      userId,
      chatId,
      messageContent: transcription,
      mediaContent: audioBuffer,
      integrations: this.getAvailableIntegrations(userId)
    });

    // 4. Обработать через AIAgent
    await this.processWithAI(chatContext, ctx, history);

  } catch (error) {
    await ctx.reply("❌ Ошибка при обработке голосового сообщения");
  }
}

// Transcription с использованием Vercel AI SDK
private async transcribeAudio(audioBuffer: Buffer): Promise<string> {
  // Используем встроенные возможности Vercel AI SDK для Whisper
  const transcription = await openai.audio.transcriptions.create({
    file: audioBuffer,
    model: "whisper-1",
    language: "ru"
  });

  return transcription.text;
}
```

### 6.2 Обработчик изображений с ChatContext
```typescript
async handlePhoto(ctx: Context, photos: any[], history: string[]): Promise<void> {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;
  const caption = ctx.message?.caption || "";

  if (!userId) return;

  try {
    // 1. Получить самое большое изображение
    const photo = photos[photos.length - 1];
    const fileUrl = await this.getFileUrl(ctx, photo.file_id);

    // 2. Проверить размер файла
    if (photo.file_size && photo.file_size > 20 * 1024 * 1024) {
      await ctx.reply("❌ Изображение слишком большое (максимум 20MB)");
      return;
    }

    // 3. Скачать и конвертировать в base64
    const imageBuffer = await this.downloadFile(fileUrl);
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    // 4. Создать ChatContext для изображения
    const chatContext = new ChatContext({
      interactionType: InteractionType.IMAGE,
      userId,
      chatId,
      messageContent: caption || "Анализируй изображение и создай событие если нужно",
      mediaContent: base64Image,
      integrations: this.getAvailableIntegrations(userId)
    });

    // 5. Обработать через AIAgent (автоматически ограничится только createEvent)
    await this.processWithAI(chatContext, ctx, history);

  } catch (error) {
    await ctx.reply("❌ Ошибка при обработке изображения");
  }
}
```

### 6.3 Обработчик форвард сообщений с ChatContext
```typescript
async handleForward(ctx: Context, forwardedMessage: Message, history: string[]): Promise<void> {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id;

  if (!userId) return;

  try {
    // 1. Извлечь контент из пересланного сообщения
    let forwardedContent = "";

    if ('text' in forwardedMessage) {
      forwardedContent = forwardedMessage.text;
    } else if ('caption' in forwardedMessage) {
      forwardedContent = forwardedMessage.caption || "";
    }

    // 2. Добавить контекст о пересланном сообщении
    const contextualMessage = `Пересланное сообщение: "${forwardedContent}"

Проанализируй это сообщение и создай событие в календаре, если это уместно.`;

    // 3. Создать ChatContext для пересланного сообщения
    const chatContext = new ChatContext({
      interactionType: InteractionType.FORWARD,
      userId,
      chatId,
      messageContent: contextualMessage,
      integrations: this.getAvailableIntegrations(userId)
    });

    // 4. Обработать через AIAgent (автоматически ограничится только createEvent)
    await this.processWithAI(chatContext, ctx, history);

  } catch (error) {
    await ctx.reply("❌ Ошибка при обработке пересланного сообщения");
  }
}

// Универсальный метод обработки через AI
private async processWithAI(
  chatContext: ChatContext,
  ctx: Context,
  history: string[]
): Promise<void> {
  const aiAgent = this.getAIAgent(chatContext.getUserId());

  const result = await aiAgent.processMessage(
    chatContext,
    history,
    {
      onThinking: () => this.responseManager.startProgress(ctx, {
        type: 'thinking',
        message: 'Обрабатываю сообщение...',
        emoji: '🤔'
      }),
      onToolCall: (step) => this.responseManager.updateProgress(ctx, step),
      onToolResult: (toolName, result) => {
        // Дополнительная обработка результатов если нужно
      }
    }
  );

  // Форматируем и отправляем ответ
  const responseText = this.formatResponse(result, chatContext);
  const messageId = await this.responseManager.finishProgress(ctx, responseText);

  if (messageId) {
    this.telegramBot.addAssistantResponse(ctx.chat.id, responseText, messageId);
  }
}
```

## 7. Интеграция с Vercel AI SDK

### 7.1 Обновление AIAgent с использованием ChatContext
```typescript
import { generateText, CoreMessage, CoreTool } from "ai";
import { openai } from "@ai-sdk/openai";

export class AIAgent {
  private config: AIAgentConfig;
  private integrations: Integration[];

  constructor(config: AIAgentConfig, integrations: Integration[]) {
    this.config = config;
    this.integrations = integrations;
  }

  async processMessage(
    chatContext: ChatContext,
    conversationHistory?: string[],
    progressCallback?: ProgressCallback
  ): Promise<GenerateTextResult> {
    try {
      // Уведомляем о начале обработки
      if (progressCallback?.onThinking) {
        await progressCallback.onThinking();
      }

      // Специальная обработка для голосовых сообщений
      if (chatContext.getInteractionType() === InteractionType.VOICE) {
        await this.processVoiceMessage(chatContext, progressCallback);
      }

      // Получаем доступные инструменты через ChatContext
      const availableTools = chatContext.getAvailableTools();

      // Строим сообщения для AI SDK
      const systemPrompt = this.buildSystemPrompt(chatContext);
      const messages = chatContext.buildMessages(systemPrompt, conversationHistory);

      // Определяем модель на основе типа взаимодействия
      const model = this.selectModel(chatContext.getInteractionType());

      // Прогнозируем возможные tool calls и показываем прогресс
      await this.showPredictedProgress(chatContext, progressCallback);

      // Используем Vercel AI SDK для генерации ответа
      const result = await generateText({
        model,
        messages,
        tools: availableTools,
        maxSteps: 5, // Разрешаем multiple tool calls
      });

      // Уведомляем о результатах tool calls
      if (result.toolCalls && progressCallback?.onToolResult) {
        for (const toolCall of result.toolCalls) {
          if (toolCall.result) {
            await progressCallback.onToolResult(toolCall.toolName, toolCall.result);
          }
        }
      }

      return result;
    } catch (error) {
      console.error("Ошибка в AI агенте:", error);
      throw new Error(`Ошибка обработки запроса: ${error}`);
    }
  }

  // Обработка голосовых сообщений с помощью Whisper
  private async processVoiceMessage(
    chatContext: ChatContext,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    if (progressCallback?.onToolCall) {
      await progressCallback.onToolCall({
        type: 'processing',
        message: 'Распознаю голосовое сообщение...',
        emoji: '🎤'
      });
    }

    // Здесь будет логика распознавания речи через Whisper API
    // Результат обновит messageContent в chatContext
  }

  // Выбор модели в зависимости от типа взаимодействия
  private selectModel(interactionType: InteractionType) {
    switch (interactionType) {
      case InteractionType.IMAGE:
        return openai("gpt-4-vision-preview"); // Для работы с изображениями
      case InteractionType.VOICE:
      case InteractionType.TEXT:
      case InteractionType.FORWARD:
      default:
        return openai(this.config.model || "gpt-4o-mini");
    }
  }

  // Построение системного промпта с учетом контекста
  private buildSystemPrompt(chatContext: ChatContext): string {
    const interactionType = chatContext.getInteractionType();
    const integrationsList = this.integrations
      .map((i) => `- ${i.getName()}: ${i.getDescription()}`)
      .join("\n");

    let basePrompt = `Ты - AI ассистент с доступом к следующим интеграциям:
${integrationsList}

Отвечай на русском языке.
Будь вежливым и профессиональным.`;

    // Добавляем специфичные инструкции для разных типов взаимодействий
    switch (interactionType) {
      case InteractionType.VOICE:
        basePrompt += `\n\nПользователь отправил голосовое сообщение. У тебя есть доступ ко всем инструментам.`;
        break;
      case InteractionType.IMAGE:
        basePrompt += `\n\nПользователь отправил изображение. Проанализируй его и создай событие в календаре, если это необходимо. Доступен только инструмент createEvent.`;
        break;
      case InteractionType.FORWARD:
        basePrompt += `\n\nПользователь переслал сообщение. Проанализируй контент и создай событие в календаре, если это необходимо. Доступен только инструмент createEvent.`;
        break;
    }

    return basePrompt;
  }

  // Прогнозирование и показ прогресса
  private async showPredictedProgress(
    chatContext: ChatContext,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    if (!progressCallback?.onToolCall) return;

    const possibleTools = this.predictToolsFromMessage(
      chatContext.getMessageContent(),
      chatContext.getInteractionType()
    );

    if (possibleTools.length > 0) {
      const primaryTool = possibleTools[0];
      const progressStep = this.getProgressStepForTool(primaryTool);
      await progressCallback.onToolCall(progressStep);
    }
  }
}

## 8. Обновленный план реализации с ChatContext и Vercel AI SDK

### Фаза 1: Архитектурные изменения
1. ✅ Создать enum InteractionType
2. ✅ Создать интерфейсы ToolPermissions, ToolMetadata
3. ✅ **НОВОЕ**: Создать класс ChatContext для контекстуальной фильтрации инструментов
4. ✅ **НОВОЕ**: Обновить Integration с системой метаданных инструментов
5. ✅ **НОВОЕ**: Интегрировать Vercel AI SDK вместо прямых вызовов OpenAI

**Приоритет: ВЫСОКИЙ** - Основа всей системы

### Фаза 2: Vercel AI SDK Integration
1. ✅ Заменить generateText из "ai" пакета
2. ✅ Обновить типы с ModelMessage на CoreMessage
3. ✅ Использовать CoreTool вместо собственных типов
4. ✅ Реализовать multi-step tool calls с maxSteps
5. ✅ Интегрировать Whisper API через Vercel AI SDK
6. ✅ Настроить Vision API для изображений

**Приоритет: ВЫСОКИЙ** - Критично для всех взаимодействий

### Фаза 3: ChatContext система
1. ✅ Реализовать ChatContext класс
2. ✅ Добавить методы фильтрации инструментов
3. ✅ Реализовать buildMessages для разных типов контента
4. ✅ Добавить поддержку mediaContent для изображений/аудио
5. ✅ Интегрировать с существующим AIAgent

**Приоритет: ВЫСОКИЙ** - Основа для умной фильтрации

### Фаза 4: Голосовые сообщения (VOICE)
1. ✅ Реализовать handleVoice с ChatContext
2. ✅ Интеграция с Whisper через Vercel AI SDK
3. ✅ Обработка различных аудиоформатов (OGG, MP3, M4A)
4. ✅ Прогресс-индикация "Распознаю голосовое сообщение..."
5. ✅ Полный доступ к инструментам (read + write)
6. ✅ Тестирование с реальными голосовыми сообщениями

**Приоритет: СРЕДНИЙ** - Популярная функция

### Фаза 5: Обработка изображений (IMAGE)
1. ✅ Реализовать handlePhoto с ChatContext
2. ✅ Интеграция с GPT-4 Vision через Vercel AI SDK
3. ✅ Автоматическое ограничение только createEvent инструментом
4. ✅ Проверка размеров файлов (максимум 20MB)
5. ✅ Конвертация в base64 для отправки в API
6. ✅ Обработка подписей к изображениям

**Приоритет: СРЕДНИЙ** - Уникальная функция

### Фаза 6: Форвард сообщений (FORWARD)
1. ✅ Реализовать handleForward с ChatContext
2. ✅ Автоматическое ограничение только createEvent
3. ✅ Извлечение контента из разных типов пересланных сообщений
4. ✅ Добавление контекста "Пересланное сообщение:"
5. ✅ Интеграция с существующим форматированием

**Приоритет: НИЗКИЙ** - Дополнительная функция

### Фаза 7: Рефакторинг Integration системы
1. ✅ Обновить YandexCalendarIntegration с метаданными
2. ✅ Реализовать initializeToolsMetadata()
3. ✅ Добавить поддержку всех InteractionType в метаданных
4. ✅ Обновить форматирование результатов
5. ✅ Тестирование со всеми типами взаимодействий

**Приоритет: СРЕДНИЙ** - Для масштабируемости

### Фаза 8: Оптимизация и тестирование
1. ✅ Performance тестирование всех типов взаимодействий
2. ✅ Добавить метрики и логирование
3. ✅ Оптимизировать размеры передаваемых данных
4. ✅ Обработка ошибок и edge cases
5. ✅ Документация для разработчиков

**Приоритет: НИЗКИЙ** - После основной функциональности

## 9. Технические требования

### 9.1 Внешние API (через Vercel AI SDK)
- **Vercel AI SDK** - единая точка входа для всех AI операций
- **OpenAI GPT-5-nano** - единственная модель для всех типов взаимодействий
- **OpenAI Whisper-1** - для распознавания речи
- **Telegram Bot API** - для получения медиафайлов

### 9.2 Зависимости
```json
{
  "ai": "^5.0.34",
  "@ai-sdk/openai": "^2.0.24",
  "grammy": "^1.38.2"
}
```

### 9.3 Ограничения
- **Размер изображений**: максимум 20MB (Telegram лимит)
- **Форматы аудио**: MP3, OGG, M4A, WAV (поддерживаемые Whisper)
- **Форматы изображений**: JPG, PNG, WebP (принимаются, но анализируется только подпись)
- **Видео**: не поддерживается (только статические изображения)
- **Длительность аудио**: до 25MB файлов (лимит Whisper API)
- **Анализ изображений**: GPT-5-nano не поддерживает vision, работает только с подписями

### 9.4 Производительность и оптимизация
- **Время обработки голоса**: 3-8 секунд (зависит от длительности)
- **Время обработки изображения**: 5-12 секунд
- **maxSteps**: 5 для multi-step tool calls
- **Кеширование**: результаты распознавания на 1 час
- **Параллельная обработка**: через Vercel AI SDK streaming

## 10. Безопасность и конфиденциальность

### 10.1 Обработка медиафайлов
- Временное хранение файлов (автоудаление через 1 час)
- Проверка типов файлов перед обработкой
- Ограничение размеров для предотвращения DoS

### 10.2 Ограничения доступа
- Четкое разделение read/write операций
- Логирование всех операций создания событий
- Проверка прав пользователя перед выполнением действий

## 11. Метрики и мониторинг

### 11.1 Ключевые метрики
- Время обработки по типам взаимодействий
- Процент успешных распознаваний голоса
- Процент успешных анализов изображений
- Количество созданных событий по типам взаимодействий

### 11.2 Логирование
- Все вызовы внешних API с результатами
- Ошибки обработки медиафайлов
- Статистика использования инструментов

---

Этот PRD предоставляет полную архитектуру для реализации всех типов пользовательских взаимодействий с четким разделением функциональности и правами доступа для различных типов контента.