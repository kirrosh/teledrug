import { generateText, type CoreMessage, type GenerateTextResult } from "ai";
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
      });

      // Уведомляем о результатах tool calls
      if (result.toolCalls && result.toolResults && progressCallback?.onToolResult) {
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

  // Обработка голосовых сообщений с помощью Whisper
  private async processVoiceMessage(
    _chatContext: ChatContext,
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
    // TODO: Реализовать интеграцию с Whisper API
  }

  // Выбор модели в зависимости от типа взаимодействия
  private selectModel(interactionType: InteractionType) {
    // Используем только gpt-5-nano для всех типов взаимодействий
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
        basePrompt += `\n\nПользователь отправил изображение с подписью. Используй только текст подписи для анализа и создай событие в календаре, если это необходимо. Доступен только инструмент createEvent.
        ВАЖНО: У тебя нет возможности анализировать содержимое изображений, работай только с текстом подписи.`;
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
      chatContext.getMessageContent()
    );

    if (possibleTools.length > 0) {
      const primaryTool = possibleTools[0];
      if (primaryTool) {
        const progressStep = this.getProgressStepForTool(primaryTool);
        await progressCallback.onToolCall(progressStep);
      }
    }
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
      integrations: this.integrations
    });

    return this.processMessage(chatContext, conversationHistory, progressCallback);
  }

  private formatToolResults(
    result: GenerateTextResult<Record<string, any>, any>
  ): string {
    const responses: string[] = [];

    if (!result.toolCalls || !result.toolResults) {
      return "Задача выполнена!";
    }

    for (let i = 0; i < result.toolCalls.length; i++) {
      const toolCall = result.toolCalls[i];
      const toolResult = result.toolResults[i];

      if (!toolResult) continue;

      // Находим интеграцию, которой принадлежит этот инструмент
      for (const integration of this.integrations) {
        const tools = integration.getTools();
        const tool = tools.find((t) => t.name === toolCall?.toolName);
        if (tool && toolCall?.toolName) {
          const formatted = integration.formatToolResult(
            toolCall.toolName,
            toolResult
          );
          responses.push(formatted);
          break;
        }
      }
    }

    return responses.length > 0 ? responses.join("\n\n") : "Задача выполнена!";
  }


  private predictToolsFromMessage(message: string): string[] {
    const lowerMessage = message.toLowerCase();
    const possibleTools: string[] = [];

    // Простая эвристика для прогнозирования tools
    if (lowerMessage.includes('календар') || lowerMessage.includes('событи') ||
        lowerMessage.includes('встреч') || lowerMessage.includes('завтра') ||
        lowerMessage.includes('сегодня') || lowerMessage.includes('расписание')) {

      if (lowerMessage.includes('создай') || lowerMessage.includes('добавь') ||
          lowerMessage.includes('запланируй') || lowerMessage.includes('назначь')) {
        possibleTools.push('createEvent');
      } else if (lowerMessage.includes('последн') || lowerMessage.includes('недавн')) {
        possibleTools.push('getLastEvents');
      } else {
        possibleTools.push('getEvents');
      }
    }

    return possibleTools;
  }

  private getProgressStepForTool(toolName: string): ProgressStep {
    // Ищем интеграцию, которая содержит этот инструмент
    for (const integration of this.integrations) {
      const tools = integration.getTools();
      const tool = tools.find(t => t.name === toolName);
      if (tool) {
        return integration.getProgressStep(toolName);
      }
    }

    // Fallback для неизвестных инструментов
    return {
      type: 'tool_call',
      message: 'Выполняю операцию...',
      emoji: '⚙️',
      metadata: { toolName }
    };
  }

  getIntegrations(): Integration[] {
    return this.integrations;
  }
}
