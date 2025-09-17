import { TelegramBot } from "../telegram/bot";
import { UserManager } from "./user-manager";
import { AIAgentFactory } from "./ai-agent-factory";
import { IntegrationRegistry } from "../integrations/base/registry";
import { YandexCalendarIntegration } from "../integrations/yandex-calendar";
import { ResponseManager } from "./response-manager";
// import { JiraIntegration } from "../integrations/jira"; // Отключено
import type { Context } from "grammy";

export interface BotServiceConfig {
  telegramToken: string;
  openaiApiKey: string;
}

export class BotService {
  private telegramBot: TelegramBot;
  private userManager: UserManager;
  private aiAgentFactory: AIAgentFactory;
  private responseManager: ResponseManager;

  constructor(config: BotServiceConfig) {
    this.userManager = new UserManager();
    this.aiAgentFactory = new AIAgentFactory(
      this.userManager,
      config.openaiApiKey
    );
    this.telegramBot = new TelegramBot({ token: config.telegramToken });
    this.responseManager = new ResponseManager();

    this.registerIntegrations();
    this.setupHandlers();
    this.setupUserEnsuring();
    this.startCleanupInterval();
  }

  private registerIntegrations(): void {
    // Регистрируем доступные интеграции
    IntegrationRegistry.register("YandexCalendar", YandexCalendarIntegration);
    // IntegrationRegistry.register("Jira", JiraIntegration); // Отключено - нет доступа к корпоративной Jira
  }

  private setupHandlers(): void {
    this.telegramBot.setHandlers({
      onText: async (ctx: Context, text: string, history: string[]) => {
        await this.handleTextMessage(ctx, text, history);
      },
      onAudio: async (ctx: Context, audio: any, history: string[]) => {
        await ctx.reply("🎵 Обработка аудио будет реализована позже");
      },
      onPhoto: async (ctx: Context, photos: any, history: string[]) => {
        await ctx.reply("📸 Обработка изображений будет реализована позже");
      },
      onForward: async (ctx: Context, message: any, history: string[]) => {
        await ctx.reply("↗️ Обработка форвардов будет реализована позже");
      },
      onIntegrationsCommand: async (ctx: Context) => {
        await this.handleIntegrationsCommand(ctx);
      },
      onRemoveIntegrationCommand: async (ctx: Context, args: string[]) => {
        await this.handleRemoveIntegrationCommand(ctx, args);
      },
    });
  }

  private setupUserEnsuring(): void {
    this.telegramBot.setEnsureUserCallback(async (userId: number, username?: string) => {
      await this.userManager.getOrCreateUser(userId, username);
    });
  }

  private async handleIntegrationsCommand(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const config = await this.userManager.getUserConfig(userId);
    if (!config || config.integrations.length === 0) {
      await ctx.reply(
        "У вас нет подключенных интеграций.\n\n" +
          "📅 Используйте /add_yandex_calendar для подключения календаря Яндекса"
      );
      return;
    }

    const list = config.integrations
      .map((i) => `• ${i.name} (${i.enabled ? "✅ активна" : "❌ отключена"})`)
      .join("\n");

    await ctx.reply(`📋 **Ваши интеграции:**\n\n${list}`, {
      parse_mode: "Markdown",
    });
  }

  private async handleRemoveIntegrationCommand(
    ctx: Context,
    args: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!args || args.length === 0) {
      await ctx.reply("Использование: /remove_integration <название>");
      return;
    }

    const integrationName = args[0];
    if (!integrationName) {
      await ctx.reply("Использование: /remove_integration <название>");
      return;
    }

    await this.userManager.removeUserIntegration(userId, integrationName);
    await this.aiAgentFactory.refreshAgent(userId);

    await ctx.reply(`✅ Интеграция ${integrationName} удалена`);
  }

  private async handleTextMessage(
    ctx: Context,
    text: string,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;

    if (!userId) {
      await ctx.reply("❌ Не удалось определить пользователя");
      return;
    }

    try {
      console.log(`📝 Обработка сообщения от ${username} (${userId}): ${text}`);

      // Получаем или создаем пользователя
      await this.userManager.getOrCreateUser(userId, username);

      // Получаем AI агента для пользователя
      const agent = await this.aiAgentFactory.getOrCreateAgent(userId);

      // Начинаем интерактивный ответ
      const initialStep = this.determineInitialStep(text);
      await this.responseManager.startProgress(ctx, initialStep);

      // Обрабатываем сообщение с колбэками прогресса
      const result = await agent.chatWithProgress(text, history, {
        onThinking: async () => {
          await this.responseManager.updateProgress(ctx, {
            type: 'thinking',
            message: 'Анализирую запрос...',
            emoji: '🧠'
          });
        },
        onToolCall: async (progressStep) => {
          await this.responseManager.updateProgress(ctx, progressStep);
        },
        onToolResult: async (toolName, result) => {
          // Опционально можно добавить дополнительные уведомления
          console.log(`Tool ${toolName} completed with result:`, result);
        }
      });

      if (result) {
        const responseText = result.text || "Задача выполнена!";
        const messageId = await this.responseManager.finishProgress(ctx, responseText);

        // Сохраняем ответ в историю с ID сообщения
        if (ctx.chat?.id) {
          this.telegramBot.addAssistantResponse(ctx.chat.id, responseText, messageId);
        }
      } else {
        const errorMsg = "❌ Не удалось получить ответ от AI агента";
        const messageId = await this.responseManager.finishProgress(ctx, errorMsg);

        if (ctx.chat?.id && messageId) {
          this.telegramBot.addAssistantResponse(ctx.chat.id, errorMsg, messageId);
        }
      }
    } catch (error) {
      console.error("Ошибка при обработке сообщения:", error);
      const errorMsg = `❌ Произошла ошибка: ${error}`;
      const messageId = await this.responseManager.finishProgress(ctx, errorMsg);

      if (ctx.chat?.id && messageId) {
        this.telegramBot.addAssistantResponse(ctx.chat.id, errorMsg, messageId);
      }
    }
  }

  private determineInitialStep(text: string) {
    const lowerText = text.toLowerCase();

    // Анализируем текст запроса и выбираем подходящее начальное сообщение
    if (lowerText.includes('календар') || lowerText.includes('событи') ||
        lowerText.includes('встреч') || lowerText.includes('время') ||
        lowerText.includes('завтра') || lowerText.includes('сегодня')) {
      return {
        type: 'thinking' as const,
        message: 'Думаю...',
        emoji: '🤔'
      };
    }

    if (lowerText.includes('создай') || lowerText.includes('добавь') ||
        lowerText.includes('запланируй')) {
      return {
        type: 'thinking' as const,
        message: 'Думаю...',
        emoji: '🤔'
      };
    }

    // Общий случай
    return {
      type: 'thinking' as const,
      message: 'Думаю...',
      emoji: '🤔'
    };
  }

  private startCleanupInterval(): void {
    // Очищаем старые ответы каждые 5 минут
    setInterval(() => {
      this.responseManager.cleanup();
    }, 5 * 60 * 1000);
  }

  async start(): Promise<void> {
    console.log("🚀 Запуск сервиса бота...");
    await this.telegramBot.start();
  }

  async stop(): Promise<void> {
    console.log("🛑 Остановка сервиса бота...");
    await this.telegramBot.stop();
  }
}
