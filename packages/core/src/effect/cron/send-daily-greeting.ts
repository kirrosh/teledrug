import { Effect, Console } from "effect";
import { db } from "../../storage/database/client";
import { users } from "../../storage/database/schema";

const greetingMessage =
  process.env.DIGEST_GREETING_MESSAGE ?? "Привет! Хорошего дня!";

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

const fallbackRecipients = (): readonly number[] => {
  const raw = process.env.DEFAULT_DIGEST_CHAT_ID;
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
};

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

  const recipientsFromDb = yield* fetchRecipients;
  const recipients =
    recipientsFromDb.length > 0 ? recipientsFromDb : fallbackRecipients();

  if (recipients.length === 0) {
    yield* Console.log(
      "⚠️ Daily greeting skipped: no recipients in database or DEFAULT_DIGEST_CHAT_ID"
    );
    return;
  }

  let success = 0;

  yield* Effect.forEach(
    recipients,
    (chatId) =>
      sendTelegramMessage(token, chatId, greetingMessage).pipe(
        Effect.tapBoth({
          onSuccess: () => Effect.sync(() => {
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

Effect.runPromise(program).catch((error) => {
  console.error("❌ Daily greeting job failed:", error);
  process.exit(1);
});
