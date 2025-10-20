import { Effect } from "effect";
import { db, sql, users, userSettings } from "@teledrug/db";
import { eq } from "drizzle-orm";
import { runDailyDigest } from "../digest/runner";
import { DailyDigestLayer, type DailyDigestEnv } from "../app/layers/daily-digest";
import type {
  DigestModuleId,
  DigestModuleResult,
  DigestUserSettingsSnapshot,
} from "../digest/types";
import {
  renderDailyDigestImage,
  type DailyDigestImagePayload,
} from "@teledrug/og";
import { UserRepository } from "../services/user-repository";
import { normalizeTimezone } from "@teledrug/timezone";

const TARGET_HOUR = 10;
const FORCE_ALL_FLAG = "--all";
const FORCE_ALL_ALT_FLAG = "--force-all";

const GREETING_VARIANTS = [
  "Доброе утро! 🌞",
  "С добрым утром! ☀️",
  "Отличного дня! 🌅",
  "Доброго утра! ✨",
];

interface DigestComposition {
  readonly imagePayload: DailyDigestImagePayload;
  readonly scheduleText: string | null;
}

const capitalize = (value: string) =>
  value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);

const formatDateLabel = (
  date: Date,
  locale: string,
  timeZone: string
) => {
  const weekday = capitalize(
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      timeZone,
    }).format(date)
  );
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
  return `${weekday}, ${day}`;
};

const formatTimeLabel = (
  date: Date,
  locale: string,
  timeZone: string
) =>
  new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);

const buildImagePayload = (
  modules: ReadonlyArray<DigestModuleResult>,
  date: Date,
  settings: DigestUserSettingsSnapshot
): DailyDigestImagePayload => {
  const timeZone = normalizeTimezone(settings.timezone);
  const locale = settings.locale || "ru-RU";

  // Extract metadata (weather and fx) for corner display
  const weatherModule = modules.find(m => m.id === 'weather');
  const fxModule = modules.find(m => m.id === 'fx');

  const extractCompactInfo = (text: string | null | undefined, pattern: RegExp): string | undefined => {
    if (!text) return undefined;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return undefined;
    // Take first meaningful line after header
    const content = lines.length > 1 ? lines[1] : lines[0];
    return content?.replace(pattern, '').replace(/^[-•*]\s*/, '').trim();
  };

  const weatherInfo = weatherModule ? extractCompactInfo(weatherModule.text, /^Погода[:\s-]*/i) : undefined;
  const fxInfo = fxModule ? extractCompactInfo(fxModule.text, /^Курс валют[:\s-]*/i) : undefined;

  const randomGreeting = GREETING_VARIANTS[Math.floor(Math.random() * GREETING_VARIANTS.length)];

  return {
    dateLabel: formatDateLabel(date, locale, timeZone),
    greeting: randomGreeting!,
    metadata: (weatherInfo || fxInfo) ? { weather: weatherInfo, fx: fxInfo } : undefined,
    footnote: `Сформировано в ${formatTimeLabel(date, locale, timeZone)} • TeleDrug`,
  };
};

const toUserSettingsSnapshot = (
  settings: DigestUserSettingsSnapshot | null | undefined
): DigestUserSettingsSnapshot => ({
  timezone: normalizeTimezone(settings?.timezone ?? "UTC"),
  locale: settings?.locale && settings.locale.trim().length > 0 ? settings.locale : "ru-RU",
  city: settings?.city ?? null,
  country: settings?.country ?? null,
});

const composeDigest = (userId: number, date: Date) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepository;
    const settings = yield* userRepo
      .getUserSettings(userId)
      .pipe(
        Effect.map((value) =>
          toUserSettingsSnapshot({
            timezone: value.timezone,
            locale: value.locale,
            city: value.city ?? null,
            country: value.country ?? null,
          })
        ),
        Effect.catchAll(() => Effect.succeed(toUserSettingsSnapshot(null)))
      );

    const modules = yield* runDailyDigest(userId, date, {
      userSettings: settings,
    });

    const filtered = modules.filter((module) =>
      Boolean(module.text && module.text.trim().length > 0)
    );

    // Extract schedule module for separate message
    const scheduleModule = filtered.find(m => m.id === 'schedule');
    const scheduleText = scheduleModule?.text ?? null;

    return {
      imagePayload: buildImagePayload(filtered, date, settings),
      scheduleText,
    } satisfies DigestComposition;
  });

const fetchRecipients = (now: Date, forceAll: boolean) =>
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
      .filter((entry): entry is { chatId: number; hour: number } => {
        if (!Number.isFinite(entry.chatId)) {
          return false;
        }
        return forceAll ? true : entry.hour === TARGET_HOUR;
      })
      .map((entry) => entry.chatId);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error("❌ Failed to fetch recipients from database:", error);
        return [] as readonly number[];
      })
    )
  );

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

const sendTelegramPhoto = (
  token: string,
  chatId: number,
  file: Uint8Array,
  caption: string
) =>
  Effect.tryPromise(async () => {
    const formData = new FormData();
    formData.append("chat_id", chatId.toString());
    if (caption.trim().length > 0) {
      formData.append("caption", caption);
    }
    const blob = new Blob([file], { type: "image/png" });
    formData.append("photo", blob, "digest.png");

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(
        `Telegram API error for chat ${chatId} (photo): ${response.status} ${payload}`
      );
    }
  }).pipe(
    Effect.as(true),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`❌ Failed to send digest photo to ${chatId}:`, error);
        return false;
      })
    )
  );

const deliverDigest = (
  token: string,
  chatId: number,
  digest: DigestComposition
) =>
  Effect.gen(function* () {
    const image = yield* Effect.tryPromise(() =>
      renderDailyDigestImage(digest.imagePayload)
    ).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error(`❌ Failed to render digest image for ${chatId}:`, error);
          return null as Uint8Array | null;
        })
      )
    );

    if (!image) {
      console.error(`❌ No image rendered for ${chatId}`);
      return false;
    }

    // Send greeting image without caption
    const photoSent = yield* sendTelegramPhoto(token, chatId, image, "");

    if (!photoSent) {
      return false;
    }

    // Send schedule as separate message if exists
    if (digest.scheduleText && digest.scheduleText.trim().length > 0) {
      yield* sendTelegramMessage(token, chatId, digest.scheduleText);
    }

    return true;
  });

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
    const forceAll =
      process.argv.includes(FORCE_ALL_FLAG) ||
      process.argv.includes(FORCE_ALL_ALT_FLAG) ||
      process.env.DAILY_DIGEST_FORCE_ALL === "true";

    if (forceAll) {
      yield* Effect.sync(() =>
        console.log("⚙️ Daily digest force mode enabled — sending to all users")
      );
    }

    const recipients = yield* fetchRecipients(today, forceAll);

    if (recipients.length === 0) {
      yield* Effect.sync(() =>
        console.log(
          forceAll
            ? "⚠️ Daily digest skipped: no users found"
            : `⚠️ Daily digest skipped: no users scheduled for ${TARGET_HOUR}:00 at this hour`
        )
      );
      return;
    }

    let success = 0;

    yield* Effect.forEach(
      recipients,
      (chatId) =>
        Effect.gen(function* () {
          const digest = yield* composeDigest(chatId, today).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.error(
                  `❌ Failed to compose digest for ${chatId}:`,
                  error
                );
                return {
                  message: `${greetingPrefix}\n\nХорошего дня!`,
                  imagePayload: buildImagePayload(
                    [],
                    today,
                    toUserSettingsSnapshot(null)
                  ),
                } satisfies DigestComposition;
              })
            )
          );

          const delivered = yield* deliverDigest(token, chatId, digest);
          if (delivered) {
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

const runnableProgram = program.pipe(
  Effect.provide(DailyDigestLayer)
) as Effect.Effect<void, unknown, never>;

Effect.runPromise(runnableProgram)
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
