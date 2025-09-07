import { createDAVClient } from "tsdav";

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  location?: string;
}

export class YandexCalendarService {
  private client: any;
  private calendarUrl: string;
  private username: string;
  private password: string;

  constructor(calendarUrl: string, username: string, password: string) {
    this.calendarUrl = calendarUrl;
    this.username = username;
    this.password = password;
  }

  async initialize(): Promise<void> {
    this.client = await createDAVClient({
      serverUrl: this.calendarUrl,
      credentials: {
        username: this.username,
        password: this.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }

  async createEvent(event: CalendarEvent): Promise<string> {
    if (!this.client) {
      await this.initialize();
    }

    const startDateTime =
      event.startDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const endDateTime =
      event.endDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const eventId = `event-${Date.now()}@yandex.ru`;

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Yandex Calendar Service//EN
BEGIN:VEVENT
UID:${eventId}
DTSTART:${startDateTime}
DTEND:${endDateTime}
SUMMARY:${event.summary}
${event.description ? `DESCRIPTION:${event.description}` : ""}
${event.location ? `LOCATION:${event.location}` : ""}
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z
END:VEVENT
END:VCALENDAR`;

    try {
      await this.client.createCalendarObject({
        calendar: {
          url: this.calendarUrl,
        },
        filename: `${eventId}.ics`,
        iCalString: icsContent,
      });

      return eventId;
    } catch (error) {
      console.error("Error creating event:", error);
      throw new Error(`Failed to create event: ${error}`);
    }
  }

  async getEvents(): Promise<CalendarEvent[]> {
    if (!this.client) {
      await this.initialize();
    }

    try {
      const calendarObjects = await this.client.fetchCalendarObjects({
        calendar: {
          url: this.calendarUrl,
        },
      });

      const events: CalendarEvent[] = [];

      for (const calendarObject of calendarObjects) {
        if (calendarObject.data) {
          const event = this.parseICalendarEvent(calendarObject.data);
          if (event) {
            events.push(event);
          }
        }
      }

      return events;
    } catch (error) {
      console.error("Error fetching events:", error);
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

      for (const line of lines) {
        const [key, ...valueParts] = line.split(":");
        const value = valueParts.join(":").trim();

        switch (key) {
          case "SUMMARY":
            summary = value;
            break;
          case "DESCRIPTION":
            description = value;
            break;
          case "LOCATION":
            location = value;
            break;
          case "DTSTART":
            startDate = this.parseICalendarDate(value);
            break;
          case "DTEND":
            endDate = this.parseICalendarDate(value);
            break;
          case "UID":
            uid = value;
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
        };
      }

      return null;
    } catch (error) {
      console.error("Error parsing iCalendar event:", error);
      return null;
    }
  }

  private parseICalendarDate(dateString: string): Date {
    const cleanDate = dateString.replace(/[TZ]/g, "");

    const year = parseInt(cleanDate.substring(0, 4));
    const month = parseInt(cleanDate.substring(4, 6)) - 1; // месяцы в JS начинаются с 0
    const day = parseInt(cleanDate.substring(6, 8));
    const hour = parseInt(cleanDate.substring(8, 10)) || 0;
    const minute = parseInt(cleanDate.substring(10, 12)) || 0;
    const second = parseInt(cleanDate.substring(12, 14)) || 0;

    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
}
