import type { Tool, TypedToolResult } from "ai";
import type { ProgressStep } from "../../core/response-manager";
import type {
  ToolMetadata,
  InteractionType,
} from "../../types/interaction-types";

export interface IntegrationConfig {
  name: string;
  description: string;
  version: string;
}

export interface IntegrationCredentials {
  [key: string]: any;
}

export interface IntegrationTool {
  name: string;
  tool: Tool;
}

export abstract class Integration {
  protected config: IntegrationConfig;
  protected credentials?: IntegrationCredentials;
  protected isAuthenticated: boolean = false;

  // Новое: метаданные инструментов
  protected toolsMetadata: Map<string, ToolMetadata> = new Map();

  // Контекст для текущего сообщения (передается при вызове tools)
  protected currentMessageContext: any = null;

  constructor(config: IntegrationConfig) {
    this.config = config;
    this.initializeToolsMetadata();
  }

  // Установка контекста сообщения
  setMessageContext(context: any): void {
    this.currentMessageContext = context;
  }

  // Получение контекста сообщения
  getMessageContext(): any {
    return this.currentMessageContext;
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
  isToolAvailableForInteraction(
    toolName: string,
    interactionType: InteractionType
  ): boolean {
    const metadata = this.toolsMetadata.get(toolName);
    return metadata
      ? metadata.supportedInteractionTypes.includes(interactionType)
      : false;
  }

  // Получение прогресс-сообщения для инструмента
  getToolProgressStep(toolName: string): ProgressStep {
    const metadata = this.getToolMetadata(toolName);
    return {
      type: "tool_call",
      message: metadata.progressMessage,
      emoji: metadata.progressEmoji,
      metadata: {
        toolName,
        integration: this.getName(),
        permissions: metadata.permissions,
      },
    };
  }

  abstract authenticate(credentials: IntegrationCredentials): Promise<boolean>;

  abstract getTools(): IntegrationTool[];

  abstract formatToolResult(
    toolName: string,
    result: TypedToolResult<Record<string, any>>
  ): string;

  abstract disconnect(): Promise<void>;

  // Обновленный метод getProgressStep для использования метаданных
  getProgressStep(toolName: string): ProgressStep {
    return this.getToolProgressStep(toolName);
  }

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
