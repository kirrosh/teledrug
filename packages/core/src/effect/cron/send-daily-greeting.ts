import { Effect, Layer, pipe } from "effect";
import { db, sql } from "../../storage/database/client";
import { users } from "../../storage/database/schema";
import { DigestSettingsRepositoryLive } from "../services/digest-settings";
import { UserRepositoryLive } from "../services/user-repository";
import { EncryptionServiceLive } from "../services/encryption";
import { runDailyDigest } from "../digest/runner";
import { TaskRepositoryLive } from "../services/task-repository";

const greetingPrefix = "🌞 Доброе утро!";

const fetchRecipients = Effect.tryPromise(async () => {
  const rows = await db.select({ telegramId: users.telegramId }).from(users);
  return rows
    .map((row) => row.telegramId)
    .filter((value): value is number => Number.isFinite(value));
}).pipe(
  Effect.catchAll((error) =>
    Effect.sync(() => {
      console.error("❌ Failed to fetch recipients from database:", error);
      return [] as readonly number[];
    })
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
  }).pipe(
    Effect.as(true),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`❌ Failed to send digest to ${chatId}:`, error);
        return false;
      })
    )
  );

const digestLayer = DigestSettingsRepositoryLive;

const userRepositoryLayer = pipe(
  UserRepositoryLive,
  Layer.provide(EncryptionServiceLive),
  Layer.provide(digestLayer)
);

const servicesLayer = Layer.mergeAll(
  digestLayer,
  userRepositoryLayer,
  TaskRepositoryLive
);

const composeMessage = (userId: number, date: Date) =>
  runDailyDigest(userId, date).pipe(
    Effect.provide(servicesLayer),
    Effect.map((modules) => {
      const body = modules
        .map((module) => module.text)
        .filter((text): text is string =>
          Boolean(text && text.trim().length > 0)
        )
        .join("\n\n");

      if (body.length === 0) {
        return `${greetingPrefix}\n\nСегодня свободный день 🙌`;
      }

      return `${greetingPrefix}\n\n${body}`;
    })
  );

const program = Effect.gen(function* () {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    yield* Effect.sync(() =>
      console.log("❌ TELEGRAM_BOT_TOKEN is not set; aborting job")
    );
    return;
  }

  const recipients = yield* fetchRecipients;

  if (recipients.length === 0) {
    yield* Effect.sync(() =>
      console.log("⚠️ Daily digest skipped: no recipients found in database")
    );
    return;
  }

  let success = 0;
  const today = new Date();

  yield* Effect.forEach(
    recipients,
    (chatId) =>
      Effect.gen(function* () {
        const message = yield* composeMessage(chatId, today).pipe(
          Effect.catchAll(() =>
            Effect.succeed(`${greetingPrefix}\n\nХорошего дня!`)
          )
        );
        const sent = yield* sendTelegramMessage(token, chatId, message);
        if (sent) {
          success += 1;
        }
      }),
    { discard: true }
  );

  yield* Effect.sync(() =>
    console.log(`✅ Daily digest processed (${success}/${recipients.length})`)
  );
});

Effect.runPromise(
  Effect.scoped(Effect.provide(servicesLayer)(program))
)
  .catch((error) => {
    console.error("❌ Daily digest job failed:", error);
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
