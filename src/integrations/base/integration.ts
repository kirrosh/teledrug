import type { Tool, TypedToolResult } from "ai";
import type { ProgressStep } from "../../core/response-manager";

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
  tool: Tool<any, any>;
}

export abstract class Integration {
  protected config: IntegrationConfig;
  protected credentials?: IntegrationCredentials;
  protected isAuthenticated: boolean = false;

  constructor(config: IntegrationConfig) {
    this.config = config;
  }

  abstract authenticate(credentials: IntegrationCredentials): Promise<boolean>;

  abstract getTools(): IntegrationTool[];

  abstract formatToolResult(
    toolName: string,
    result: TypedToolResult<Record<string, any>>
  ): string;

  abstract getProgressStep(toolName: string): ProgressStep;

  abstract disconnect(): Promise<void>;

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
