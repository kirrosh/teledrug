import { Effect, Console } from "effect";
import { db, sql } from "../../storage/database/client";
import { users } from "../../storage/database/schema";

const greetingMessage = "Привет! Хорошего дня!";

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

const sendTelegramMessage = (token: string, chatId: number, text: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chat_id: chatId, text }),
      }
    );

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(
        `Telegram API error for chat ${chatId}: ${response.status} ${payload}`
      );
    }
  });

const program = Effect.gen(function* () {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    yield* Console.log("❌ TELEGRAM_BOT_TOKEN is not set; aborting job");
    return;
  }

  const recipients = yield* fetchRecipients;

  if (recipients.length === 0) {
    yield* Console.log(
      "⚠️ Daily greeting skipped: no recipients found in database"
    );
    return;
  }

  let success = 0;

  yield* Effect.forEach(
    recipients,
    (chatId) =>
      sendTelegramMessage(token, chatId, greetingMessage).pipe(
        Effect.tapBoth({
          onSuccess: () =>
            Effect.sync(() => {
              success += 1;
            }),
          onFailure: (error) =>
            Console.error(`❌ Failed to send greeting to ${chatId}:`, error),
        }),
        Effect.catchAll(() => Effect.void)
      ),
    { discard: true }
  );

  yield* Console.log(
    `✅ Daily greeting processed (${success}/${recipients.length})`
  );
});

Effect.runPromise(program)
  .catch((error) => {
    console.error("❌ Daily greeting job failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    return await sql
      .end()
      .catch((error) =>
        console.error("⚠️ Failed to close database connection:", error)
      );
  })
  .then(() => {
    process.exit(process.exitCode ?? 0);
  });
