import type { Context } from "grammy";
import { UserRepository } from "../../storage/database/repositories/user-repository";
import { createDAVClient } from "tsdav";

export class CalendarTestHandler {
  private userRepository = new UserRepository();

  async handleTestCalendarCommand(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;

    await ctx.reply("🔍 Проверяю подключение к календарю...");

    try {
      // Get user's calendar integration
      const integrations = await this.userRepository.getAllDecryptedIntegrations(userId);
      const calendarIntegration = integrations.find(
        ({ integration }) => integration.integrationType === "YandexCalendar"
      );

      if (!calendarIntegration) {
        await ctx.reply(
          "❌ Календарь не подключен.\nИспользуйте /add_yandex_calendar для подключения."
        );
        return;
      }

      const { credentials } = calendarIntegration;
      const { calendarUrl, username, password } = credentials;

      if (!calendarUrl || !username || !password) {
        await ctx.reply("❌ Неполные данные для подключения к календарю");
        return;
      }

      await ctx.reply(
        `📅 Подключаюсь к календарю:\n` +
        `URL: ${calendarUrl}\n` +
        `Username: ${username}\n` +
        `⏳ Получаю события...`
      );

      // Extract server URL from calendar URL
      const serverUrl = new URL(calendarUrl);
      const baseUrl = `${serverUrl.protocol}//${serverUrl.hostname}`;

      const client = await createDAVClient({
        serverUrl: baseUrl,
        credentials: {
          username,
          password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });

      // Fetch all calendar objects
      const calendarObjects = await client.fetchCalendarObjects({
        calendar: {
          url: calendarUrl,
        },
      });

      await ctx.reply(`📊 Найдено объектов в календаре: ${calendarObjects.length}`);

      // Parse and display events
      const events = [];
      for (const obj of calendarObjects) {
        if (obj.data) {
          const eventInfo = this.parseBasicEventInfo(obj.data);
          if (eventInfo) {
            events.push(eventInfo);
          }
        }
      }

      // Sort by date
      events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      if (events.length === 0) {
        await ctx.reply("📭 В календаре нет событий");
      } else {
        // Show first 5 events
        const eventsToShow = events.slice(0, 5);
        let message = `📅 Найдено ${events.length} событий.\n`;
        message += `Показываю первые ${eventsToShow.length}:\n\n`;

        for (const event of eventsToShow) {
          message += `• ${event.summary}\n`;
          message += `  ${event.startDate.toLocaleString("ru-RU")}\n\n`;
        }

        await ctx.reply(message);
      }
    } catch (error) {
      console.error("Error testing calendar:", error);
      await ctx.reply(
        `❌ Ошибка при тестировании календаря:\n${error}\n\n` +
        `Проверьте логи для подробной информации.`
      );
    }
  }


  private parseBasicEventInfo(icsData: string): any {
    try {
      const lines = icsData.split("\n");
      let summary = "";
      let location = "";
      let startDate: Date | null = null;

      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const keyPart = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1).trim();

        // Extract base key (might have parameters like DTSTART;VALUE=DATE)
        const key = keyPart.split(';')[0];

        switch (key) {
          case "SUMMARY":
            summary = value;
            break;
          case "LOCATION":
            location = value;
            break;
          case "DTSTART":
            startDate = this.parseICalendarDate(value);
            break;
        }
      }

      if (summary && startDate) {
        return {
          summary,
          location,
          startDate,
        };
      }

      return null;
    } catch (error) {
      console.error("Error parsing event:", error);
      return null;
    }
  }

  private parseICalendarDate(dateString: string | undefined): Date {
    if (!dateString) {
      return new Date();
    }
    const cleanDate = dateString.replace(/[TZ]/g, "");

    const year = parseInt(cleanDate.substring(0, 4));
    const month = parseInt(cleanDate.substring(4, 6)) - 1;
    const day = parseInt(cleanDate.substring(6, 8));
    const hour = parseInt(cleanDate.substring(8, 10)) || 0;
    const minute = parseInt(cleanDate.substring(10, 12)) || 0;
    const second = parseInt(cleanDate.substring(12, 14)) || 0;

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
}