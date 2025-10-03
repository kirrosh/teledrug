import { UserRepository } from "./database/repositories/user-repository";

export interface UserIntegrationConfig {
  name: string;
  credentials: Record<string, any>;
  enabled: boolean;
  settings?: Record<string, any>;
}

export interface UserConfig {
  userId: string | number;
  username?: string;
  settings: {
    timezone: string;
    locale: string;
    city?: string | null;
    country?: string | null;
  };
  integrations: UserIntegrationConfig[];
  aiSettings?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  preferences?: Record<string, any>;
}

export class UserConfigStorage {
  private userRepository = new UserRepository();
  private configCache = new Map<string | number, UserConfig>();

  async get(userId: string | number): Promise<UserConfig | undefined> {
    // Check cache first
    if (this.configCache.has(userId)) {
      return this.configCache.get(userId);
    }

    // Load from database
    const numericUserId =
      typeof userId === "string" ? parseInt(userId) : userId;
    const user = await this.userRepository.getUser(numericUserId);

    if (!user) {
      return undefined;
    }

    const settings = await this.userRepository.getUserSettings(numericUserId);
    const preferences = settings.preferences as
      | Record<string, any>
      | null
      | undefined;

    const integrations = await this.userRepository.getAllDecryptedIntegrations(
      numericUserId
    );

    const config: UserConfig = {
      userId: user.telegramId,
      username: user.username || undefined,
      settings: {
        timezone: settings.timezone,
        locale: settings.locale,
        city: settings.city ?? undefined,
        country: settings.country ?? undefined,
      },
      integrations: integrations.map(({ integration, credentials }) => ({
        name: integration.integrationType,
        credentials,
        enabled: integration.enabled,
        settings: integration.settings as Record<string, any> | undefined,
      })),
      aiSettings: {
        model: "gpt-4o-mini",
      },
      preferences: preferences ?? undefined,
    };

    // Cache the config
    this.configCache.set(userId, config);
    return config;
  }

  async save(config: UserConfig): Promise<void> {
    const numericUserId =
      typeof config.userId === "string"
        ? parseInt(config.userId)
        : config.userId;

    // Ensure user exists
    await this.userRepository.getOrCreateUser(numericUserId, config.username);

    const settingsPatch: {
      timezone?: string;
      locale?: string;
      city?: string | null;
      country?: string | null;
      preferences?: Record<string, any> | null;
    } = {};

    if (config.settings && "timezone" in config.settings) {
      settingsPatch.timezone = config.settings.timezone;
    }

    if (config.settings && "locale" in config.settings) {
      settingsPatch.locale = config.settings.locale;
    }

    if (config.settings && "city" in config.settings) {
      settingsPatch.city = config.settings.city ?? null;
    }

    if (config.settings && "country" in config.settings) {
      settingsPatch.country = config.settings.country ?? null;
    }

    if (config.preferences !== undefined) {
      settingsPatch.preferences = config.preferences ?? null;
    }

    if (Object.keys(settingsPatch).length > 0) {
      await this.userRepository.updateUserSettings(
        numericUserId,
        settingsPatch
      );
    }

    // Save each integration
    for (const integration of config.integrations) {
      await this.userRepository.addIntegration(
        numericUserId,
        integration.name,
        integration.credentials,
        integration.settings
      );
    }

    // Update cache
    this.configCache.set(config.userId, config);
  }

  async update(
    userId: string | number,
    updates: Partial<UserConfig>
  ): Promise<void> {
    const existing = await this.get(userId);
    if (existing) {
      const updated = { ...existing, ...updates };
      await this.save(updated);
      // Clear cache to force reload
      this.configCache.delete(userId);
    }
  }

  async addIntegration(
    userId: string | number,
    integration: UserIntegrationConfig
  ): Promise<void> {
    const numericUserId =
      typeof userId === "string" ? parseInt(userId) : userId;

    await this.userRepository.addIntegration(
      numericUserId,
      integration.name,
      integration.credentials,
      integration.settings
    );

    // Clear cache to force reload
    this.configCache.delete(userId);
  }

  async removeIntegration(
    userId: string | number,
    integrationName: string
  ): Promise<void> {
    const numericUserId =
      typeof userId === "string" ? parseInt(userId) : userId;

    await this.userRepository.removeIntegration(numericUserId, integrationName);

    // Clear cache to force reload
    this.configCache.delete(userId);
  }

  async createDefaultConfig(
    userId: string | number,
    username?: string
  ): Promise<UserConfig> {
    const numericUserId =
      typeof userId === "string" ? parseInt(userId) : userId;

    // Create user in database
    await this.userRepository.getOrCreateUser(numericUserId, username);

    // Return the created config (will have empty integrations array)
    const config = await this.get(userId);
    return config!;
  }
}
