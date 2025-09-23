import { Effect, Console, Layer } from "effect";
import { db, sql } from "../../storage/database/client";
import { users } from "../../storage/database/schema";

const fetchRecipients = Effect.tryPromise(async () => {
  const rows = await db.select({ telegramId: users.telegramId }).from(users);
  return rows
    .map((row) => row.telegramId)
    .filter((value): value is number => Number.isFinite(value));
}).pipe(
  Effect.catchAll((error) =>
    Console.error("❌ Failed to fetch recipients from database:", error).pipe(
      Effect.flatMap(() => Effect.succeed<readonly number[]>([]))
    )
  )
);

const sendTelegramMessage = (
  token: string,
  chatId: number,
  text: string
) =>
  Effect.tryPromise(async () => {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }
    );
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Telegram API error for chat ${chatId}: ${response.status} ${payload}`);
    }
  }).pipe(
    Effect.as(true),
    Effect.catchAll((error) =>
      Console.error(`❌ Failed to send evening prompt to ${chatId}:`, error).pipe(
        Effect.flatMap(() => Effect.succeed(false))
      )
    )
  );

const formatEveningPrompt = () =>
  "🌙 Добрый вечер!\n\nПодведём итоги дня? Коротко ответь: что получилось, что улучшить, за что благодарен.\n\nМожешь написать: \"Итоги дня: ...\"";

const program = Effect.gen(function* () {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    yield* Console.log("❌ TELEGRAM_BOT_TOKEN is not set; aborting evening job");
    return;
  }

  const recipients = yield* fetchRecipients;
  if (recipients.length === 0) {
    yield* Console.log("⚠️ Evening prompt skipped: no recipients found");
    return;
  }

  const text = formatEveningPrompt();
  let success = 0;
  yield* Effect.forEach(
    recipients,
    (chatId) =>
      Effect.gen(function* () {
        const sent = yield* sendTelegramMessage(token, chatId, text);
        if (sent) success += 1;
      }),
    { discard: true }
  );

  yield* Console.log(`✅ Evening prompts sent (${success}/${recipients.length})`);
}).pipe(Layer.use(Layer.empty));

Effect.runPromise(program)
  .catch((error) => {
    console.error("❌ Evening prompt job failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    return await sql
      .end()
      .catch((error) => console.error("⚠️ Failed to close DB connection:", error));
  })
  .then(() => {
    process.exit(process.exitCode ?? 0);
  });

