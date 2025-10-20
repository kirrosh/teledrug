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
  pgSchema,
  pgEnum,
  date,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  username: varchar("username", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userSettings = pgTable("user_settings", {
  userId: bigint("user_id", { mode: "number" })
    .references(() => users.telegramId, { onDelete: "cascade" })
    .primaryKey(),
  timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
  locale: varchar("locale", { length: 10 }).default("ru-RU").notNull(),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }),
  preferences: jsonb("preferences"),
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
export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type DigestModule = typeof digestModules.$inferSelect;
export type DigestModuleSetting = typeof digestModuleSettings.$inferSelect;

// Tasks schema
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.telegramId, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    status: varchar("status", { length: 20 }).default("todo").notNull(),
    dueAt: timestamp("due_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("idx_tasks_user_status").on(table.userId, table.status),
    userDueIdx: index("idx_tasks_user_due").on(table.userId, table.dueAt),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
