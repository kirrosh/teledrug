DROP TABLE "task_reminders" CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "start_at";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "duration_min";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "priority";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "calendar_event_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "source_entry_id";