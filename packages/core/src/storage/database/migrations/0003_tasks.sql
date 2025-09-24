CREATE TABLE IF NOT EXISTS "tasks" (
  "id" SERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("telegram_id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'todo',
  "due_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_reminders" (
  "id" SERIAL PRIMARY KEY,
  "task_id" INTEGER NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "remind_at" TIMESTAMP NOT NULL,
  "sent_at" TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_user_status" ON "tasks" ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_user_due" ON "tasks" ("user_id", "due_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_reminders_remind_at" ON "task_reminders" ("remind_at");
