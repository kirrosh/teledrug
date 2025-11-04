CREATE TABLE "digest_module_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"module_id" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "digest_module_settings_user_id_module_id_unique" UNIQUE("user_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "digest_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"module" varchar(50) NOT NULL,
	"description" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "digest_modules_module_unique" UNIQUE("module")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"user_id" bigint NOT NULL,
	"provider" varchar(50) NOT NULL,
	"state" varchar(128) NOT NULL,
	"code_verifier" varchar(128) NOT NULL,
	"metadata" jsonb,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'todo' NOT NULL,
	"due_at" timestamp,
	"start_at" timestamp,
	"end_at" timestamp,
	"calendar_event_id" varchar(255),
	"calendar_event_url" text,
	"telegram_message_id" bigint,
	"telegram_chat_id" bigint,
	"location" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"integration_type" varchar(50) NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"credentials_iv" varchar(32) NOT NULL,
	"credentials_tag" varchar(32) NOT NULL,
	"settings" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_integrations_user_id_integration_type_unique" UNIQUE("user_id","integration_type")
);
--> statement-breakpoint
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
CREATE TABLE "users" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"username" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digest_module_settings" ADD CONSTRAINT "digest_module_settings_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_module_settings" ADD CONSTRAINT "digest_module_settings_module_id_digest_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."digest_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_digest_module_settings_user_id" ON "digest_module_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_digest_module_settings_module_id" ON "digest_module_settings" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_sessions_session_id" ON "oauth_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_sessions_expires_at" ON "oauth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_status" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_due" ON "tasks" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_start" ON "tasks" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_calendar_event" ON "tasks" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "idx_user_integrations_user_id" ON "user_integrations" USING btree ("user_id");