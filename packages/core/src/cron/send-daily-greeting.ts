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
  type DailyDigestCard,
  type DailyDigestImagePayload,
} from "@teledrug/og";
import { UserRepository } from "../services/user-repository";
import { normalizeTimezone } from "@teledrug/timezone";

const greetingPrefix = "🌞 Доброе утро!";
const TARGET_HOUR = 10;
const FORCE_ALL_FLAG = "--all";
const FORCE_ALL_ALT_FLAG = "--force-all";
const MAX_CAPTION_LENGTH = 1024;
const MAX_VISIBLE_CARDS = 4;
const MAX_CARD_LINES = 3;
const MAX_CARD_LINE_LENGTH = 36;

const MODULE_META: Record<
  DigestModuleId,
  { readonly title: string; readonly icon: string; readonly accentColor: string }
> = {
  weather: { title: "Погода", icon: "🌤️", accentColor: "#38BDF8" },
  fx: { title: "Курс валют", icon: "💱", accentColor: "#F472B6" },
  calendar: { title: "Календарь", icon: "📅", accentColor: "#A78BFA" },
  tasks: { title: "Задачи", icon: "🧭", accentColor: "#34D399" },
};

const MODULE_LABEL_PATTERNS: Partial<Record<DigestModuleId, RegExp>> = {
  weather: /^Погода[:\s-]*/i,
  calendar: /^События на сегодня[:\s-]*/i,
  tasks: /^Задачи на сегодня[:\s-]*/i,
};

interface DigestComposition {
  readonly message: string;
  readonly imagePayload: DailyDigestImagePayload;
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

const splitLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const stripModuleEmoji = (value: string, moduleId: DigestModuleId) => {
  const icon = MODULE_META[moduleId]?.icon;
  if (icon && value.startsWith(icon)) {
    return value.slice(icon.length).trimStart();
  }
  return value;
};

const stripBullet = (value: string) => value.replace(/^[-•*]\s*/, "").trim();

const removeModuleLabel = (value: string, moduleId: DigestModuleId) => {
  const pattern = MODULE_LABEL_PATTERNS[moduleId];
  if (pattern && pattern.test(value)) {
    return value.replace(pattern, "").trim();
  }
  return value;
};

const normalizeModuleLine = (line: string, moduleId: DigestModuleId) => {
  const withoutEmoji = stripModuleEmoji(line, moduleId);
  const withoutBullet = stripBullet(withoutEmoji);
  const collapsed = withoutBullet.replace(/\s+/g, " ").trim();
  const withoutLabel = removeModuleLabel(collapsed, moduleId);
  return withoutLabel.length > 0 ? withoutLabel : collapsed;
};

const limitLines = (lines: ReadonlyArray<string>) => lines.slice(0, MAX_CARD_LINES);

const truncateLine = (line: string) =>
  line.length > MAX_CARD_LINE_LENGTH
    ? `${line.slice(0, MAX_CARD_LINE_LENGTH - 1).trimEnd()}…`
    : line;

const buildCard = (module: DigestModuleResult): DailyDigestCard => {
  const meta = MODULE_META[module.id];
  const rawLines = splitLines(module.text ?? "");

  if (rawLines.length === 0) {
    return {
      id: module.id,
      title: meta.title,
      icon: meta.icon,
      accentColor: meta.accentColor,
      lines: [],
    };
  }

  const contentLines = rawLines.length > 1 ? rawLines.slice(1) : rawLines;
  let normalized = contentLines
    .map((line) => normalizeModuleLine(line, module.id))
    .filter((line) => line.length > 0);

  if (normalized.length === 0) {
    const fallback = normalizeModuleLine(rawLines[0]!, module.id);
    if (fallback.length > 0) {
      normalized = [fallback];
    }
  }

  const limited = limitLines(normalized).map(truncateLine);

  return {
    id: module.id,
    title: meta.title,
    icon: meta.icon,
    accentColor: meta.accentColor,
    lines: limited,
  };
};

const buildFallbackCard = (): DailyDigestCard => ({
  id: "fallback",
  title: "Сегодня",
  icon: "🧘",
  accentColor: "#FACC15",
  lines: ["Свободный день 🙌"],
});

const buildImagePayload = (
  cards: ReadonlyArray<DailyDigestCard>,
  date: Date,
  settings: DigestUserSettingsSnapshot
): DailyDigestImagePayload => {
  const timeZone = normalizeTimezone(settings.timezone);
  const locale = settings.locale || "ru-RU";
  return {
    dateLabel: formatDateLabel(date, locale, timeZone),
    cards: cards.length > 0 ? cards : [buildFallbackCard()],
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

    const body = filtered
      .map((module) => module.text?.trim() ?? "")
      .filter((text) => text.length > 0)
      .join("\n\n");

    const message =
      body.length === 0
        ? `${greetingPrefix}\n\nСегодня свободный день 🙌`
        : `${greetingPrefix}\n\n${body}`;

    const cards = filtered
      .map((module) => buildCard(module))
      .filter((card) => card.lines.length > 0)
      .slice(0, MAX_VISIBLE_CARDS);

    return {
      message,
      imagePayload: buildImagePayload(cards, date, settings),
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

    if (image) {
      const caption =
        digest.message.length <= MAX_CAPTION_LENGTH
          ? digest.message
          : greetingPrefix;
      const photoSent = yield* sendTelegramPhoto(token, chatId, image, caption);

      if (photoSent) {
        if (digest.message.length > MAX_CAPTION_LENGTH) {
          yield* sendTelegramMessage(token, chatId, digest.message);
        }
        return true;
      }
    }

    return yield* sendTelegramMessage(token, chatId, digest.message);
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
