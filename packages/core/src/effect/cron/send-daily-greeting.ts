import { Effect, Layer } from "effect";
import { db, sql } from "../../storage/database/client";
import { users, userSettings } from "../../storage/database/schema";
import { eq } from "drizzle-orm";
import { runDailyDigest } from "../digest/runner";
import { DailyDigestLayer } from "../layers/daily-digest";

const greetingPrefix = "🌞 Доброе утро!";

const TARGET_HOUR = 10;

const getHourInTimezone = (date: Date, timeZone: string): number | null => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone,
    });

    const parsed = Number(formatter.format(date));
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "UTC",
    });
    const parsed = Number(formatter.format(date));
    return Number.isFinite(parsed) ? parsed : null;
  }
};

const fetchRecipients = (now: Date) =>
  Effect.tryPromise(async () => {
    const rows = await db
      .select()
      .from(users)
      .leftJoin(userSettings, eq(userSettings.userId, users.telegramId));

    return rows
      .map((row) => {
        const chatId = row.users.telegramId;
        const timeZone = row.user_settings?.timezone || "UTC";
        const hour = getHourInTimezone(now, timeZone);

        return {
          chatId,
          hour,
        };
      })
      .filter(
        (entry): entry is { chatId: number; hour: number } =>
          Number.isFinite(entry.chatId) && entry.hour === TARGET_HOUR
      )
      .map((entry) => entry.chatId);
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

const composeMessage = (userId: number, date: Date) =>
  runDailyDigest(userId, date).pipe(
    Effect.provide(DailyDigestLayer),
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

const program = Effect.scoped(
  Effect.gen(function* () {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      yield* Effect.sync(() =>
        console.log("❌ TELEGRAM_BOT_TOKEN is not set; aborting job")
      );
      return;
    }

    const today = new Date();
    const recipients = yield* fetchRecipients(today);

    if (recipients.length === 0) {
      yield* Effect.sync(() =>
        console.log(
          `⚠️ Daily digest skipped: no users scheduled for ${TARGET_HOUR}:00 at this hour`
        )
      );
      return;
    }

    let success = 0;

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
  })
);

Effect.runPromise(program)
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
