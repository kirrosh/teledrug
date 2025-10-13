INSERT INTO "user_settings" ("user_id", "timezone", "locale", "created_at", "updated_at")
SELECT u."telegram_id", 'UTC', 'ru-RU', now(), now()
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "user_settings" s
  WHERE s."user_id" = u."telegram_id"
);
