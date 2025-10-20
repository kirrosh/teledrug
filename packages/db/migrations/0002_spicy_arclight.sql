CREATE SCHEMA "journal";
--> statement-breakpoint
CREATE TYPE "public"."journal_energy" AS ENUM('very_low', 'low', 'medium', 'high', 'very_high');--> statement-breakpoint
CREATE TYPE "public"."journal_mood" AS ENUM('very_negative', 'negative', 'neutral', 'positive', 'very_positive', 'mixed');--> statement-breakpoint
CREATE TABLE "journal"."entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"entry_date" date DEFAULT now() NOT NULL,
	"title" varchar(90) NOT NULL,
	"content" text NOT NULL,
	"mood" "journal_mood" NOT NULL,
	"energy" "journal_energy" NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"ai_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal"."entry_tags" (
	"entry_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entry_tags_entry_id_tag_id_unique" UNIQUE("entry_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "journal"."tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "journal"."entries" ADD CONSTRAINT "entries_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."entry_tags" ADD CONSTRAINT "entry_tags_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "journal"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."entry_tags" ADD CONSTRAINT "entry_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "journal"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."tags" ADD CONSTRAINT "tags_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_journal_entries_user_date" ON "journal"."entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX "idx_journal_entry_tags_entry_id" ON "journal"."entry_tags" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_journal_entry_tags_tag_id" ON "journal"."entry_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_journal_tags_user_id" ON "journal"."tags" USING btree ("user_id");