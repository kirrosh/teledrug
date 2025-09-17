import { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import { ConversationHistory } from "../modules/conversation-history";
import { CalendarSetupHandler } from "./handlers/calendar-setup";
import { CalendarTestHandler } from "./handlers/calendar-test";

export interface TelegramBotConfig {
  token: string;
}

export interface MessageHandlers {
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
  private ensureUserCallback?: (userId: number, username?: string) => Promise<void>;

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

  setEnsureUserCallback(callback: (userId: number, username?: string) => Promise<void>) {
    this.ensureUserCallback = callback;
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
        if (this.handlers.onForward) {
          await this.handlers.onForward(ctx, ctx.message, history);
        }
      } else {
        const userMessage = ctx.message.text;
        this.conversationHistory.addUserMessage(chatId, userMessage);

        // Сохраняем ID пользовательского сообщения
        this.trackMessage(chatId, ctx.message.message_id);

        if (this.handlers.onText) {
          await this.handlers.onText(ctx, userMessage, history);
        }
      }
    });

    this.bot.on("message:audio", async (ctx) => {
      const chatId = ctx.chat.id;
      const history = this.conversationHistory.getHistory(chatId);

      if (this.handlers.onAudio) {
        await this.handlers.onAudio(ctx, ctx.message.audio, history);
      }
    });

    this.bot.on("message:voice", async (ctx) => {
      const chatId = ctx.chat.id;
      const history = this.conversationHistory.getHistory(chatId);

      if (this.handlers.onAudio) {
        await this.handlers.onAudio(ctx, ctx.message.voice as any, history);
      }
    });

    this.bot.on("message:photo", async (ctx) => {
      const chatId = ctx.chat.id;
      const history = this.conversationHistory.getHistory(chatId);

      if (this.handlers.onPhoto) {
        await this.handlers.onPhoto(ctx, ctx.message.photo, history);
      }
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
}
