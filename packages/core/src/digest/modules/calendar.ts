import { Effect } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";
import {
  UserRepository as UserRepositoryTag,
  type UserRepository as UserRepositoryService,
} from "../../services/user-repository";
import {
  fetchEventsForRange,
  type CalendarEvent,
  type YandexCredentials,
} from "../../integrations/yandex-calendar";
import {
  getDayBoundsInTimezone,
  formatInTimezone,
  normalizeTimezone,
} from "@teledrug/timezone";
const formatEventLine = (
  event: CalendarEvent,
  formatter: Intl.DateTimeFormat
) => {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const timeRange = `${formatter.format(start)}–${formatter.format(end)}`;
  const location = event.location ? ` (${event.location})` : "";
  return `• ${timeRange} — ${event.summary}${location}`;
};

const isYandexCredentials = (value: unknown): value is YandexCredentials => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.username === "string" &&
    typeof raw.password === "string" &&
    typeof raw.calendarUrl === "string"
  );
};

export const CalendarDigestModule: DigestModuleImpl<UserRepositoryService> = {
  id: "calendar",
  fetch: (context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) {
        return null;
      }

      const userRepository = yield* UserRepositoryTag;
      const integrations = yield* userRepository
        .getAllDecryptedIntegrations(context.userId)
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error(
                "❌ Failed to load user integrations for calendar module:",
                error
              );
              return [] as Array<{
                integration: { integrationType: string; enabled: boolean };
                credentials: unknown;
              }>;
            })
          )
        );

      const yandexCredentials = integrations
        .filter(
          (entry) =>
            entry.integration.integrationType === "YandexCalendar" &&
            entry.integration.enabled
        )
        .map((entry) => entry.credentials)
        .filter(isYandexCredentials);

      if (yandexCredentials.length === 0) {
        return "📅 Интеграция с календарём не настроена";
      }

      const timeZone = normalizeTimezone(context.userSettings.timezone);
      const locale = context.userSettings.locale || "ru-RU";
      const { start, end } = getDayBoundsInTimezone(context.date, timeZone);

      let events: CalendarEvent[] = [];

      for (const credentials of yandexCredentials) {
        const decoded = yield* Effect.tryPromise(() =>
          fetchEventsForRange(credentials, start, end)
        ).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error("❌ Failed to fetch calendar events:", error);
              return [] as CalendarEvent[];
            })
          )
        );

        events = events.concat(decoded);
      }

      if (events.length === 0) {
        return "📅 Сегодня событий нет";
      }

      const timeFormatter = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      });
      const lines = events
        .map((event) => formatEventLine(event, timeFormatter))
        .join("\n");
      const dateLabel = formatInTimezone(
        context.date,
        locale,
        { weekday: "long", day: "numeric", month: "long" },
        timeZone
      );
      return `📅 События на сегодня (${dateLabel}):\n${lines}`;
    }),
};
