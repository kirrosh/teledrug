import { Effect, Console, Schema } from "effect"
import { tool } from "ai"
import { z } from "zod"
import { createDAVClient } from "tsdav"
import { ToolResultFormatter } from "../../types/integrations"

// Yandex Calendar Credentials Schema - Effect Schema
export const YandexCredentials = Schema.Struct({
  calendarUrl: Schema.String,
  username: Schema.String,
  password: Schema.String
})
export type YandexCredentials = Schema.Schema.Type<typeof YandexCredentials>

const DateRangeSchema = Schema.Struct({
  start: Schema.optional(Schema.String),
  end: Schema.optional(Schema.String)
})

const GetEventsParamsSchema = Schema.Struct({
  dateRange: Schema.optional(DateRangeSchema),
  limit: Schema.optional(Schema.Number)
})

const CalendarEventSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  summary: Schema.String,
  description: Schema.optional(Schema.String),
  startDate: Schema.String,
  endDate: Schema.String,
  location: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  organizer: Schema.optional(Schema.String),
  attendees: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(Schema.String))
})

const GetEventsResultSchema = Schema.Struct({
  success: Schema.Boolean,
  events: Schema.Array(CalendarEventSchema),
  message: Schema.optional(Schema.String),
  totalCount: Schema.optional(Schema.Number)
})

const CreateEventParamsSchema = Schema.Struct({
  summary: Schema.String,
  startDate: Schema.String,
  endDate: Schema.optional(Schema.String),
  durationMinutes: Schema.optional(Schema.Number),
  location: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String)
})

const CreateEventResultSchema = Schema.Struct({
  success: Schema.Boolean,
  eventId: Schema.optional(Schema.String),
  event: Schema.optional(CalendarEventSchema),
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String)
})

type GetEventsParams = Schema.Schema.Type<typeof GetEventsParamsSchema>
type GetEventsResult = Schema.Schema.Type<typeof GetEventsResultSchema>

type CalendarEvent = Schema.Schema.Type<typeof CalendarEventSchema>

type CreateEventParams = Schema.Schema.Type<typeof CreateEventParamsSchema>
type CreateEventResult = Schema.Schema.Type<typeof CreateEventResultSchema>

type YandexToolOptions = {
  credentials: YandexCredentials
  encryptedCredentials?: {
    encrypted: string
    iv: string
    tag: string
  }
}

const fetchCalendarEvents = async (
  credentials: YandexCredentials
): Promise<CalendarEvent[]> => {
  const client = await createDAVClient({
    serverUrl: credentials.calendarUrl,
    credentials: {
      username: credentials.username,
      password: credentials.password
    },
    authMethod: "Basic",
    defaultAccountType: "caldav"
  })

  const calendarObjects = await client.fetchCalendarObjects({
    calendar: {
      url: credentials.calendarUrl
    }
  })

  const events: CalendarEvent[] = []

  for (const calendarObject of calendarObjects) {
    if (!calendarObject.data) {
      continue
    }

    const event = parseICalendarEvent(calendarObject.data)
    if (event) {
      events.push(event)
    }
  }

  return events
}

const parseICalendarEvent = (icsData: string): CalendarEvent | null => {
  const lines = icsData.split("\n")
  let summary = ""
  let description = ""
  let location = ""
  let startDate: Date | null = null
  let endDate: Date | null = null
  let uid = ""
  let url = ""
  let organizer = ""
  const attendees: string[] = []
  let status = ""
  let categories: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) continue

    const keyPart = line.substring(0, colonIndex)
    const value = line.substring(colonIndex + 1).trim()
    const key = keyPart.split(";")[0]

    switch (key) {
      case "SUMMARY":
        summary = value
        break
      case "DESCRIPTION":
        description = value
        break
      case "LOCATION":
        location = value
        break
      case "DTSTART":
        startDate = parseICalendarDate(value)
        break
      case "DTEND":
        endDate = parseICalendarDate(value)
        break
      case "UID":
        uid = value
        break
      case "URL":
        url = value
        break
      case "ORGANIZER": {
        const cnMatch = value.match(/CN=([^;]*)/)
        organizer = cnMatch?.[1] || value
        break
      }
      case "ATTENDEE": {
        const attendeeMatch = value.match(/CN=([^;]*)/)
        const attendee = attendeeMatch?.[1] || value
        attendees.push(attendee)
        break
      }
      case "STATUS":
        status = value.toLowerCase()
        break
      case "CATEGORIES":
        categories = value.split(",").map((category) => category.trim())
        break
    }
  }

  if (!summary || !startDate || !endDate) {
    return null
  }

  return {
    id: uid || undefined,
    summary,
    description: description || undefined,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    location: location || undefined,
    url: url || undefined,
    organizer: organizer || undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
    status: status || undefined,
    categories: categories.length > 0 ? categories : undefined
  }
}

const parseICalendarDate = (rawValue: string): Date => {
  const value = rawValue.includes(":") ? rawValue.split(":").pop() ?? rawValue : rawValue
  const cleanDate = value.replace(/[TZ]/g, "")

  const year = Number.parseInt(cleanDate.substring(0, 4), 10)
  const month = Number.parseInt(cleanDate.substring(4, 6), 10) - 1
  const day = Number.parseInt(cleanDate.substring(6, 8), 10)

  let hour = 0
  let minute = 0
  let second = 0

  if (cleanDate.length > 8) {
    hour = Number.parseInt(cleanDate.substring(8, 10), 10) || 0
    minute = Number.parseInt(cleanDate.substring(10, 12), 10) || 0
    second = Number.parseInt(cleanDate.substring(12, 14), 10) || 0
  }

  const isUTC = rawValue.endsWith("Z")
  return isUTC
    ? new Date(Date.UTC(year, month, day, hour, minute, second))
    : new Date(year, month, day, hour, minute, second)
}

const filterEventsByDateRange = (
  events: CalendarEvent[],
  params: GetEventsParams
) => {
  if (!params.dateRange?.start && !params.dateRange?.end) {
    return events
  }

  return events.filter((event) => {
    const eventStart = new Date(event.startDate)
    const eventEnd = new Date(event.endDate)

    if (params.dateRange?.start) {
      const startBoundary = new Date(params.dateRange.start)
      if (eventEnd < startBoundary) {
        return false
      }
    }

    if (params.dateRange?.end) {
      const endBoundary = new Date(params.dateRange.end)
      endBoundary.setHours(23, 59, 59, 999)
      if (eventStart > endBoundary) {
        return false
      }
    }

    return true
  })
}

const applyLimit = (events: CalendarEvent[], limit?: number) => {
  if (!limit || limit <= 0) {
    return events
  }

  return events.slice(0, limit)
}

const sortEventsByStartDate = (events: CalendarEvent[]) =>
  events
    .slice()
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )

const DEFAULT_EVENT_DURATION_MINUTES = 60

const toICalDateTime = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"

const escapeICalText = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")

const createCalendarEvent = async (
  credentials: YandexCredentials,
  params: CreateEventParams
): Promise<CreateEventResult> => {
  const client = await createDAVClient({
    serverUrl: credentials.calendarUrl,
    credentials: {
      username: credentials.username,
      password: credentials.password
    },
    authMethod: "Basic",
    defaultAccountType: "caldav"
  })

  const start = new Date(params.startDate)
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid startDate provided")
  }

  let end: Date
  if (params.endDate) {
    end = new Date(params.endDate)
    if (Number.isNaN(end.getTime())) {
      throw new Error("Invalid endDate provided")
    }
  } else {
    const duration = params.durationMinutes && params.durationMinutes > 0
      ? params.durationMinutes
      : DEFAULT_EVENT_DURATION_MINUTES
    end = new Date(start.getTime() + duration * 60_000)
  }

  if (start.getTime() >= end.getTime()) {
    throw new Error("Event end must be after start")
  }

  const summary = params.summary.trim() || "Встреча"
  const description = (params.description?.trim() || "🤖 Событие создано с помощью TeleDrug")
  const eventId = `teledrug-${Date.now()}@yandex.ru`

  const event: CalendarEvent = {
    id: eventId,
    summary,
    description,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    location: params.location,
    url: undefined,
    organizer: undefined,
    attendees: undefined,
    status: "confirmed",
    categories: undefined
  }

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
    "END:VCALENDAR"
  ].filter((line): line is string => Boolean(line))

  const iCalString = lines.join("\n")

  await client.createCalendarObject({
    calendar: {
      url: credentials.calendarUrl
    },
    filename: `${eventId}.ics`,
    iCalString
  })

  return {
    success: true,
    eventId,
    event,
    message: `Событие "${summary}" создано`
  }
}

// Создаем tools для AI SDK v5 - zod только для LLM интерфейса
export const createYandexCalendarTools = ({
  credentials,
  encryptedCredentials
}: YandexToolOptions) => {
  const formatters: Record<string, ToolResultFormatter> = {
    getEvents: formatGetEventsResult,
    createEvent: formatCreateEventResult
  }

  const tools = {
    getEvents: tool({
      description: "Получение событий из Яндекс.Календаря",
      inputSchema: z.object({
        dateRange: z
          .object({
            start: z
              .string()
              .optional()
              .describe("Начальная дата в формате ISO (YYYY-MM-DD)"),
            end: z
              .string()
              .optional()
              .describe("Конечная дата в формате ISO (YYYY-MM-DD)")
          })
          .optional()
          .describe("Диапазон дат для поиска событий"),
        limit: z
          .number()
          .optional()
          .describe("Максимальное количество событий в выдаче")
      }),
      execute: async ({ dateRange, limit }) => {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            yield* Console.log("🗓️ Executing Yandex Calendar getEvents tool...")

            if (encryptedCredentials) {
              yield* Console.log(
                "🔐 Stored encrypted credentials:",
                JSON.stringify(encryptedCredentials)
              )
            }

            const validCredentials = yield* Schema.decodeUnknown(YandexCredentials)(
              credentials
            )

            const params = yield* Schema.decodeUnknown(GetEventsParamsSchema)({
              dateRange,
              limit
            })

            yield* Console.log(
              "📅 Request parameters:",
              JSON.stringify(params, null, 2)
            )

            const events = yield* Effect.tryPromise({
              try: async () => fetchCalendarEvents(validCredentials),
              catch: (cause) =>
                new Error(
                  `Failed to fetch calendar events: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`
                )
            })

            const filtered = applyLimit(
              sortEventsByStartDate(filterEventsByDateRange(events, params)),
              params.limit
            )

            const response: GetEventsResult = {
              success: true,
              events: filtered,
              totalCount: filtered.length,
              message:
                filtered.length > 0
                  ? `Найдено ${filtered.length} событий для ${validCredentials.username}`
                  : "События не найдены"
            }

            return yield* Schema.decodeUnknown(GetEventsResultSchema)(response)
          }).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                success: false,
                events: [],
                message: `Ошибка при обращении к Яндекс.Календарю: ${error}`,
                totalCount: 0
              } satisfies GetEventsResult)
            )
          )
        )

        return result
      }
    }),
    createEvent: tool({
      description: "Создание события в Яндекс.Календаре",
      inputSchema: z.object({
        summary: z.string().describe("Название события"),
        startDate: z
          .string()
          .describe("Дата и время начала в ISO формате"),
        endDate: z
          .string()
          .optional()
          .describe("Дата и время окончания в ISO формате"),
        durationMinutes: z
          .number()
          .optional()
          .describe("Длительность события в минутах (если не указан endDate)"),
        location: z.string().optional().describe("Место проведения"),
        description: z.string().optional().describe("Описание события")
      }),
      execute: async (input) => {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            yield* Console.log("🗓️ Creating Yandex Calendar event...")

            if (encryptedCredentials) {
              yield* Console.log(
                "🔐 Stored encrypted credentials:",
                JSON.stringify(encryptedCredentials)
              )
            }

            const validCredentials = yield* Schema.decodeUnknown(YandexCredentials)(
              credentials
            )

            const params = yield* Schema.decodeUnknown(CreateEventParamsSchema)(
              input
            )

            yield* Console.log(
              "🗒️ Event payload:",
              JSON.stringify(
                {
                  summary: params.summary,
                  startDate: params.startDate,
                  endDate: params.endDate,
                  durationMinutes: params.durationMinutes,
                  location: params.location
                },
                null,
                2
              )
            )

            const creation = yield* Effect.tryPromise({
              try: async () => createCalendarEvent(validCredentials, params),
              catch: (cause) =>
                new Error(
                  `Failed to create calendar event: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`
                )
            })

            return yield* Schema.decodeUnknown(CreateEventResultSchema)(creation)
          }).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                success: false,
                error: `Ошибка при создании события: ${error}`,
                message: typeof error === "string" ? error : undefined
              } satisfies CreateEventResult)
            )
          )
        )

        return result
      }
    })
  }

  return { tools, formatters }
}

const formatGetEventsResult: ToolResultFormatter = (output) =>
  Schema.decodeUnknown(GetEventsResultSchema)(output).pipe(
    Effect.map((result) => {
      if (!result.success) {
        return result.message ? `❌ ${result.message}` : "❌ Не удалось получить события календаря."
      }

      if (!result.events || result.events.length === 0) {
        return "📅 У вас нет событий на выбранный период."
      }

      const formattedEvents = result.events
        .map((event, index) => formatEventCard(event, index + 1))
        .join("\n\n")

      let response = `📅 **События календаря:**\n\n${formattedEvents}`

      if (typeof result.totalCount === "number") {
        response += `\n\n📊 Всего событий: ${result.totalCount}`
      }

      if (result.message) {
        response += `\nℹ️ ${result.message}`
      }

      return response
    }),
    Effect.catchAll(() =>
      Effect.succeed("❌ Не удалось обработать результат инструмента календаря.")
    )
  )

const formatCreateEventResult: ToolResultFormatter = (output) =>
  Schema.decodeUnknown(CreateEventResultSchema)(output).pipe(
    Effect.map((result) => {
      if (!result.success) {
        return result.error
          ? `❌ ${result.error}`
          : "❌ Не удалось создать событие."
      }

      if (!result.event) {
        return result.message
          ? `✅ ${result.message}`
          : "✅ Событие создано."
      }

      const start = new Date(result.event.startDate)
      const end = new Date(result.event.endDate)

      const dateStr = start.toLocaleDateString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year:
          start.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      })

      const timeRange = `${start.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}–${end.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}`

      let response = `✅ Событие создано: **${result.event.summary}**\n`
      response += `📅 ${dateStr}, ${timeRange}\n`

      if (result.event.location) {
        response += `📍 ${result.event.location}\n`
      }

      if (result.event.description) {
        response += `📝 ${result.event.description}\n`
      }

      if (result.eventId) {
        response += `🆔 ${result.eventId}\n`
      }

      if (result.message) {
        response += `ℹ️ ${result.message}`
      }

      return response.trim()
    }),
    Effect.catchAll(() =>
      Effect.succeed("❌ Не удалось обработать результат создания события.")
    )
  )

const formatEventCard = (event: CalendarEvent, index: number) => {
  const start = new Date(event.startDate)
  const end = new Date(event.endDate)

  const formattedDate = start.toLocaleDateString("ru-RU", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })

  const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
  const durationText = durationMinutes
    ? durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)}ч ${durationMinutes % 60}мин`
      : `${durationMinutes}мин`
    : undefined

  let card = `${index}. **${event.summary || "Событие"}**\n`
  card += `   📅 ${formattedDate}`
  if (durationText) {
    card += ` • ${durationText}`
  }
  card += "\n"

  if (event.location) {
    card += `   📍 ${event.location}\n`
  }

  if (event.description) {
    card += `   📝 ${event.description}\n`
  }

  if (event.organizer) {
    card += `   👤 ${event.organizer}\n`
  }

  if (event.attendees && event.attendees.length > 0) {
    const attendeesPreview = event.attendees.slice(0, 3).join(", ")
    const moreCount = event.attendees.length - 3
    card += `   👥 ${attendeesPreview}${moreCount > 0 ? ` и ещё ${moreCount}` : ""}\n`
  }

  if (event.categories && event.categories.length > 0) {
    const tags = event.categories.map((category) => `#${category.replace(/\s+/g, "_")}`).join(" ")
    card += `   🏷 ${tags}\n`
  }

  return card.trimEnd()
}

export const YandexCalendarIntegration = {
  name: "YandexCalendar",
  createTools: createYandexCalendarTools
}
