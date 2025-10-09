import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

import {
  createYandexCalendarTools,
  YandexCredentials,
} from "../../packages/core/src/effect/integrations/yandex-calendar";

describe("calendar formatter", () => {
  it("renders create event result with user timezone", async () => {
    const credentials: YandexCredentials = {
      calendarUrl: "https://example.com/caldav",
      username: "demo",
      password: "secret",
    };

    const { formatters } = createYandexCalendarTools({
      credentials,
      userTimezone: "Europe/Moscow",
      userLocale: "ru-RU",
    });

    const formatter = formatters.createEvent;
    const output = {
      success: true,
      eventId: "teledrug-1@yandex.ru",
      event: {
        id: "teledrug-1@yandex.ru",
        summary: "Чистка зубов",
        description: "🤖 Событие создано с помощью TeleDrug",
        startDate: "2025-10-08T15:30:00.000Z",
        endDate: "2025-10-08T16:00:00.000Z",
        location: "Стоматология на Тверской",
        status: "confirmed",
      },
      message: "Событие \"Чистка зубов\" создано",
    };

    const formatted = await Effect.runPromise(formatter(output));

    expect(formatted.text).toContain("18:30–19:00");
    expect(formatted.text).toContain("Europe/Moscow");
    expect(formatted.parseMode).toBe("Markdown");
  });
});
