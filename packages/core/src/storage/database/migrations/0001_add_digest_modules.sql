CREATE TABLE IF NOT EXISTS "digest_modules" (
  "id" SERIAL PRIMARY KEY,
  "module" VARCHAR(50) NOT NULL UNIQUE,
  "description" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "digest_module_settings" (
  "id" SERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("telegram_id") ON DELETE CASCADE,
  "module_id" INTEGER NOT NULL REFERENCES "digest_modules"("id") ON DELETE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "settings" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "digest_module_user_unique" UNIQUE ("user_id", "module_id")
);

CREATE INDEX IF NOT EXISTS "idx_digest_module_settings_user_id"
  ON "digest_module_settings"("user_id");

CREATE INDEX IF NOT EXISTS "idx_digest_module_settings_module_id"
  ON "digest_module_settings"("module_id");

INSERT INTO "digest_modules" ("module", "description") VALUES
  ('weather', 'Daily weather forecast'),
  ('fx', 'Currency exchange rate'),
  ('calendar', 'Calendar events digest')
ON CONFLICT ("module") DO NOTHING;
