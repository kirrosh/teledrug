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

// Journal schema
export const journalSchema = pgSchema("journal");

export const journalMoodEnum = pgEnum("journal_mood", [
  "very_negative",
  "negative",
  "neutral",
  "positive",
  "very_positive",
  "mixed",
]);

export const journalEnergyEnum = pgEnum("journal_energy", [
  "very_low",
  "low",
  "medium",
  "high",
  "very_high",
]);

export const journalTags = journalSchema.table(
  "tags",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.telegramId, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userTagUnique: unique().on(table.userId, table.name),
    userIdIndex: index("idx_journal_tags_user_id").on(table.userId),
  })
);

export const journalEntries = journalSchema.table(
  "entries",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.telegramId, { onDelete: "cascade" })
      .notNull(),
    entryDate: date("entry_date").defaultNow().notNull(),
    title: varchar("title", { length: 90 }).notNull(),
    content: text("content").notNull(),
    mood: journalMoodEnum("mood").notNull(),
    energy: journalEnergyEnum("energy").notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    aiMetadata: jsonb("ai_metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userDateIndex: index("idx_journal_entries_user_date").on(
      table.userId,
      table.entryDate
    ),
  })
);

export const journalEntryTags = journalSchema.table(
  "entry_tags",
  {
    entryId: integer("entry_id")
      .references(() => journalEntries.id, { onDelete: "cascade" })
      .notNull(),
    tagId: integer("tag_id")
      .references(() => journalTags.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entryTagUnique: unique().on(table.entryId, table.tagId),
    entryIndex: index("idx_journal_entry_tags_entry_id").on(table.entryId),
    tagIndex: index("idx_journal_entry_tags_tag_id").on(table.tagId),
  })
);

export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type JournalTag = typeof journalTags.$inferSelect;
export type NewJournalTag = typeof journalTags.$inferInsert;

// Tasks schema
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .references(() => users.telegramId, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).default("todo").notNull(),
    dueAt: timestamp("due_at"),
    startAt: timestamp("start_at"),
    durationMin: integer("duration_min"),
    priority: integer("priority"),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`).notNull(),
    calendarEventId: varchar("calendar_event_id", { length: 255 }),
    sourceEntryId: integer("source_entry_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("idx_tasks_user_status").on(table.userId, table.status),
    userDueIdx: index("idx_tasks_user_due").on(table.userId, table.dueAt),
  })
);

export const taskReminders = pgTable(
  "task_reminders",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    remindAt: timestamp("remind_at").notNull(),
    sentAt: timestamp("sent_at"),
  },
  (table) => ({
    remindAtIdx: index("idx_task_reminders_remind_at").on(table.remindAt),
  })
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskReminder = typeof taskReminders.$inferSelect;
export type NewTaskReminder = typeof taskReminders.$inferInsert;
