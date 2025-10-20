import { Effect, Context, Layer, Console } from "effect";
import type { Task } from "@teledrug/db";
import { UserRepository } from "./user-repository";
import type { UserRepository as UserRepositoryService } from "./user-repository";
import {
  YandexCredentials,
  type CalendarEvent,
} from "../integrations/yandex-calendar";
import { isEvent } from "../tasks/utils";

/**
 * Сервис для синхронизации событий с внешними календарями
 * Работает в фоновом режиме, не предоставляет инструменты для LLM
 */

interface CreateCalendarEventParams {
  summary: string;
  startDate: string;
  endDate: string;
  location?: string;
  description?: string;
}

interface CreateCalendarEventResult {
  success: boolean;
  eventId?: string;
  event?: CalendarEvent;
  message?: string;
  error?: string;
}

// Импортируем функцию создания события из интеграции Яндекс.Календаря
const createCalendarEventInYandex = async (
  credentials: {
    calendarUrl: string;
    username: string;
    password: string;
  },
  params: CreateCalendarEventParams
): Promise<CreateCalendarEventResult> => {
  // Эта функция уже реализована в yandex-calendar/index.ts
  // Импортируем её динамически, чтобы избежать циклических зависимостей
  const { createDAVClient } = await import("tsdav");

  const client = await createDAVClient({
    serverUrl: credentials.calendarUrl,
    credentials: {
      username: credentials.username,
      password: credentials.password,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  const start = new Date(params.startDate);
  const end = new Date(params.endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date format");
  }

  if (start.getTime() >= end.getTime()) {
    throw new Error("Event end must be after start");
  }

  const summary = params.summary.trim() || "Встреча";
  const description = params.description?.trim() || "🤖 Создано через TeleDrug";
  const eventId = `teledrug-${Date.now()}@yandex.ru`;

  const toICalDateTime = (date: Date) =>
    date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const escapeICalText = (text: string) =>
    text
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TeleDrug//Yandex Calendar Integration//RU",
    "BEGIN:VEVENT",
    `UID:${eventId}`,
    `DTSTART:${toICalDateTime(start)}`,
    `DTEND:${toICalDateTime(end)}`,
    `SUMMARY:${escapeICalText(summary)}`,
    `DESCRIPTION:${escapeICalText(description)}`,
    params.location ? `LOCATION:${escapeICalText(params.location)}` : undefined,
    `DTSTAMP:${toICalDateTime(new Date())}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));

  const iCalString = lines.join("\n");

  await client.createCalendarObject({
    calendar: {
      url: credentials.calendarUrl,
    },
    filename: `${eventId}.ics`,
    iCalString,
  });

  return {
    success: true,
    eventId,
    message: `Событие "${summary}" синхронизировано с календарем`,
  };
};

export interface CalendarSyncService {
  readonly syncTaskToCalendar: (
    task: Task
  ) => Effect.Effect<boolean, Error>;
}

export const CalendarSyncService = Context.GenericTag<CalendarSyncService>(
  "@services/CalendarSyncService"
);

const makeCalendarSyncService = Effect.gen(function* () {
  const userRepository = yield* UserRepository;

  const syncTaskToCalendar: CalendarSyncService["syncTaskToCalendar"] = (
    task
  ) =>
    Effect.gen(function* () {
      // Проверяем, что это событие (а не задача)
      if (!isEvent(task)) {
        yield* Console.log(
          `⏭️ CalendarSync: task #${task.id} is not an event, skipping`
        );
        return false;
      }

      // Проверяем, что событие еще не синхронизировано
      if (task.calendarEventId) {
        yield* Console.log(
          `⏭️ CalendarSync: task #${task.id} already synced (eventId: ${task.calendarEventId})`
        );
        return false;
      }

      // Получаем интеграции пользователя
      const integrations = yield* userRepository
        .getAllDecryptedIntegrations(task.userId)
        .pipe(
          Effect.catchAll((error) => {
            console.error("Failed to load user integrations:", error);
            return Effect.succeed([]);
          })
        );

      // Ищем интеграцию с Яндекс.Календарём
      const yandexIntegration = integrations.find(
        (entry) =>
          entry.integration.integrationType === "YandexCalendar" &&
          entry.integration.enabled
      );

      if (!yandexIntegration) {
        yield* Console.log(
          `⏭️ CalendarSync: no Yandex Calendar integration for user ${task.userId}`
        );
        return false;
      }

      // Валидация credentials
      const credentials = yandexIntegration.credentials;
      if (
        !credentials ||
        typeof credentials !== "object" ||
        !("calendarUrl" in credentials) ||
        !("username" in credentials) ||
        !("password" in credentials)
      ) {
        yield* Console.log(
          `❌ CalendarSync: invalid Yandex Calendar credentials for user ${task.userId}`
        );
        return false;
      }

      const yandexCredentials = credentials as YandexCredentials;

      // Синхронизируем событие
      yield* Console.log(
        `📅 CalendarSync: syncing task #${task.id} to Yandex Calendar...`
      );

      const result = yield* Effect.tryPromise({
        try: async () =>
          createCalendarEventInYandex(yandexCredentials, {
            summary: task.title,
            startDate: task.startAt!.toString(),
            endDate: task.endAt!.toString(),
            location: task.location ?? undefined,
            description: task.description ?? undefined,
          }),
        catch: (cause) =>
          new Error(
            `Failed to sync to calendar: ${
              cause instanceof Error ? cause.message : String(cause)
            }`
          ),
      });

      if (result.success && result.eventId) {
        yield* Console.log(
          `✅ CalendarSync: task #${task.id} synced successfully (eventId: ${result.eventId})`
        );
        return true;
      }

      yield* Console.log(
        `❌ CalendarSync: failed to sync task #${task.id}: ${result.error}`
      );
      return false;
    });

  return {
    syncTaskToCalendar,
  } satisfies CalendarSyncService;
});

export const CalendarSyncServiceLive = Layer.effect(
  CalendarSyncService,
  makeCalendarSyncService
);
