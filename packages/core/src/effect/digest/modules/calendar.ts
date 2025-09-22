import { Effect, Console } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";
import { UserRepository } from "../../services/user-repository";
import {
  fetchEventsForRange,
  type CalendarEvent,
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

export const CalendarDigestModule: DigestModuleImpl = {
  id: "calendar",
  fetch: (context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) {
        return null;
      }

      const userRepository = yield* UserRepository;
      const integrations = yield* userRepository.getAllDecryptedIntegrations(
        context.userId
      );

      const yandexCredentials = integrations
        .filter(
          (entry) =>
            entry.integration.integrationType === "YandexCalendar" &&
            entry.integration.enabled
        )
        .map((entry) => entry.credentials);

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
            Console.error("❌ Failed to fetch calendar events:", error).pipe(
              Effect.flatMap(() => Effect.succeed<CalendarEvent[]>([]))
            )
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
