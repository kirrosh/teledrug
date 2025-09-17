import type { ModelMessage, Tool } from "ai";
import type { Integration } from "../integrations/base/integration";
import {
  InteractionType,
  type ChatContextConfig,
} from "../types/interaction-types";

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
  getAvailableTools(): Record<string, Tool> {
    const availableTools: Record<string, Tool> = {};

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

  // Проверка доступности конкретного инструмента на основе прав (read/write)
  private isToolAvailable(integration: Integration, toolName: string): boolean {
    const toolMetadata = integration.getToolMetadata(toolName);

    // Проверяем поддержку типа взаимодействия
    if (
      !toolMetadata.supportedInteractionTypes.includes(this.interactionType)
    ) {
      return false;
    }

    // Фильтрация на основе прав read/write в зависимости от типа взаимодействия
    switch (this.interactionType) {
      case InteractionType.IMAGE:
      case InteractionType.FORWARD:
        // Только инструменты с write-правами (создание событий)
        return toolMetadata.permissions.write;

      case InteractionType.TEXT:
      case InteractionType.VOICE:
        // Полный доступ к инструментам - и read, и write
        return toolMetadata.permissions.read || toolMetadata.permissions.write;

      default:
        return false;
    }
  }

  // Построение сообщений для Vercel AI SDK
  buildMessages(
    systemPrompt: string,
    conversationHistory?: string[]
  ): ModelMessage[] {
    const messages: ModelMessage[] = [
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
  private buildCurrentMessage(): ModelMessage {
    // Для изображений создаем многочастное сообщение с изображением и текстом
    if (
      this.interactionType === InteractionType.IMAGE &&
      this.mediaContent?.imageData
    ) {
      const content: any[] = [];

      // Добавляем изображение
      content.push({
        type: "image",
        image: this.mediaContent.imageData, // base64 data URL или buffer
      });

      // Добавляем текст (подпись или инструкцию)
      const textContent =
        this.messageContent ||
        "Проанализируй это изображение и создай событие в календаре, если найдешь информацию о встречах, событиях или расписании.";
      content.push({
        type: "text",
        text: textContent,
      });

      return {
        role: "user",
        content,
      };
    }

    // Для всех остальных типов используем простое текстовое сообщение
    return {
      role: "user",
      content: this.messageContent,
    };
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
