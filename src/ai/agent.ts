import { generateText, type ModelMessage, type GenerateTextResult } from "ai";
import { openai } from "@ai-sdk/openai";
import type { Integration } from "../integrations/base/integration";
import type { ProgressStep } from "../core/response-manager";

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
  private tools: Record<string, any> = {};

  constructor(config: AIAgentConfig, integrations: Integration[]) {
    this.config = config;
    this.integrations = integrations;
    process.env.OPENAI_API_KEY = config.openaiApiKey;
    this.setupTools();
  }

  private setupTools(): void {
    for (const integration of this.integrations) {
      const integrationTools = integration.getTools();
      for (const { name, tool } of integrationTools) {
        this.tools[name] = tool;
      }
    }
  }

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
    try {
      // Уведомляем о начале обработки
      if (progressCallback?.onThinking) {
        await progressCallback.onThinking();
      }

      const systemPrompt = this.buildSystemPrompt();
      const messages = this.buildConversationMessages(
        systemPrompt,
        userMessage,
        conversationHistory
      );

      // Прогнозируем возможные tool calls на основе сообщения пользователя
      // и показываем прогресс заранее
      const possibleTools = this.predictToolsFromMessage(userMessage);

      let result: GenerateTextResult<Record<string, any>, any>;

      if (possibleTools.length > 0 && progressCallback?.onToolCall) {
        // Показываем прогресс для наиболее вероятного tool
        const primaryTool = possibleTools[0];
        if (primaryTool) {
          const progressStep = this.getProgressStepForTool(primaryTool);
          await progressCallback.onToolCall(progressStep);
        }
      }

      result = await generateText({
        model: openai(this.config.model || "gpt-5-nano"),
        messages,
        tools: this.tools,
      });

      // Если были вызваны другие tools, уведомляем о них
      if (result.toolCalls && progressCallback?.onToolResult) {
        for (let i = 0; i < result.toolCalls.length; i++) {
          const toolCall = result.toolCalls[i];
          const toolResult = result.toolResults[i];
          if (toolCall && toolResult) {
            await progressCallback.onToolResult(toolCall.toolName, toolResult);
          }
        }
      }

      if (!result.text && result.toolCalls && result.toolResults) {
        const formattedResponse = this.formatToolResults(result);
        return {
          ...result,
          text: formattedResponse,
        };
      }

      return result;
    } catch (error) {
      console.error("Ошибка в AI агенте:", error);
      throw new Error(`Ошибка обработки запроса: ${error}`);
    }
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

  private buildSystemPrompt(): string {
    const integrationsList = this.integrations
      .map((i) => `- ${i.getName()}: ${i.getDescription()}`)
      .join("\n");

    return `Ты - AI ассистент с доступом к следующим интеграциям:
${integrationsList}

Используй доступные инструменты для выполнения задач пользователя.
Отвечай на русском языке.
Будь вежливым и профессиональным.`;
  }

  private buildConversationMessages(
    systemPrompt: string,
    userMessage: string,
    conversationHistory?: string[]
  ): ModelMessage[] {
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    if (conversationHistory && conversationHistory.length > 0) {
      for (let i = 0; i < conversationHistory.length; i++) {
        const content = conversationHistory[i];
        if (content) {
          messages.push({
            role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
            content,
          });
        }
      }
    }

    messages.push({
      role: "user",
      content: userMessage,
    });

    return messages;
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
