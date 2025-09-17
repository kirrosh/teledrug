import { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import { ConversationHistory } from "../modules/conversation-history";
import { CalendarSetupHandler } from "./handlers/calendar-setup";
import { CalendarTestHandler } from "./handlers/calendar-test";
import type { UserManager } from "../core/user-manager";
import { ChatContext } from "../core/chat-context";
import { InteractionType } from "../types/interaction-types";
import type { Integration } from "../integrations/base/integration";

export interface TelegramBotConfig {
  token: string;
}

export interface MessageHandlers {
  // Старые обработчики для обратной совместимости
  onText: (ctx: Context, text: string, history: string[]) => Promise<void>;
  onAudio: (
    ctx: Context,
    audio: Message.AudioMessage["audio"],
    history: string[]
  ) => Promise<void>;
  onPhoto: (
    ctx: Context,
    photos: Message.PhotoMessage["photo"],
    history: string[]
  ) => Promise<void>;
  onForward: (
    ctx: Context,
    forwardedMessage: Message,
    history: string[]
  ) => Promise<void>;

  // Новый универсальный обработчик
  processWithAI?: (
    chatContext: ChatContext,
    ctx: Context,
    history: string[]
  ) => Promise<void>;

  // Команды интеграций
  onIntegrationsCommand?: (ctx: Context) => Promise<void>;
  onRemoveIntegrationCommand?: (ctx: Context, args: string[]) => Promise<void>;
}

export class TelegramBot {
  private bot: Bot;
  private handlers: Partial<MessageHandlers>;
  private conversationHistory: ConversationHistory;
  private calendarSetup: CalendarSetupHandler;
  private calendarTest: CalendarTestHandler;
  private chatMessages: Map<number, number[]> = new Map(); // chatId -> messageIds
  private ensureUserCallback?: (
    userId: number,
    username?: string
  ) => Promise<void>;

  // Новые поля для работы с интеграциями
  private availableIntegrations: Integration[] = [];
  private getAvailableIntegrationsCallback?: (userId: number) => Integration[];

  // Кеш для файлов
  private fileCache = new Map<string, Buffer>();

  constructor(config: TelegramBotConfig) {
    this.bot = new Bot(config.token);
    this.handlers = {};
    this.conversationHistory = new ConversationHistory();
    this.calendarSetup = new CalendarSetupHandler();
    this.calendarTest = new CalendarTestHandler();
    this.setupDefaultHandlers();
  }

  setHandlers(handlers: Partial<MessageHandlers>) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  setEnsureUserCallback(
    callback: (userId: number, username?: string) => Promise<void>
  ) {
    this.ensureUserCallback = callback;
  }

  setUserManager(userManager: UserManager) {
    this.calendarSetup.setUserManager(userManager);
  }

  setGetAvailableIntegrationsCallback(
    callback: (userId: number) => Integration[]
  ) {
    this.getAvailableIntegrationsCallback = callback;
  }

  private getAvailableIntegrations(userId: number): Integration[] {
    if (this.getAvailableIntegrationsCallback) {
      return this.getAvailableIntegrationsCallback(userId);
    }
    return this.availableIntegrations;
  }

  private async ensureUser(ctx: Context): Promise<boolean> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;

    if (!userId) {
      await ctx.reply("❌ Не удалось определить пользователя");
      return false;
    }

    if (this.ensureUserCallback) {
      try {
        await this.ensureUserCallback(userId, username);
      } catch (error) {
        console.error("Error ensuring user:", error);
        await ctx.reply("❌ Произошла ошибка при создании пользователя");
        return false;
      }
    }

    return true;
  }

  private setupDefaultHandlers() {
    // Базовые команды - остальные команды должны добавляться через getBotInstance()
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        "🤖 Привет! Я AI-ассистент с поддержкой интеграций.\n\n" +
          "Доступные команды:\n" +
          "/integrations - Показать список активных интеграций\n" +
          "/add_yandex_calendar - Подключить календарь Яндекса\n" +
          "/test_calendar - Тестировать подключение к календарю\n" +
          "/remove_integration - Удалить интеграцию\n" +
          "/clear - Полная очистка чата (история + сообщения)\n" +
          "/history - Показать статистику чата\n\n" +
          "Просто напишите мне свой вопрос и я помогу!"
      );
    });

    this.bot.command("clear", async (ctx) => {
      const chatId = ctx.chat.id;

      // 1. Очищаем историю LLM (обязательно!)
      this.conversationHistory.clearHistory(chatId);

      // 2. Получаем сообщения для удаления
      const messageIds = this.chatMessages.get(chatId) || [];

      if (messageIds.length === 0) {
        await ctx.reply("🗑️ История диалога очищена!");
        return;
      }

      // 3. Простое удаление сообщений
      let deletedCount = 0;

      for (const messageId of messageIds) {
        try {
          await ctx.api.deleteMessage(chatId, messageId);
          deletedCount++;
        } catch {
          // Игнорируем ошибки - могут быть старые сообщения
        }
      }

      // 4. Очищаем список отслеживаемых сообщений
      this.chatMessages.delete(chatId);

      // 5. Отправляем результат
      let message = "🗑️ История диалога очищена!";
      if (deletedCount > 0) {
        message += `\n📱 Удалено ${deletedCount} сообщений из чата`;
      }

      await ctx.reply(message);
    });

    this.bot.command("history", async (ctx) => {
      const chatId = ctx.chat.id;
      const historyLength = this.conversationHistory.getHistoryLength(chatId);
      const trackedMessages = this.getTrackedMessagesCount(chatId);

      let message = `📊 **Статистика чата:**\n`;
      message += `💭 История LLM: ${historyLength} сообщений\n`;
      message += `📱 Отслеживаемые сообщения: ${trackedMessages}\n\n`;
      message += `ℹ️ Используйте /clear для полной очистки`;

      await ctx.reply(message, { parse_mode: "Markdown" });
    });

    // Команды интеграций - обработчики задаются через setHandlers
    this.bot.command("integrations", async (ctx) => {
      if (!(await this.ensureUser(ctx))) return;

      if (this.handlers.onIntegrationsCommand) {
        await this.handlers.onIntegrationsCommand(ctx);
      } else {
        await ctx.reply("❌ Обработчик команды не настроен");
      }
    });

    this.bot.command("remove_integration", async (ctx) => {
      if (!(await this.ensureUser(ctx))) return;

      const args = ctx.message?.text?.split(" ").slice(1) || [];
      if (this.handlers.onRemoveIntegrationCommand) {
        await this.handlers.onRemoveIntegrationCommand(ctx, args);
      } else {
        await ctx.reply("❌ Обработчик команды не настроен");
      }
    });

    // Add Yandex Calendar command
    this.bot.command("add_yandex_calendar", async (ctx) => {
      if (!(await this.ensureUser(ctx))) return;

      await this.calendarSetup.handleAddYandexCalendar(ctx);
    });

    // Test calendar command
    this.bot.command("test_calendar", async (ctx) => {
      if (!(await this.ensureUser(ctx))) return;

      await this.calendarTest.handleTestCalendarCommand(ctx);
    });

    // Обработка текстовых сообщений в самом конце
    this.bot.on("message:text", async (ctx) => {
      const chatId = ctx.chat.id;
      const userId = ctx.from?.id;
      const history = this.conversationHistory.getHistory(chatId);

      // Check if user is in calendar setup session
      if (userId && this.calendarSetup.isInSetupSession(userId)) {
        const handled = await this.calendarSetup.handleUserMessage(
          ctx,
          ctx.message.text
        );
        if (handled) return;
      }

      if (ctx.message.forward_origin) {
        // Обработка пересланных сообщений через новую архитектуру
        await this.handleForward(ctx, ctx.message, history);
      } else {
        const userMessage = ctx.message.text;
        this.conversationHistory.addUserMessage(chatId, userMessage);

        // Сохраняем ID пользовательского сообщения
        this.trackMessage(chatId, ctx.message.message_id);

        // Обработка текста через новую архитектуру
        await this.handleText(ctx, userMessage, history);
      }
    });

    this.bot.on("message:audio", async (ctx) => {
      const chatId = ctx.chat.id;
      const history = this.conversationHistory.getHistory(chatId);

      // Обработка аудио через новую архитектуру
      await this.handleVoice(ctx, ctx.message.audio, history);
    });

    this.bot.on("message:voice", async (ctx) => {
      const chatId = ctx.chat.id;
      const history = this.conversationHistory.getHistory(chatId);

      // Обработка голосовых сообщений через новую архитектуру
      await this.handleVoice(ctx, ctx.message.voice as any, history);
    });

    this.bot.on("message:photo", async (ctx) => {
      const chatId = ctx.chat.id;
      const history = this.conversationHistory.getHistory(chatId);

      // Обработка изображений через новую архитектуру
      await this.handlePhoto(ctx, ctx.message.photo, history);
    });
  }

  async start() {
    console.log("🚀 Запуск Telegram бота...");

    // Регистрируем команды в меню Telegram
    await this.bot.api.setMyCommands([
      { command: "start", description: "🚀 Запустить бота" },
      { command: "integrations", description: "📋 Список интеграций" },
      {
        command: "add_yandex_calendar",
        description: "📅 Подключить календарь Яндекса",
      },
      { command: "test_calendar", description: "🔍 Тестировать календарь" },
      { command: "remove_integration", description: "❌ Удалить интеграцию" },
      { command: "clear", description: "🧹 Полная очистка чата" },
      { command: "history", description: "📊 Статистика чата" },
    ]);

    await this.bot.start();
    console.log("✅ Telegram бот запущен!");
  }

  async stop() {
    console.log("🛑 Остановка Telegram бота...");
    await this.bot.stop();
    console.log("✅ Telegram бот остановлен!");
  }

  getBotInstance() {
    return this.bot;
  }

  addAssistantResponse(chatId: number, response: string, messageId?: number) {
    this.conversationHistory.addAssistantMessage(chatId, response);
    if (messageId) {
      this.trackMessage(chatId, messageId);
    }
  }

  private trackMessage(chatId: number, messageId: number) {
    const messages = this.chatMessages.get(chatId) || [];
    messages.push(messageId);
    this.chatMessages.set(chatId, messages);

    // Ограничиваем количество отслеживаемых сообщений (максимум 1000 на чат)
    if (messages.length > 1000) {
      messages.splice(0, messages.length - 1000);
    }
  }

  getTrackedMessagesCount(chatId: number): number {
    return this.chatMessages.get(chatId)?.length || 0;
  }

  // Методы для работы с файлами Telegram
  private async getFileUrl(ctx: Context, fileId: string): Promise<string> {
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("File path not available");
      }
      return `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
    } catch (error) {
      console.error("Error getting file URL:", error);
      throw new Error(`Failed to get file URL: ${error}`);
    }
  }

  private async downloadFile(fileUrl: string, fileId?: string): Promise<Buffer> {
    // Проверяем кеш
    if (fileId && this.fileCache.has(fileId)) {
      console.log("📁 Using cached file:", fileId);
      return this.fileCache.get(fileId)!;
    }

    try {
      console.log("📥 Downloading file:", fileUrl);
      const response = await fetch(fileUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Кешируем файл на 1 час
      if (fileId) {
        this.fileCache.set(fileId, buffer);
        setTimeout(() => {
          this.fileCache.delete(fileId);
          console.log("🗑️ Cleared cached file:", fileId);
        }, 60 * 60 * 1000); // 1 час
      }

      console.log(`✅ Downloaded ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      console.error("Error downloading file:", error);
      throw new Error(`Failed to download file: ${error}`);
    }
  }

  // Метод для распознавания речи через Whisper API
  private async transcribeAudio(audioBuffer: Buffer, fileId: string): Promise<string> {
    try {
      console.log("🎤 Transcribing audio with Whisper API...");

      // Создаем временный файл для Whisper API
      const tempFileName = `audio_${fileId}_${Date.now()}.ogg`;

      // Создаем File объект для отправки в API
      const audioFile = new File([audioBuffer], tempFileName, {
        type: 'audio/ogg'
      });

      // Используем прямой вызов OpenAI API для Whisper
      const formData = new FormData();
      formData.append('file', audioFile);
      formData.append('model', 'whisper-1');
      formData.append('language', 'ru');
      formData.append('response_format', 'text');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const transcription = await response.text();

      console.log("✅ Transcription completed:", transcription.substring(0, 100) + "...");
      return transcription;
    } catch (error) {
      console.error("Error transcribing audio:", error);
      throw new Error(`Failed to transcribe audio: ${error}`);
    }
  }

  // Метод для подготовки изображения к отправке в AI (конвертация в base64)
  private async prepareImageForAI(imageBuffer: Buffer, caption: string, fileId: string): Promise<{ caption: string, imageData: string }> {
    try {
      console.log("🖼️ Preparing image for AI analysis...");

      // Конвертируем изображение в base64 data URL для AI SDK
      const base64Data = imageBuffer.toString('base64');
      const imageData = `data:image/jpeg;base64,${base64Data}`;

      console.log("✅ Image prepared for AI analysis");
      return {
        caption: caption || "Проанализируй это изображение",
        imageData
      };
    } catch (error) {
      console.error("Error preparing image for AI:", error);
      throw new Error(`Failed to prepare image for AI: ${error}`);
    }
  }


  // Новые обработчики с использованием ChatContext
  private async handleText(
    ctx: Context,
    text: string,
    history: string[]
  ): Promise<void> {
    const chatContext = this.createChatContext(ctx, InteractionType.TEXT, text);
    await this.processWithAI(chatContext, ctx, history);
  }

  private async handleVoice(
    ctx: Context,
    audio: any,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;

    if (!userId || !ctx.chat) return;

    try {
      console.log("🎤 Processing voice message...");

      // Проверяем размер файла
      if (audio.file_size && audio.file_size > 25 * 1024 * 1024) {
        await ctx.reply("❌ Аудиофайл слишком большой (максимум 25MB)");
        return;
      }

      // Получаем и скачиваем аудиофайл
      const fileUrl = await this.getFileUrl(ctx, audio.file_id);
      const audioBuffer = await this.downloadFile(fileUrl, audio.file_id);

      // Распознаем речь через Whisper
      const transcription = await this.transcribeAudio(audioBuffer, audio.file_id);

      if (!transcription.trim()) {
        await ctx.reply("❌ Не удалось распознать речь в аудиосообщении");
        return;
      }

      console.log("📝 Transcribed text:", transcription);

      // Обновляем ChatContext с распознанным текстом
      const chatContext = this.createChatContext(
        ctx,
        InteractionType.VOICE,
        transcription,
        { originalAudio: audio, transcription }
      );

      await this.processWithAI(chatContext, ctx, history);
    } catch (error) {
      console.error("Error handling voice message:", error);
      await ctx.reply("❌ Ошибка при обработке голосового сообщения");
    }
  }

  private async handlePhoto(
    ctx: Context,
    photos: any[],
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    const caption = (ctx.message as any)?.caption || "";

    if (!userId || !ctx.chat) return;

    try {
      console.log("🖼️ Processing image message...");

      // Получаем самое большое изображение
      const photo = photos[photos.length - 1];

      // Проверяем размер файла
      if (photo.file_size && photo.file_size > 20 * 1024 * 1024) {
        await ctx.reply("❌ Изображение слишком большое (максимум 20MB)");
        return;
      }

      // Получаем и скачиваем изображение
      const fileUrl = await this.getFileUrl(ctx, photo.file_id);
      const imageBuffer = await this.downloadFile(fileUrl, photo.file_id);

      // Подготавливаем изображение для отправки в AI
      const imageData = await this.prepareImageForAI(imageBuffer, caption, photo.file_id);

      console.log("📝 Image prepared for AI");

      // Создаем ChatContext с изображением и подписью
      const chatContext = this.createChatContext(
        ctx,
        InteractionType.IMAGE,
        imageData.caption,
        {
          originalPhoto: photo,
          imageData: imageData.imageData,
          imageBuffer,
          caption,
          fileUrl
        }
      );

      await this.processWithAI(chatContext, ctx, history);
    } catch (error) {
      console.error("Error handling photo:", error);
      await ctx.reply("❌ Ошибка при обработке изображения");
    }
  }

  private async handleForward(
    ctx: Context,
    forwardedMessage: Message,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;

    if (!userId || !ctx.chat) return;

    try {
      // Извлечь контент из пересланного сообщения
      let forwardedContent = "";

      if ("text" in forwardedMessage) {
        forwardedContent = forwardedMessage.text || "";
      } else if ("caption" in forwardedMessage && forwardedMessage.caption) {
        forwardedContent = forwardedMessage.caption;
      }

      // Добавить контекст о пересланном сообщении
      const contextualMessage = `Пересланное сообщение: "${forwardedContent}"

Проанализируй это сообщение и создай событие в календаре, если это уместно.`;

      const chatContext = this.createChatContext(
        ctx,
        InteractionType.FORWARD,
        contextualMessage
      );
      await this.processWithAI(chatContext, ctx, history);
    } catch (error) {
      console.error("Error handling forwarded message:", error);
      await ctx.reply("❌ Ошибка при обработке пересланного сообщения");
    }
  }

  // Создание ChatContext
  private createChatContext(
    ctx: Context,
    interactionType: InteractionType,
    messageContent: string,
    mediaContent?: any
  ): ChatContext {
    const userId = ctx.from?.id || 0;
    const chatId = ctx.chat?.id || 0;

    return new ChatContext({
      interactionType,
      userId,
      chatId,
      messageContent,
      mediaContent,
      integrations: this.getAvailableIntegrations(userId),
    });
  }

  // Универсальный метод обработки через AI
  private async processWithAI(
    chatContext: ChatContext,
    ctx: Context,
    history: string[]
  ): Promise<void> {
    // Используем новый обработчик если есть, иначе fallback на старые
    if (this.handlers.processWithAI) {
      await this.handlers.processWithAI(chatContext, ctx, history);
    } else {
      // Fallback на старые обработчики для обратной совместимости
      const interactionType = chatContext.getInteractionType();
      const messageContent = chatContext.getMessageContent();

      switch (interactionType) {
        case InteractionType.TEXT:
          if (this.handlers.onText) {
            await this.handlers.onText(ctx, messageContent, history);
          }
          break;
        case InteractionType.VOICE:
          if (this.handlers.onAudio) {
            await this.handlers.onAudio(
              ctx,
              chatContext.getMediaContent(),
              history
            );
          }
          break;
        case InteractionType.IMAGE:
          if (this.handlers.onPhoto) {
            // Создаем fake photos array для обратной совместимости
            const photos = [
              { file_id: "fake", file_unique_id: "fake", width: 0, height: 0 },
            ];
            await this.handlers.onPhoto(ctx, photos as any, history);
          }
          break;
        case InteractionType.FORWARD:
          if (this.handlers.onForward) {
            // Создаем fake message для обратной совместимости
            const fakeMessage = { text: messageContent } as Message;
            await this.handlers.onForward(ctx, fakeMessage, history);
          }
          break;
      }
    }
  }
}
