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

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

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

const formatEventLine = (event: CalendarEvent) => {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const timeRange = `${timeFormatter.format(start)}–${timeFormatter.format(end)}`;
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

      const start = startOfToday();
      const end = endOfToday();

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

      const lines = events.map(formatEventLine).join("\n");
      return `📅 События на сегодня:\n${lines}`;
    }),
};
