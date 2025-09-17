import type { CoreMessage, CoreTool } from "ai";
import type { Integration } from "../integrations/base/integration";
import { InteractionType, type ChatContextConfig } from "../types/interaction-types";

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

    // Для изображений используем только текстовую подпись, так как gpt-5-nano не поддерживает изображения
    if (this.interactionType === InteractionType.IMAGE) {
      return {
        role: "user",
        content: this.messageContent || "Пользователь отправил изображение. Создай событие если нужно на основе контекста."
      };
    }

    return baseMessage;
  }

  // Геттеры
  getInteractionType(): InteractionType {
    return this.interactionType;
  }

  getUserId(): string | number {
    return this.userId;
  }

  getChatId(): string | number {
    return this.chatId;
  }

  getMessageContent(): string {
    return this.messageContent;
  }

  getMediaContent(): any {
    return this.mediaContent;
  }

  // Сеттер для обновления content после обработки (например, после распознавания речи)
  updateMessageContent(content: string): void {
    this.messageContent = content;
  }
}