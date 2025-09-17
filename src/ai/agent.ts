import { generateText, type GenerateTextResult } from "ai";
import { openai } from "@ai-sdk/openai";
import type { Integration } from "../integrations/base/integration";
import type { ProgressStep } from "../core/response-manager";
import { ChatContext } from "../core/chat-context";
import { InteractionType } from "../types/interaction-types";

export interface AIAgentConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  userId: string | number;
}

export interface ProgressCallback {
  onThinking?: () => Promise<void>;
  onToolCall?: (step: ProgressStep) => Promise<void>;
  onToolResult?: (toolName: string, result: any) => Promise<void>;
}

export class AIAgent {
  private config: AIAgentConfig;
  private integrations: Integration[];

  constructor(config: AIAgentConfig, integrations: Integration[]) {
    this.config = config;
    this.integrations = integrations;
    process.env.OPENAI_API_KEY = config.openaiApiKey;
  }

  // Новый основной метод для обработки сообщений через ChatContext
  async processMessage(
    chatContext: ChatContext,
    conversationHistory?: string[],
    progressCallback?: ProgressCallback
  ): Promise<GenerateTextResult<Record<string, any>, any>> {
    try {
      // Уведомляем о начале обработки
      if (progressCallback?.onThinking) {
        await progressCallback.onThinking();
      }

      // Голосовые сообщения уже обработаны в TelegramBot (распознавание через Whisper)
      // Здесь просто отмечаем что это голосовое сообщение для логирования
      if (chatContext.getInteractionType() === InteractionType.VOICE) {
        console.log("🎤 Processing voice message (already transcribed)");
      }

      // Получаем доступные инструменты через ChatContext
      const availableTools = chatContext.getAvailableTools();

      // Строим сообщения для AI SDK
      const systemPrompt = this.buildSystemPrompt(chatContext);
      const messages = chatContext.buildMessages(
        systemPrompt,
        conversationHistory
      );

      // Определяем модель на основе типа взаимодействия
      const model = this.selectModel(chatContext.getInteractionType());

      // Показываем общий прогресс обработки
      if (progressCallback?.onToolCall) {
        await progressCallback.onToolCall({
          type: "tool_call",
          message: "Анализирую запрос...",
          emoji: "🤔",
        });
      }

      // Используем Vercel AI SDK для генерации ответа
      const result = await generateText({
        model,
        messages,
        tools: availableTools,
      });

      // Уведомляем о вызовах инструментов с их метаданными
      if (result.toolCalls && progressCallback?.onToolCall) {
        for (const toolCall of result.toolCalls) {
          if (toolCall?.toolName) {
            // Ищем интеграцию, которой принадлежит этот инструмент
            for (const integration of this.integrations) {
              const tools = integration.getTools();
              const tool = tools.find((t) => t.name === toolCall.toolName);
              if (tool) {
                // Получаем progressStep с метаданными из интеграции
                const progressStep = integration.getProgressStep(toolCall.toolName);
                await progressCallback.onToolCall(progressStep);
                break;
              }
            }
          }
        }
      }

      // Уведомляем о результатах tool calls
      if (
        result.toolCalls &&
        result.toolResults &&
        progressCallback?.onToolResult
      ) {
        for (let i = 0; i < result.toolCalls.length; i++) {
          const toolCall = result.toolCalls[i];
          const toolResult = result.toolResults[i];
          if (toolCall && toolResult) {
            await progressCallback.onToolResult(toolCall.toolName, toolResult);
          }
        }
      }

      return result;
    } catch (error) {
      console.error("Ошибка в AI агенте:", error);
      throw new Error(`Ошибка обработки запроса: ${error}`);
    }
  }

  // Выбор модели в зависимости от типа взаимодействия
  private selectModel(interactionType: InteractionType) {
    // Для изображений используем модель с поддержкой vision
    if (interactionType === InteractionType.IMAGE) {
      return openai("gpt-4o");
    }
    // Для всех остальных типов используем gpt-5-nano
    return openai(this.config.model || "gpt-5-nano");
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
        basePrompt += `\n\nПользователь отправил изображение. Проанализируй содержимое изображения и текст подписи (если есть), и создай событие в календаре, если найдешь информацию о встречах, событиях, расписании. Доступен только инструмент createEvent.
        Обрати внимание на: даты, время, места, названия событий, имена людей.`;
        break;
      case InteractionType.FORWARD:
        basePrompt += `\n\nПользователь переслал сообщение. Проанализируй контент и создай событие в календаре, если это необходимо. Доступен только инструмент createEvent.`;
        break;
    }

    return basePrompt;
  }

  // Устаревшие методы - оставляем для обратной совместимости
  async chat(
    userMessage: string,
    conversationHistory?: string[]
  ): Promise<GenerateTextResult<Record<string, any>, any>> {
    return this.chatWithProgress(userMessage, conversationHistory);
  }

  async chatWithProgress(
    userMessage: string,
    conversationHistory?: string[],
    progressCallback?: ProgressCallback
  ): Promise<GenerateTextResult<Record<string, any>, any>> {
    // Создаем ChatContext для обратной совместимости
    const chatContext = new ChatContext({
      interactionType: InteractionType.TEXT,
      userId: this.config.userId,
      chatId: this.config.userId, // используем userId как chatId для совместимости
      messageContent: userMessage,
      integrations: this.integrations,
    });

    return this.processMessage(
      chatContext,
      conversationHistory,
      progressCallback
    );
  }


  getIntegrations(): Integration[] {
    return this.integrations;
  }
}
