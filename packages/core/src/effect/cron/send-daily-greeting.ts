import { Effect, Console, Schema, Option, Layer, pipe } from "effect";
import { db, sql } from "../../storage/database/client";
import { users } from "../../storage/database/schema";
import { UserRepository } from "../services/user-repository";
import { UserRepositoryLive } from "../services/user-repository";
import { EncryptionServiceLive } from "../services/encryption";
import {
  YandexCredentials,
  fetchEventsForRange,
  sortEventsByStartDate,
  type CalendarEvent,
} from "../integrations/yandex-calendar";

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
      Console.error(`❌ Failed to send greeting to ${chatId}:`, error).pipe(
        Effect.flatMap(() => Effect.succeed(false))
      )
    )
  );

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfToday = () => {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  date.setMilliseconds(date.getMilliseconds() - 1);
  return date;
};

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

const formatEventLine = (event: CalendarEvent) => {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const timeRange = `${timeFormatter.format(start)}–${timeFormatter.format(end)}`;
  const location = event.location ? ` (${event.location})` : "";
  return `• ${timeRange} — ${event.summary}${location}`;
};

const decodeCredentials = (raw: Record<string, unknown>) =>
  Schema.decodeUnknown(YandexCredentials)(raw).pipe(
    Effect.map(Option.some),
    Effect.catchAll((error) =>
      Console.error("❌ Invalid Yandex credentials:", error).pipe(
        Effect.flatMap(() => Effect.succeed(Option.none()))
      )
    )
  );

const collectTodayEvents = (
  credentialsList: ReadonlyArray<Record<string, unknown>>
) =>
  Effect.gen(function* () {
    const start = startOfToday();
    const end = endOfToday();
    let events: CalendarEvent[] = [];

    for (const rawCredentials of credentialsList) {
      const maybeCredentials = yield* decodeCredentials(rawCredentials);
      if (Option.isNone(maybeCredentials)) {
        continue;
      }

      const fetched = yield* Effect.tryPromise(() =>
        fetchEventsForRange(maybeCredentials.value, start, end)
      ).pipe(
        Effect.catchAll((error) =>
          Console.error("❌ Failed to fetch Yandex events:", error).pipe(
            Effect.flatMap(() => Effect.succeed<CalendarEvent[]>([]))
          )
        )
      );

      events = events.concat(fetched);
    }

    return sortEventsByStartDate(events);
  });

const buildDigestMessage = (userId: number) =>
  Effect.gen(function* () {
    const userRepository = yield* UserRepository;
    const integrations = yield* userRepository.getAllDecryptedIntegrations(
      userId
    );

    const yandexCredentials = integrations
      .filter(
        (entry) =>
          entry.integration.integrationType === "YandexCalendar" &&
          entry.integration.enabled
      )
      .map((entry) => entry.credentials);

    const events = yield* collectTodayEvents(yandexCredentials);

    if (events.length === 0) {
      return "🌞 Доброе утро!\n\nСегодня свободный день 🙌";
    }

    const lines = events.map(formatEventLine).join("\n");
    return `🌞 Доброе утро!\n\n📅 События на сегодня:\n${lines}`;
  });

const userRepositoryLayer = pipe(
  UserRepositoryLive,
  Layer.provide(EncryptionServiceLive)
);

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
      Effect.gen(function* () {
        const message = yield* buildDigestMessage(chatId).pipe(
          Effect.catchAll(() => Effect.succeed(greetingMessage))
        );

        const sent = yield* sendTelegramMessage(token, chatId, message);
        if (sent) {
          success += 1;
        }
      }),
    { discard: true }
  );

  yield* Console.log(
    `✅ Daily greeting processed (${success}/${recipients.length})`
  );
}).pipe(Effect.provide(userRepositoryLayer));

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
