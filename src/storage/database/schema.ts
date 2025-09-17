import { pgTable, bigint, varchar, timestamp, serial, text, boolean, jsonb, unique, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
  username: varchar('username', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userIntegrations = pgTable('user_integrations', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).references(() => users.telegramId, { onDelete: 'cascade' }).notNull(),
  integrationType: varchar('integration_type', { length: 50 }).notNull(),
  credentialsEncrypted: text('credentials_encrypted').notNull(),
  credentialsIv: varchar('credentials_iv', { length: 32 }).notNull(),
  credentialsTag: varchar('credentials_tag', { length: 32 }).notNull(),
  settings: jsonb('settings'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIntegrationUnique: unique().on(table.userId, table.integrationType),
  userIdIndex: index('idx_user_integrations_user_id').on(table.userId),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;