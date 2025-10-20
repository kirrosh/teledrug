import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { db, sql, users, userSettings } from "@teledrug/db";

const TARGET_HOUR = 20;

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
    const fallback = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "UTC",
    });
    const parsed = Number(fallback.format(date));
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

        return { chatId, hour };
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
      Effect.sync(() => {
        console.error(`❌ Failed to send evening prompt to ${chatId}:`, error);
        return false;
      })
    )
  );

const formatEveningPrompt = () =>
  "🌙 Добрый вечер!\n\nПодведём итоги дня? Коротко ответь: что получилось, что улучшить, за что благодарен.\n\nМожешь написать: \"Итоги дня: ...\"";

const program = Effect.gen(function* () {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    yield* Effect.sync(() =>
      console.log("❌ TELEGRAM_BOT_TOKEN is not set; aborting evening job")
    );
    return;
  }

  const now = new Date();
  const recipients = yield* fetchRecipients(now);
  if (recipients.length === 0) {
    yield* Effect.sync(() =>
      console.log(
        `⚠️ Evening prompt skipped: no users scheduled for ${TARGET_HOUR}:00 at this hour`
      )
    );
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

  yield* Effect.sync(() =>
    console.log(`✅ Evening prompts sent (${success}/${recipients.length})`)
  );
});

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
