import { eq, and } from 'drizzle-orm';
import { db } from '../client';
import { users, userIntegrations, type User, type NewUser, type UserIntegration, type NewUserIntegration } from '../schema';
import { getEncryptionService } from '../../../security/encryption';

export class UserRepository {
  private encryptionService = getEncryptionService();

  // User operations
  async createUser(user: NewUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    if (!newUser) {
      throw new Error('Failed to create user');
    }
    return newUser;
  }

  async getUser(telegramId: number): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user || null;
  }

  async getOrCreateUser(telegramId: number, username?: string): Promise<User> {
    let user = await this.getUser(telegramId);

    if (!user) {
      user = await this.createUser({
        telegramId,
        username,
      });
    } else if (username && user.username !== username) {
      // Update username if changed
      const [updated] = await db.update(users)
        .set({ username, updatedAt: new Date() })
        .where(eq(users.telegramId, telegramId))
        .returning();
      if (!updated) {
        throw new Error('Failed to update user');
      }
      user = updated;
    }

    return user;
  }

  // Integration operations
  async addIntegration(
    userId: number,
    integrationType: string,
    credentials: Record<string, any>,
    settings?: Record<string, any>
  ): Promise<UserIntegration> {
    // Encrypt credentials
    const encrypted = this.encryptionService.encryptJson(credentials);

    // Check if integration already exists
    const existing = await this.getIntegration(userId, integrationType);

    if (existing) {
      // Update existing integration
      const [updated] = await db.update(userIntegrations)
        .set({
          credentialsEncrypted: encrypted.encrypted,
          credentialsIv: encrypted.iv,
          credentialsTag: encrypted.tag,
          settings,
          enabled: true,
          updatedAt: new Date(),
        })
        .where(and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.integrationType, integrationType)
        ))
        .returning();
      if (!updated) {
        throw new Error('Failed to update integration');
      }
      return updated;
    } else {
      // Create new integration
      const [newIntegration] = await db.insert(userIntegrations).values({
        userId,
        integrationType,
        credentialsEncrypted: encrypted.encrypted,
        credentialsIv: encrypted.iv,
        credentialsTag: encrypted.tag,
        settings,
        enabled: true,
      }).returning();
      if (!newIntegration) {
        throw new Error('Failed to create integration');
      }
      return newIntegration;
    }
  }

  async getIntegration(userId: number, integrationType: string): Promise<UserIntegration | undefined> {
    const [integration] = await db.select()
      .from(userIntegrations)
      .where(and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType)
      ));
    return integration;
  }

  async getUserIntegrations(userId: number): Promise<UserIntegration[]> {
    return db.select()
      .from(userIntegrations)
      .where(eq(userIntegrations.userId, userId));
  }

  async getDecryptedIntegration(userId: number, integrationType: string): Promise<{
    integration: UserIntegration;
    credentials: Record<string, any>;
  } | undefined> {
    const integration = await this.getIntegration(userId, integrationType);

    if (!integration) {
      return undefined;
    }

    const credentials = this.encryptionService.decryptJson(
      integration.credentialsEncrypted,
      integration.credentialsIv,
      integration.credentialsTag
    );

    return {
      integration,
      credentials,
    };
  }

  async getAllDecryptedIntegrations(userId: number): Promise<Array<{
    integration: UserIntegration;
    credentials: Record<string, any>;
  }>> {
    const integrations = await this.getUserIntegrations(userId);

    return integrations.map(integration => ({
      integration,
      credentials: this.encryptionService.decryptJson(
        integration.credentialsEncrypted,
        integration.credentialsIv,
        integration.credentialsTag
      ),
    }));
  }

  async removeIntegration(userId: number, integrationType: string): Promise<void> {
    await db.delete(userIntegrations)
      .where(and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType)
      ));
  }

  async toggleIntegration(userId: number, integrationType: string, enabled: boolean): Promise<void> {
    await db.update(userIntegrations)
      .set({ enabled, updatedAt: new Date() })
      .where(and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType)
      ));
  }
}