CREATE TABLE "user_settings" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"locale" varchar(10) DEFAULT 'ru-RU' NOT NULL,
	"city" varchar(100),
	"country" varchar(100),
	"preferences" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;