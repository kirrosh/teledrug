import {
  Integration,
  type IntegrationCredentials,
  type IntegrationTool,
} from "../base/integration";
import { tool, type TypedToolResult } from "ai";
import { z } from "zod";
import { createDAVClient } from "tsdav";
import type { ProgressStep } from "../../core/response-manager";
import { InteractionType } from "../../types/interaction-types";

interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  url?: string;
  organizer?: string;
  attendees?: string[];
  status?: string;
  categories?: string[];
}

interface CalendarToolResult {
  success: boolean;
  events?: Array<{
    id?: string;
    summary: string;
    description?: string;
    startDate: string;
    endDate: string;
    location?: string;
    url?: string;
    organizer?: string;
    attendees?: string[];
    status?: string;
    categories?: string[];
  }>;
  totalCount?: number;
  event?: {
    summary: string;
    description?: string;
    startDate: string;
    endDate: string;
    location?: string;
    url?: string;
    organizer?: string;
    attendees?: string[];
    status?: string;
    categories?: string[];
  };
  eventId?: string;
  error?: string;
}

const getEventsSchema = z.object({
  dateRange: z
    .object({
      start: z
        .string()
        .optional()
        .describe("Начальная дата в формате ISO (YYYY-MM-DD)"),
      end: z
        .string()
        .optional()
        .describe("Конечная дата в формате ISO (YYYY-MM-DD)"),
    })
    .optional()
    .describe("Диапазон дат для поиска событий"),
  limit: z
    .number()
    .optional()
    .describe(
      "Максимальное количество событий для отображения (по умолчанию все)"
    ),
});

const getLastEventsSchema = z.object({
  count: z
    .number()
    .min(1)
    .max(50)
    .default(5)
    .describe(
      "Количество последних событий для отображения (1-50, по умолчанию 5)"
    ),
});

const createEventSchema = z.object({
  summary: z.string().describe("Название события"),
  description: z.string().optional().describe("Описание события"),
  startDate: z.string().describe("Дата и время начала в формате ISO"),
  endDate: z.string().describe("Дата и время окончания в формате ISO"),
  location: z.string().optional().describe("Место проведения"),
});

export class YandexCalendarIntegration extends Integration {
  private client: Awaited<ReturnType<typeof createDAVClient>> | null = null;
  private calendarUrl?: string;
  private username?: string;
  private password?: string;

  constructor() {
    super({
      name: "YandexCalendar",
      description:
        "Интеграция с Яндекс.Календарем для управления событиями и встречами",
      version: "1.0.0",
    });
  }

  protected initializeToolsMetadata(): void {
    // Инициализируем метаданные для каждого инструмента
    this.toolsMetadata.set('getEvents', {
      name: 'getEvents',
      permissions: { read: true, write: false },
      supportedInteractionTypes: [InteractionType.TEXT, InteractionType.VOICE],
      progressMessage: 'Проверяю календарь...',
      progressEmoji: '📅',
      description: 'Получение списка событий из календаря за определенный период'
    });

    this.toolsMetadata.set('getLastEvents', {
      name: 'getLastEvents',
      permissions: { read: true, write: false },
      supportedInteractionTypes: [InteractionType.TEXT, InteractionType.VOICE],
      progressMessage: 'Загружаю последние события...',
      progressEmoji: '📊',
      description: 'Получение последних событий из календаря'
    });

    this.toolsMetadata.set('createEvent', {
      name: 'createEvent',
      permissions: { read: false, write: true },
      supportedInteractionTypes: [
        InteractionType.TEXT,
        InteractionType.VOICE,
        InteractionType.IMAGE,
        InteractionType.FORWARD
      ],
      progressMessage: 'Создаю событие в календаре...',
      progressEmoji: '📝',
      description: 'Создание нового события в календаре'
    });
  }

  override async authenticate(credentials: IntegrationCredentials): Promise<boolean> {
    try {
      this.calendarUrl = credentials.calendarUrl;
      this.username = credentials.username;
      this.password = credentials.password;

      console.log("🔐 Инициализация Яндекс.Календаря:", {
        url: this.calendarUrl,
        username: this.username,
      });
      if (!this.calendarUrl) {
        throw new Error("Calendar URL is not set");
      }

      this.client = await createDAVClient({
        serverUrl: this.calendarUrl,
        credentials: {
          username: this.username,
          password: this.password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });

      console.log("✅ Яндекс.Календарь успешно подключен");
      return true;
    } catch (error) {
      console.error("❌ Ошибка аутентификации Яндекс.Календаря:", error);
      return false;
    }
  }

  private async fetchEvents(): Promise<CalendarEvent[]> {
    if (!this.client || !this.calendarUrl) {
      throw new Error("Calendar not initialized");
    }

    try {
      console.log("📥 Fetching calendar objects from:", this.calendarUrl);

      const calendarObjects = await this.client.fetchCalendarObjects({
        calendar: {
          url: this.calendarUrl,
        },
      });

      console.log(`📊 Found ${calendarObjects.length} calendar objects`);

      const events: CalendarEvent[] = [];

      for (const calendarObject of calendarObjects) {
        if (calendarObject.data) {
          const event = this.parseICalendarEvent(calendarObject.data);
          if (event) {
            events.push(event);
            console.log(
              `✅ Parsed event: "${
                event.summary
              }" at ${event.startDate.toISOString()}`
            );
          } else {
            console.log(
              "⚠️ Could not parse event from data:",
              calendarObject.data.substring(0, 200)
            );
          }
        } else {
          console.log("⚠️ Calendar object has no data:", calendarObject);
        }
      }

      console.log(`📅 Total parsed events: ${events.length}`);
      return events;
    } catch (error) {
      console.error("❌ Error fetching events:", error);
      throw new Error(`Failed to fetch events: ${error}`);
    }
  }

  private parseICalendarEvent(icsData: string): CalendarEvent | null {
    try {
      const lines = icsData.split("\n");
      let summary = "";
      let description = "";
      let location = "";
      let startDate: Date | null = null;
      let endDate: Date | null = null;
      let uid = "";
      let url = "";
      let organizer = "";
      let attendees: string[] = [];
      let status = "";
      let categories: string[] = [];

      console.log("🔍 Parsing iCalendar event...");

      for (const line of lines) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;

        const keyPart = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1).trim();

        // Extract base key (might have parameters like DTSTART;VALUE=DATE)
        const key = keyPart.split(";")[0];

        switch (key) {
          case "SUMMARY":
            summary = value;
            console.log("  - Summary:", summary);
            break;
          case "DESCRIPTION":
            description = value;
            console.log(
              "  - Description:",
              description?.substring(0, 50) + "..."
            );
            break;
          case "LOCATION":
            location = value;
            console.log("  - Location:", location);
            break;
          case "DTSTART":
            startDate = this.parseICalendarDate(value);
            console.log("  - Start date:", startDate?.toISOString());
            break;
          case "DTEND":
            endDate = this.parseICalendarDate(value);
            console.log("  - End date:", endDate?.toISOString());
            break;
          case "UID":
            uid = value;
            break;
          case "URL":
            url = value;
            console.log("  - URL:", url);
            break;
          case "ORGANIZER":
            // Извлекаем имя организатора из формата "CN=Name;MAILTO=email@example.com"
            const cnMatch = value.match(/CN=([^;]*)/);
            organizer = cnMatch?.[1] || value;
            console.log("  - Organizer:", organizer);
            break;
          case "ATTENDEE":
            const attendeeCnMatch = value.match(/CN=([^;]*)/);
            const attendeeName = attendeeCnMatch?.[1] || value;
            if (attendeeName) {
              attendees.push(attendeeName);
            }
            break;
          case "STATUS":
            status = value.toLowerCase();
            console.log("  - Status:", status);
            break;
          case "CATEGORIES":
            categories = value.split(",").map((cat) => cat.trim());
            console.log("  - Categories:", categories);
            break;
        }
      }

      if (summary && startDate && endDate) {
        return {
          id: uid,
          summary,
          description,
          location,
          startDate,
          endDate,
          url: url || undefined,
          organizer: organizer || undefined,
          attendees: attendees.length > 0 ? attendees : undefined,
          status: status || undefined,
          categories: categories.length > 0 ? categories : undefined,
        };
      }

      return null;
    } catch (error) {
      console.error("Error parsing iCalendar event:", error);
      return null;
    }
  }

  private parseICalendarDate(dateString: string): Date {
    // Handle different date formats in iCalendar
    // Format 1: 20240101T120000Z (with time and UTC)
    // Format 2: 20240101T120000 (with time, local)
    // Format 3: 20240101 (date only)

    console.log("  - Parsing date string:", dateString);

    // Remove VALUE=DATE: prefix if present
    if (dateString.includes(":")) {
      dateString = dateString.split(":").pop() || dateString;
    }

    const cleanDate = dateString.replace(/[TZ]/g, "");

    const year = parseInt(cleanDate.substring(0, 4));
    const month = parseInt(cleanDate.substring(4, 6)) - 1;
    const day = parseInt(cleanDate.substring(6, 8));

    // Check if time is included (string length > 8)
    let hour = 0,
      minute = 0,
      second = 0;
    if (cleanDate.length > 8) {
      hour = parseInt(cleanDate.substring(8, 10)) || 0;
      minute = parseInt(cleanDate.substring(10, 12)) || 0;
      second = parseInt(cleanDate.substring(12, 14)) || 0;
    }

    // If string ends with Z, it's UTC; otherwise treat as local time
    const isUTC = dateString.endsWith("Z");
    const date = isUTC
      ? new Date(Date.UTC(year, month, day, hour, minute, second))
      : new Date(year, month, day, hour, minute, second);

    console.log("  - Parsed date:", date.toISOString());
    return date;
  }

  override getTools(): IntegrationTool[] {
    return [
      {
        name: "getEvents",
        tool: tool({
          description: this.getToolMetadata('getEvents').description,
          inputSchema: getEventsSchema,
          execute: async ({ dateRange, limit }) => {
            try {
              console.log("🔄 getEvents tool called with:", {
                dateRange,
                limit,
              });

              const events = await this.fetchEvents();

              let filteredEvents = events;

              if (dateRange?.start || dateRange?.end) {
                console.log("📆 Filtering by date range:", dateRange);
                filteredEvents = events.filter((event) => {
                  const eventStart = event.startDate;
                  const eventEnd = event.endDate;

                  if (dateRange.start) {
                    const filterStart = new Date(dateRange.start);
                    if (eventEnd < filterStart) return false;
                  }

                  if (dateRange.end) {
                    const filterEnd = new Date(dateRange.end);
                    filterEnd.setHours(23, 59, 59, 999);
                    if (eventStart > filterEnd) return false;
                  }

                  return true;
                });
              }

              // Sort events by start date (most recent first for limit)
              filteredEvents.sort(
                (a, b) => a.startDate.getTime() - b.startDate.getTime()
              );

              // Apply limit if specified
              if (limit && limit > 0) {
                console.log(`📝 Limiting to ${limit} events`);
                filteredEvents = filteredEvents.slice(0, limit);
              }

              console.log(`✅ Returning ${filteredEvents.length} events`);

              return {
                success: true,
                events: filteredEvents.map((event) => ({
                  id: event.id,
                  summary: event.summary,
                  description: event.description,
                  startDate: event.startDate.toISOString(),
                  endDate: event.endDate.toISOString(),
                  location: event.location,
                  url: event.url,
                  organizer: event.organizer,
                  attendees: event.attendees,
                  status: event.status,
                  categories: event.categories,
                })),
                totalCount: filteredEvents.length,
              };
            } catch (error) {
              return {
                success: false,
                error: `Ошибка при получении событий: ${error}`,
              };
            }
          },
        }),
      },
      {
        name: "getLastEvents",
        tool: tool({
          description: this.getToolMetadata('getLastEvents').description,
          inputSchema: getLastEventsSchema,
          execute: async ({ count = 5 }) => {
            try {
              console.log(`🔄 getLastEvents tool called with count: ${count}`);

              const events = await this.fetchEvents();

              // Sort events by start date (most recent first)
              const sortedEvents = events.sort(
                (a, b) => b.startDate.getTime() - a.startDate.getTime()
              );

              // Take the requested number of events
              const lastEvents = sortedEvents.slice(0, count);

              console.log(
                `✅ Returning ${lastEvents.length} most recent events`
              );

              return {
                success: true,
                events: lastEvents.map((event) => ({
                  id: event.id,
                  summary: event.summary,
                  description: event.description,
                  startDate: event.startDate.toISOString(),
                  endDate: event.endDate.toISOString(),
                  location: event.location,
                  url: event.url,
                  organizer: event.organizer,
                  attendees: event.attendees,
                  status: event.status,
                  categories: event.categories,
                })),
                totalCount: lastEvents.length,
              };
            } catch (error) {
              return {
                success: false,
                error: `Ошибка при получении последних событий: ${error}`,
              };
            }
          },
        }),
      },
      {
        name: "createEvent",
        tool: tool({
          description: this.getToolMetadata('createEvent').description + `
            ВАЖНО: Сразу создавай событие из доступной информации, не задавай лишних вопросов!
            - Если указано только время - используй сегодняшнюю дату
            - Если не указана длительность - по умолчанию 1 час
            - Если не указано название - извлеки из контекста или используй "Встреча"
            - После создания спроси, нужно ли что-то изменить`,
          inputSchema: createEventSchema,
          execute: async ({
            summary,
            description,
            startDate,
            endDate,
            location,
          }) => {
            try {
              if (!this.client || !this.calendarUrl) {
                throw new Error("Calendar not initialized");
              }

              const eventStartDate = new Date(startDate);
              const eventEndDate = new Date(endDate);

              const startDateTime =
                eventStartDate
                  .toISOString()
                  .replace(/[-:]/g, "")
                  .split(".")[0] + "Z";
              const endDateTime =
                eventEndDate.toISOString().replace(/[-:]/g, "").split(".")[0] +
                "Z";
              const eventId = `event-${Date.now()}@yandex.ru`;

              const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Yandex Calendar Service//EN
BEGIN:VEVENT
UID:${eventId}
DTSTART:${startDateTime}
DTEND:${endDateTime}
SUMMARY:${summary}
${description ? `DESCRIPTION:${description}` : ""}
${location ? `LOCATION:${location}` : ""}
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z
END:VEVENT
END:VCALENDAR`;

              await this.client.createCalendarObject({
                calendar: {
                  url: this.calendarUrl,
                },
                filename: `${eventId}.ics`,
                iCalString: icsContent,
              });

              return {
                success: true,
                eventId,
                event: {
                  summary,
                  description,
                  startDate,
                  endDate,
                  location,
                  url: undefined,
                  organizer: undefined,
                  attendees: undefined,
                  status: "confirmed",
                  categories: undefined,
                },
              };
            } catch (error) {
              return {
                success: false,
                error: `Ошибка при создании события: ${error}`,
              };
            }
          },
        }),
      },
    ];
  }

  override formatToolResult(
    toolName: string,
    result: TypedToolResult<Record<string, any>>
  ): string {
    const output = result?.output as CalendarToolResult | undefined;

    switch (toolName) {
      case "getEvents":
        if (!output || !output.success) {
          return `❌ ${output?.error || "Неизвестная ошибка"}`;
        }

        if (output.totalCount === 0) {
          return "📅 В календаре нет событий на указанный период.";
        }

        return this.formatEventsList(
          output.events || [],
          output.totalCount || 0,
          "📅 Ваши события:"
        );

      case "getLastEvents":
        if (!output || !output.success) {
          return `❌ ${output?.error || "Неизвестная ошибка"}`;
        }

        if (output.totalCount === 0) {
          return "📅 В календаре нет событий.";
        }
        return this.formatEventsList(
          output.events || [],
          output.totalCount || 0,
          `📅 Последние ${output.totalCount} событий:`
        );

      case "createEvent":
        if (!output || !output.success) {
          return `❌ ${output?.error || "Неизвестная ошибка"}`;
        }

        if (output.event) {
          return `✅ **Событие успешно создано!**\n\n${this.formatEventCard(
            output.event
          )}`;
        }

        return `✅ Событие успешно создано!`;

      default:
        console.log(`⚠️  Неизвестный инструмент: ${toolName}`);
        return `⚠️ Неизвестный инструмент: ${toolName}\nРезультат: ${JSON.stringify(
          result,
          null,
          2
        )}`;
    }
  }

  private formatEventsList(
    events: any[],
    _totalCount: number,
    title: string
  ): string {
    // Ограничиваем количество событий для отображения
    const MAX_EVENTS = 10;
    const eventsToShow = events.slice(0, MAX_EVENTS);

    const formattedEvents = eventsToShow
      .map((event: any, index: number) => {
        return this.formatEventCard(event, index + 1);
      })
      .join("\n" + "─".repeat(30) + "\n");

    let response = `${title}\n\n${formattedEvents}`;

    if (events.length > MAX_EVENTS) {
      response += `\n\n📊 Показаны первые ${MAX_EVENTS} из ${events.length} событий`;
    }

    return response;
  }

  private escapeMarkdown(text: string): string {
    // Экранируем специальные символы Markdown
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`')
      .replace(/>/g, '\\>')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/=/g, '\\=')
      .replace(/\|/g, '\\|')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\./g, '\\.')
      .replace(/!/g, '\\!');
  }

  private formatEventCard(event: any, index?: number): string {
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);

    // Форматируем дату и время
    const dateStr = start.toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year:
        start.getFullYear() !== new Date().getFullYear()
          ? "numeric"
          : undefined,
    });

    const startTime = start.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const endTime = end.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Определяем длительность
    const duration = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60)
    );
    const durationStr =
      duration >= 60
        ? `${Math.floor(duration / 60)}ч ${duration % 60}мин`
        : `${duration}мин`;

    // Создаем карточку
    let card = "";

    // Заголовок события с номером (если есть)
    if (index) {
      card += `**${index}.** `;
    }
    card += `**${this.escapeMarkdown(event.summary)}**\n`;

    // Дата и время
    card += `📅 ${this.escapeMarkdown(dateStr)}, ${this.escapeMarkdown(startTime)}–${this.escapeMarkdown(endTime)}`;
    if (duration > 0) {
      card += ` (${this.escapeMarkdown(durationStr)})`;
    }
    card += "\n";

    // Место проведения
    if (event.location) {
      card += `📍 ${this.escapeMarkdown(event.location)}\n`;
    }

    // Организатор
    if (event.organizer && event.organizer !== event.summary) {
      card += `👤 ${this.escapeMarkdown(event.organizer)}\n`;
    }

    // Участники
    if (event.attendees && event.attendees.length > 0) {
      const attendeesStr = event.attendees.slice(0, 3).join(", ");
      const moreAttendees =
        event.attendees.length > 3
          ? ` и ещё ${event.attendees.length - 3}`
          : "";
      card += `👥 ${this.escapeMarkdown(attendeesStr + moreAttendees)}\n`;
    }

    // Категории/теги
    if (event.categories && event.categories.length > 0) {
      const tagsStr = event.categories
        .map((cat: string) => `#${cat.replace(/\s+/g, "_")}`)
        .join(" ");
      card += `🏷 ${this.escapeMarkdown(tagsStr)}\n`;
    }

    // Статус события
    if (event.status) {
      const statusEmoji = this.getStatusEmoji(event.status);
      card += `${statusEmoji} ${this.escapeMarkdown(this.getStatusText(event.status))}\n`;
    }

    // Описание (краткое)
    if (event.description && event.description.trim()) {
      const shortDesc =
        event.description.length > 100
          ? event.description.substring(0, 100) + "..."
          : event.description;
      card += `💬 ${this.escapeMarkdown(shortDesc)}\n`;
    }

    return card.trim();
  }

  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case "confirmed":
        return "✅";
      case "tentative":
        return "❓";
      case "cancelled":
        return "❌";
      default:
        return "📌";
    }
  }

  private getStatusText(status: string): string {
    switch (status.toLowerCase()) {
      case "confirmed":
        return "Подтверждено";
      case "tentative":
        return "Предварительно";
      case "cancelled":
        return "Отменено";
      default:
        return "Запланировано";
    }
  }

  override getProgressStep(toolName: string): ProgressStep {
    // Используем новую систему метаданных вместо статических mapping'ов
    return this.getToolProgressStep(toolName);
  }


  override async disconnect(): Promise<void> {
    this.client = null;
    this.isAuthenticated = false;
  }
}
