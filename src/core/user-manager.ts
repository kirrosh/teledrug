import { UserConfigStorage, type UserConfig } from "../storage/user-config";
import { Integration } from "../integrations/base/integration";
import { IntegrationRegistry } from "../integrations/base/registry";

export class UserManager {
  private userConfigStorage: UserConfigStorage;
  private userIntegrations = new Map<string | number, Integration[]>();

  constructor() {
    this.userConfigStorage = new UserConfigStorage();
  }

  async getOrCreateUser(userId: string | number, username?: string): Promise<UserConfig> {
    let config = await this.userConfigStorage.get(userId);

    if (!config) {
      config = await this.userConfigStorage.createDefaultConfig(userId, username);
    }

    return config;
  }

  async getUserIntegrations(userId: string | number): Promise<Integration[]> {
    if (this.userIntegrations.has(userId)) {
      return this.userIntegrations.get(userId)!;
    }

    const config = await this.getOrCreateUser(userId);
    const integrations: Integration[] = [];

    for (const integrationConfig of config.integrations) {
      if (!integrationConfig.enabled) continue;

      const IntegrationClass = IntegrationRegistry.get(integrationConfig.name);
      if (!IntegrationClass) {
        console.warn(`Integration ${integrationConfig.name} not found in registry`);
        continue;
      }

      try {
        const integration = new IntegrationClass();
        await integration.initialize(integrationConfig.credentials);
        integrations.push(integration);
      } catch (error) {
        console.error(`Failed to initialize ${integrationConfig.name}:`, error);
      }
    }

    this.userIntegrations.set(userId, integrations);
    return integrations;
  }

  async addUserIntegration(
    userId: string | number,
    integrationName: string,
    credentials: Record<string, any>
  ): Promise<void> {
    await this.userConfigStorage.addIntegration(userId, {
      name: integrationName,
      credentials,
      enabled: true,
    });

    // Очищаем кеш интеграций для перезагрузки
    this.userIntegrations.delete(userId);
  }

  async enableIntegration(
    userId: string | number,
    integrationName: string
  ): Promise<void> {
    const config = await this.getUserConfig(userId);
    if (!config) return;

    const integration = config.integrations.find(i => i.name === integrationName);
    if (integration) {
      integration.enabled = true;
      await this.userConfigStorage.save(config);
      
      // Очищаем кэш интеграций для пользователя
      this.userIntegrations.delete(userId);
    }
  }

  async removeUserIntegration(userId: string | number, integrationName: string): Promise<void> {
    await this.userConfigStorage.removeIntegration(userId, integrationName);
    
    // Отключаем интеграцию если она загружена
    const integrations = this.userIntegrations.get(userId);
    if (integrations) {
      const integration = integrations.find(i => i.getName() === integrationName);
      if (integration) {
        await integration.disconnect();
      }
    }
    
    // Очищаем кеш
    this.userIntegrations.delete(userId);
  }

  async getUserConfig(userId: string | number): Promise<UserConfig | undefined> {
    return this.userConfigStorage.get(userId);
  }

  async updateUserConfig(userId: string | number, updates: Partial<UserConfig>): Promise<void> {
    await this.userConfigStorage.update(userId, updates);
  }
}