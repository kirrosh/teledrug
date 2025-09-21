import {
  pgTable,
  bigint,
  varchar,
  timestamp,
  serial,
  text,
  boolean,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  username: varchar("username", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.telegramId, { onDelete: "cascade" })
      .notNull(),
    integrationType: varchar("integration_type", { length: 50 }).notNull(),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    credentialsIv: varchar("credentials_iv", { length: 32 }).notNull(),
    credentialsTag: varchar("credentials_tag", { length: 32 }).notNull(),
    settings: jsonb("settings"),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIntegrationUnique: unique().on(table.userId, table.integrationType),
    userIdIndex: index("idx_user_integrations_user_id").on(table.userId),
  })
);

export const digestModules = pgTable(
  "digest_modules",
  {
    id: serial("id").primaryKey(),
    module: varchar("module", { length: 50 }).notNull(),
    description: varchar("description", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    moduleUnique: unique().on(table.module),
  })
);

export const digestModuleSettings = pgTable(
  "digest_module_settings",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.telegramId, { onDelete: "cascade" })
      .notNull(),
    moduleId: bigint("module_id", { mode: "number" })
      .references(() => digestModules.id, { onDelete: "cascade" })
      .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    settings: jsonb("settings"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userModuleUnique: unique().on(table.userId, table.moduleId),
    userIdIndex: index("idx_digest_module_settings_user_id").on(table.userId),
    moduleIdIndex: index("idx_digest_module_settings_module_id").on(
      table.moduleId
    ),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type DigestModule = typeof digestModules.$inferSelect;
export type DigestModuleSetting = typeof digestModuleSettings.$inferSelect;
