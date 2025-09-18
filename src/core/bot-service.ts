import { TelegramBot } from "../telegram/bot";
import { UserManager } from "./user-manager";
import { AIAgentFactory } from "./ai-agent-factory";
import { IntegrationRegistry } from "../integrations/base/registry";
import { YandexCalendarIntegration } from "../integrations/yandex-calendar";
import { ResponseManager } from "./response-manager";
// import { JiraIntegration } from "../integrations/jira"; // Отключено
import type { Context } from "grammy";
import { ChatContext } from "./chat-context";
import { InteractionType } from "../types/interaction-types";

export interface BotServiceConfig {
  telegramToken: string;
  openaiApiKey: string;
}

export class BotService {
  private telegramBot: TelegramBot;
  private userManager: UserManager;
  private aiAgentFactory: AIAgentFactory;
  private responseManager: ResponseManager;
  private telegramToken: string;

  constructor(config: BotServiceConfig) {
    this.telegramToken = config.telegramToken;
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
        await this.handleVoiceMessage(ctx, audio, history);
      },
      onPhoto: async (ctx: Context, photos: any, history: string[]) => {
        await this.handlePhotoMessage(ctx, photos, history);
      },
      onForward: async (ctx: Context, message: any, history: string[]) => {
        await this.handleForwardMessage(ctx, message, history);
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
    this.telegramBot.setEnsureUserCallback(
      async (userId: number, username?: string) => {
        await this.userManager.getOrCreateUser(userId, username);
      }
    );

    // Pass UserManager to the bot for calendar setup handler
    this.telegramBot.setUserManager(this.userManager);
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
            type: "thinking",
            message: "Анализирую запрос...",
            emoji: "🧠",
          });
        },
        onToolCall: async (progressStep) => {
          await this.responseManager.updateProgress(ctx, progressStep);
        },
        onToolResult: async (toolName, result) => {
          // Опционально можно добавить дополнительные уведомления
          console.log(`Tool ${toolName} completed with result:`, result);
        },
      });

      if (result) {
        // Если есть toolCalls, форматируем их результаты
        let responseText = result.text || "";

        if (
          result.toolCalls &&
          result.toolResults &&
          result.toolCalls.length > 0
        ) {
          // Получаем агента для форматирования результатов
          const agent = await this.aiAgentFactory.getOrCreateAgent(userId);
          const formattedResults = this.formatToolResults(agent, result);

          // Комбинируем текст AI и результаты инструментов
          if (responseText && formattedResults) {
            responseText = `${responseText}\n\n${formattedResults}`;
          } else {
            responseText =
              formattedResults || responseText || "Задача выполнена!";
          }
        } else if (!responseText) {
          responseText = "Задача выполнена!";
        }

        const messageId = await this.responseManager.finishProgress(
          ctx,
          responseText
        );

        // Сохраняем ответ в историю с ID сообщения
        if (ctx.chat?.id) {
          this.telegramBot.addAssistantResponse(
            ctx.chat.id,
            responseText,
            messageId
          );
        }
      } else {
        const errorMsg = "❌ Не удалось получить ответ от AI агента";
        const messageId = await this.responseManager.finishProgress(
          ctx,
          errorMsg
        );

        if (ctx.chat?.id && messageId) {
          this.telegramBot.addAssistantResponse(
            ctx.chat.id,
            errorMsg,
            messageId
          );
        }
      }
    } catch (error) {
      console.error("Ошибка при обработке сообщения:", error);
      const errorMsg = `❌ Произошла ошибка: ${error}`;
      const messageId = await this.responseManager.finishProgress(
        ctx,
        errorMsg
      );

      if (ctx.chat?.id && messageId) {
        this.telegramBot.addAssistantResponse(ctx.chat.id, errorMsg, messageId);
      }
    }
  }

  private determineInitialStep(text: string) {
    const lowerText = text.toLowerCase();

    // Анализируем текст запроса и выбираем подходящее начальное сообщение
    if (
      lowerText.includes("календар") ||
      lowerText.includes("событи") ||
      lowerText.includes("встреч") ||
      lowerText.includes("время") ||
      lowerText.includes("завтра") ||
      lowerText.includes("сегодня")
    ) {
      return {
        type: "thinking" as const,
        message: "Думаю...",
        emoji: "🤔",
      };
    }

    if (
      lowerText.includes("создай") ||
      lowerText.includes("добавь") ||
      lowerText.includes("запланируй")
    ) {
      return {
        type: "thinking" as const,
        message: "Думаю...",
        emoji: "🤔",
      };
    }

    // Общий случай
    return {
      type: "thinking" as const,
      message: "Думаю...",
      emoji: "🤔",
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

  private async handleVoiceMessage(
    ctx: Context,
    audio: any,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Не удалось определить пользователя");
      return;
    }

    try {
      console.log(
        `🎤 Обработка голосового сообщения от пользователя ${userId}`
      );

      // Создаем ChatContext для голосового сообщения
      const integrations = await this.aiAgentFactory.getIntegrationsForUser(
        userId
      );
      const chatContext = new ChatContext({
        interactionType: InteractionType.VOICE,
        userId,
        chatId: ctx.chat?.id || userId,
        messageContent: "", // Будет заполнено после транскрипции
        metadata: { originalAudio: audio },
        integrations,
      });

      // Показываем начальный прогресс
      await this.responseManager.startProgress(ctx, {
        type: "thinking",
        message: "Распознаю речь...",
        emoji: "🎤",
      });

      // Получаем AI агента
      const agent = await this.aiAgentFactory.getOrCreateAgent(userId);

      // Обрабатываем через AI агента с прогрессом
      const result = await agent.processMessage(chatContext, history, {
        onThinking: async () => {
          await this.responseManager.updateProgress(ctx, {
            type: "thinking",
            message: "Анализирую голосовое сообщение...",
            emoji: "🧠",
          });
        },
        onToolCall: async (progressStep) => {
          await this.responseManager.updateProgress(ctx, progressStep);
        },
      });

      // Форматируем результаты аналогично текстовым сообщениям
      let responseText = result.text || "";

      if (
        result.toolCalls &&
        result.toolResults &&
        result.toolCalls.length > 0
      ) {
        const formattedResults = this.formatToolResults(agent, result);

        if (responseText && formattedResults) {
          responseText = `${responseText}\n\n${formattedResults}`;
        } else {
          responseText =
            formattedResults ||
            responseText ||
            "Голосовое сообщение обработано!";
        }
      } else if (!responseText) {
        responseText = "Голосовое сообщение обработано!";
      }

      const messageId = await this.responseManager.finishProgress(
        ctx,
        responseText
      );

      if (ctx.chat?.id) {
        this.telegramBot.addAssistantResponse(
          ctx.chat.id,
          responseText,
          messageId
        );
      }
    } catch (error) {
      console.error("Ошибка при обработке голосового сообщения:", error);
      const errorMsg = `❌ Произошла ошибка при обработке голосового сообщения: ${error}`;
      await this.responseManager.finishProgress(ctx, errorMsg);
    }
  }

  private async handlePhotoMessage(
    ctx: Context,
    photos: any,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Не удалось определить пользователя");
      return;
    }

    try {
      console.log(`📸 Обработка изображения от пользователя ${userId}`);

      // Извлекаем подпись к изображению
      const caption = ctx.message?.caption || "";

      // Получаем лучшее качество изображения
      const photo = photos[photos.length - 1];
      if (!photo) {
        await ctx.reply("❌ Не удалось получить изображение");
        return;
      }

      // Показываем начальный прогресс
      await this.responseManager.startProgress(ctx, {
        type: "thinking",
        message: "Загружаю изображение...",
        emoji: "📸",
      });

      // Загружаем изображение через TelegramBot
      const imageData = await this.loadImageFromTelegram(ctx, photo);

      // Создаем ChatContext для изображения с данными
      const integrations = await this.aiAgentFactory.getIntegrationsForUser(
        userId
      );
      const chatContext = new ChatContext({
        interactionType: InteractionType.IMAGE,
        userId,
        chatId: ctx.chat?.id || userId,
        messageContent: caption || "Проанализируй это изображение",
        mediaContent: { imageData: imageData },
        integrations,
      });

      // Показываем начальный прогресс
      await this.responseManager.startProgress(ctx, {
        type: "thinking",
        message: "Анализирую изображение...",
        emoji: "🖼️",
      });

      // Получаем AI агента
      const agent = await this.aiAgentFactory.getOrCreateAgent(userId);

      // Обрабатываем через AI агента с прогрессом
      const result = await agent.processMessage(chatContext, history, {
        onThinking: async () => {
          await this.responseManager.updateProgress(ctx, {
            type: "thinking",
            message: "Извлекаю текст из изображения...",
            emoji: "🔍",
          });
        },
        onToolCall: async (progressStep) => {
          await this.responseManager.updateProgress(ctx, progressStep);
        },
      });

      // Форматируем результаты аналогично текстовым сообщениям
      let responseText = result.text || "";

      if (
        result.toolCalls &&
        result.toolResults &&
        result.toolCalls.length > 0
      ) {
        const formattedResults = this.formatToolResults(agent, result);

        if (responseText && formattedResults) {
          responseText = `${responseText}\n\n${formattedResults}`;
        } else {
          responseText =
            formattedResults || responseText || "Изображение обработано!";
        }
      } else if (!responseText) {
        responseText = "Изображение обработано!";
      }

      const messageId = await this.responseManager.finishProgress(
        ctx,
        responseText
      );

      if (ctx.chat?.id) {
        this.telegramBot.addAssistantResponse(
          ctx.chat.id,
          responseText,
          messageId
        );
      }
    } catch (error) {
      console.error("Ошибка при обработке изображения:", error);
      const errorMsg = `❌ Произошла ошибка при обработке изображения: ${error}`;
      await this.responseManager.finishProgress(ctx, errorMsg);
    }
  }

  private async handleForwardMessage(
    ctx: Context,
    message: any,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("❌ Не удалось определить пользователя");
      return;
    }

    try {
      console.log(
        `↗️ Обработка пересланного сообщения от пользователя ${userId}`
      );

      // Извлекаем только текст из пересланного сообщения (без изображений)
      const forwardedText =
        message.text || message.caption || "Переслано сообщение без текста";

      // Получаем информацию об исходном посте (если доступно)
      const forwardInfo = ctx.message?.forward_origin;
      let forwardSource = "Неизвестный источник";

      if (forwardInfo) {
        if (forwardInfo.type === "channel") {
          forwardSource = `@${
            forwardInfo.chat.username ||
            forwardInfo.chat.title ||
            "unknown_channel"
          }`;
        } else if (forwardInfo.type === "user") {
          forwardSource = `${
            forwardInfo.sender_user.first_name || "Пользователь"
          }`;
        }
      }

      // Получаем ссылку на сообщение Telegram если доступно
      let telegramLink = "";
      if (
        forwardInfo &&
        forwardInfo.type === "channel" &&
        forwardInfo.chat.username
      ) {
        const messageId = forwardInfo.message_id || "";
        telegramLink = `https://t.me/${forwardInfo.chat.username}/${messageId}`;
      }

      // Создаем контекст с пометкой о том, что это форвард
      const contextualMessage = `Пересланное сообщение из источника: ${forwardSource}

Полный текст поста:
"${forwardedText}"

Проанализируй сообщение и создай событие в календаре, если это уместно.`;

      // Показываем начальный прогресс
      await this.responseManager.startProgress(ctx, {
        type: "thinking",
        message: "Анализирую пересланное сообщение...",
        emoji: "↗️",
      });

      // Создаем ChatContext для пересланного сообщения
      const integrations = await this.aiAgentFactory.getIntegrationsForUser(
        userId
      );
      const chatContext = new ChatContext({
        interactionType: InteractionType.FORWARD,
        userId,
        chatId: ctx.chat?.id || userId,
        messageContent: contextualMessage,
        metadata: {
          originalMessage: message,
          forwardedText,
          forwardSource,
          forwardInfo,
          telegramLink,
          interactionType: "FORWARD",
        },
        integrations,
      });

      // Получаем AI агента
      const agent = await this.aiAgentFactory.getOrCreateAgent(userId);

      // Обрабатываем через правильный метод с ChatContext
      const result = await agent.processMessage(chatContext, history, {
        onThinking: async () => {
          await this.responseManager.updateProgress(ctx, {
            type: "thinking",
            message: "Анализирую содержимое...",
            emoji: "🧠",
          });
        },
        onToolCall: async (progressStep) => {
          await this.responseManager.updateProgress(ctx, progressStep);
        },
      });

      // Форматируем результаты аналогично текстовым сообщениям
      let responseText = result?.text || "";

      if (
        result?.toolCalls &&
        result?.toolResults &&
        result.toolCalls.length > 0
      ) {
        const formattedResults = this.formatToolResults(agent, result);

        if (responseText && formattedResults) {
          responseText = `${responseText}\n\n${formattedResults}`;
        } else {
          responseText =
            formattedResults ||
            responseText ||
            "Пересланное сообщение обработано!";
        }
      } else if (!responseText) {
        responseText = "Пересланное сообщение обработано!";
      }

      const messageId = await this.responseManager.finishProgress(
        ctx,
        responseText
      );

      if (ctx.chat?.id) {
        this.telegramBot.addAssistantResponse(
          ctx.chat.id,
          responseText,
          messageId
        );
      }
    } catch (error) {
      console.error("Ошибка при обработке пересланного сообщения:", error);
      const errorMsg = `❌ Произошла ошибка при обработке пересланного сообщения: ${error}`;
      await this.responseManager.finishProgress(ctx, errorMsg);
    }
  }

  private formatToolResults(agent: any, result: any): string {
    const responses: string[] = [];

    if (!result.toolCalls || !result.toolResults) {
      return "";
    }

    for (let i = 0; i < result.toolCalls.length; i++) {
      const toolCall = result.toolCalls[i];
      const toolResult = result.toolResults[i];

      if (!toolResult || !toolCall?.toolName) continue;

      // Находим интеграцию, которой принадлежит этот инструмент
      const integrations = agent.getIntegrations();
      for (const integration of integrations) {
        const tools = integration.getTools();
        const tool = tools.find((t: any) => t.name === toolCall.toolName);
        if (tool) {
          const formatted = integration.formatToolResult(
            toolCall.toolName,
            toolResult
          );
          responses.push(formatted);
          break;
        }
      }
    }

    return responses.length > 0 ? responses.join("\n\n") : "";
  }

  private async loadImageFromTelegram(
    ctx: Context,
    photo: any
  ): Promise<string> {
    try {
      // Проверяем валидность photo объекта и file_id
      if (!photo || !photo.file_id || photo.file_id.trim() === "") {
        throw new Error("Invalid photo object or file_id");
      }

      console.log("🔍 Loading image with file_id:", photo.file_id);

      // Получаем информацию о файле через Telegram Bot API
      const fileInfo = await ctx.api.getFile(photo.file_id);

      if (!fileInfo.file_path) {
        throw new Error("File path not available in Telegram response");
      }

      const fileUrl = `https://api.telegram.org/file/bot${this.telegramToken}/${fileInfo.file_path}`;
      console.log("📁 Loading image from URL:", fileUrl);

      // Загружаем изображение
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(
          `HTTP error! status: ${response.status} - ${response.statusText}`
        );
      }

      const imageBuffer = await response.arrayBuffer();
      const base64Data = Buffer.from(imageBuffer).toString("base64");

      // Определяем MIME-тип
      const mimeType = response.headers.get("content-type") || "image/jpeg";
      const imageData = `data:${mimeType};base64,${base64Data}`;

      console.log("✅ Image loaded and converted to base64");
      return imageData;
    } catch (error) {
      console.error("Error loading image from Telegram:", error);
      if (error instanceof Error && error.message.includes("Bad Request")) {
        throw new Error(
          `Invalid file_id or image not found: ${photo?.file_id}`
        );
      }
      throw new Error(`Failed to load image: ${error}`);
    }
  }
}
