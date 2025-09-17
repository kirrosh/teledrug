import { AIAgent } from "../ai/agent";
import { UserManager } from "./user-manager";
import type { Integration } from "../integrations/base/integration";

export class AIAgentFactory {
  private userManager: UserManager;
  private openaiApiKey: string;
  private agents = new Map<string | number, AIAgent>();

  constructor(userManager: UserManager, openaiApiKey: string) {
    this.userManager = userManager;
    this.openaiApiKey = openaiApiKey;
  }

  async getOrCreateAgent(userId: string | number): Promise<AIAgent> {
    // Проверяем кеш
    if (this.agents.has(userId)) {
      return this.agents.get(userId)!;
    }

    // Получаем конфигурацию пользователя
    const userConfig = await this.userManager.getOrCreateUser(userId);
    
    // Получаем интеграции пользователя
    const integrations = await this.userManager.getUserIntegrations(userId);

    // Создаем AI агента с интеграциями пользователя
    const agent = new AIAgent(
      {
        openaiApiKey: this.openaiApiKey,
        model: userConfig.aiSettings?.model || "gpt-5-nano",
        temperature: userConfig.aiSettings?.temperature || 0.7,
        userId,
      },
      integrations
    );

    // Кешируем агента
    this.agents.set(userId, agent);

    return agent;
  }

  async refreshAgent(userId: string | number): Promise<AIAgent> {
    // Удаляем из кеша
    this.agents.delete(userId);
    
    // Создаем заново
    return this.getOrCreateAgent(userId);
  }

  clearCache(): void {
    this.agents.clear();
  }

  getCachedAgent(userId: string | number): AIAgent | undefined {
    return this.agents.get(userId);
  }

  async getIntegrationsForUser(userId: string | number): Promise<Integration[]> {
    return await this.userManager.getUserIntegrations(userId);
  }
}