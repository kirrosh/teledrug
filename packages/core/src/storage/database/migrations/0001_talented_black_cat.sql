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
ALTER TABLE "digest_module_settings" ADD CONSTRAINT "digest_module_settings_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_module_settings" ADD CONSTRAINT "digest_module_settings_module_id_digest_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."digest_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_digest_module_settings_user_id" ON "digest_module_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_digest_module_settings_module_id" ON "digest_module_settings" USING btree ("module_id");