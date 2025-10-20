import { Effect, Console, Schema, Option } from "effect"
import { tool, type CoreMessage } from "ai"
import { z } from "zod"
import { createDAVClient } from "tsdav"
import { ToolResultFormatter } from "../../types/integrations"
import { ToolProgressReporter } from "../../core/tool-progress"

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
  userId: number
  credentials: YandexCredentials
  encryptedCredentials?: {
    encrypted: string
    iv: string
    tag: string
  }
  userTimezone?: string
  userLocale?: string
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

export const filterEventsByDateRange = (
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

export const sortEventsByStartDate = (events: CalendarEvent[]) =>
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

const escapeMarkdown = (text: string) =>
  text.replace(/([_`*\[\]()~>#+\-=|{}.!\\])/g, "\\$1")

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
  userId,
  credentials,
  encryptedCredentials,
  userTimezone,
  userLocale
}: YandexToolOptions) => {
  const displayTimezone = resolveTimezone(userTimezone)
  const displayLocale = resolveLocale(userLocale)
  const formatterOptions: CalendarFormatterOptions = {
    timeZone: displayTimezone,
    locale: displayLocale
  }

  const formatters: Record<string, ToolResultFormatter> = {
    getEvents: makeFormatGetEventsResult(formatterOptions),
    createEvent: makeFormatCreateEventResult(formatterOptions)
  }

  const progressMessages: Record<string, string> = {
    getEvents: "Получаю события из Яндекс.Календаря...",
    createEvent: "Создаю событие в Яндекс.Календаре..."
  }

  const contextMessages: ReadonlyArray<CoreMessage> = [
    {
      role: "system",
      content: [
        `Часовой пояс пользователя: ${displayTimezone}.`,
        "Если в запросе нет смещения, используй этот часовой пояс.",
        "Создавай не более одного события за один запрос."
      ].join("\n")
    }
  ]

  let hasCreatedEvent = false

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

            const progressReporterOption = yield* Effect.serviceOption(
              ToolProgressReporter
            )
            if (Option.isSome(progressReporterOption)) {
              const progressMessage =
                progressMessages.getEvents ||
                "Получаю события из Яндекс.Календаря..."
              yield* progressReporterOption.value.report(
                "getEvents",
                progressMessage
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
            if (hasCreatedEvent) {
              yield* Console.log("⛔ Duplicate calendar event creation blocked")
              return yield* Schema.decodeUnknown(CreateEventResultSchema)({
                success: false,
                error:
                  "За один запрос можно создать только одно событие. Отправьте новое сообщение, чтобы добавить ещё встречу.",
                message:
                  "Повторное создание события заблокировано до следующего запроса."
              })
            }

            yield* Console.log("🗓️ Creating Yandex Calendar event...")

            if (encryptedCredentials) {
              yield* Console.log(
                "🔐 Stored encrypted credentials:",
                JSON.stringify(encryptedCredentials)
              )
            }

            const progressReporterOption = yield* Effect.serviceOption(
              ToolProgressReporter
            )
            if (Option.isSome(progressReporterOption)) {
              const progressMessage =
                progressMessages.createEvent ||
                "Создаю событие в Яндекс.Календаре..."
              yield* progressReporterOption.value.report(
                "createEvent",
                progressMessage
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

            if (creation.success) {
              hasCreatedEvent = true
              // Примечание: создание записи в tasks теперь происходит через TaskRepository
              // при создании события через manageTasks, а не здесь
            }

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

  return { tools, formatters, progressMessages, contextMessages }
}

interface CalendarFormatterOptions {
  readonly timeZone: string
  readonly locale: string
}

const makeFormatGetEventsResult = (
  options: CalendarFormatterOptions
): ToolResultFormatter =>
  (output) =>
    Schema.decodeUnknown(GetEventsResultSchema)(output).pipe(
      Effect.map((result) => {
        if (!result.success) {
          const text = result.message
            ? `❌ ${escapeMarkdown(result.message)}`
            : "❌ Не удалось получить события календаря."
          return { text, parseMode: "Markdown" as const }
        }

        if (!result.events || result.events.length === 0) {
          return {
            text: "📅 У вас нет событий на выбранный период.",
            parseMode: "Markdown" as const,
          }
        }

        const formattedEvents = result.events
          .map((event, index) => formatEventCard(event, index + 1, options))
          .join("\n\n")

        let response = `📅 **События календаря:**\n\n${formattedEvents}`

        if (typeof result.totalCount === "number") {
          response += `\n\n📊 Всего событий: ${escapeMarkdown(result.totalCount.toString())}`
        }

        if (result.message) {
          response += `\nℹ️ ${escapeMarkdown(result.message)}`
        }

        response += `\n🕒 Часовой пояс: ${escapeMarkdown(options.timeZone)}`

        return { text: response, parseMode: "Markdown" as const }
      }),
      Effect.catchAll(() =>
        Effect.succeed({
          text: "❌ Не удалось обработать результат инструмента календаря.",
          parseMode: "Markdown" as const,
        })
      )
    )

const makeFormatCreateEventResult = (
  options: CalendarFormatterOptions
): ToolResultFormatter =>
  (output) =>
    Schema.decodeUnknown(CreateEventResultSchema)(output).pipe(
      Effect.map((result) => {
        if (!result.success) {
          const text = result.error
            ? `❌ ${escapeMarkdown(result.error)}`
            : "❌ Не удалось создать событие."
          return { text, parseMode: "Markdown" as const }
        }

        if (!result.event) {
          const text = result.message
            ? `✅ ${escapeMarkdown(result.message)}`
            : "✅ Событие создано."
          return { text, parseMode: "Markdown" as const }
        }

        const start = new Date(result.event.startDate)
        const end = new Date(result.event.endDate)

        const dateStr = start.toLocaleDateString(options.locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year:
            start.getFullYear() !== new Date().getFullYear()
              ? "numeric"
              : undefined,
          timeZone: options.timeZone
        })

        const startTime = start.toLocaleTimeString(options.locale, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: options.timeZone
        })
        const endTime = end.toLocaleTimeString(options.locale, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: options.timeZone
        })
        const timeRange = `${startTime}–${endTime}`

        const summary = escapeMarkdown(result.event.summary)
        const location = result.event.location
          ? escapeMarkdown(result.event.location)
          : undefined
        const description = result.event.description
          ? escapeMarkdown(result.event.description)
          : undefined
        const eventId = result.eventId
          ? escapeMarkdown(result.eventId)
          : undefined
        const message = result.message
          ? escapeMarkdown(result.message)
          : undefined
        const safeDateStr = escapeMarkdown(dateStr)
        const safeTimeRange = escapeMarkdown(timeRange)

        let response = `✅ Событие создано: **${summary}**\n`
        response += `📅 ${safeDateStr}, ${safeTimeRange}\n`

        if (location) {
          response += `📍 ${location}\n`
        }

        if (description) {
          response += `📝 ${description}\n`
        }

        if (eventId) {
          response += `🆔 ${eventId}\n`
        }

        response += `🕒 Часовой пояс: ${escapeMarkdown(options.timeZone)}`

        if (message) {
          response += `\nℹ️ ${message}`
        }

        return {
          text: response.trim(),
          parseMode: "Markdown" as const,
        }
      }),
      Effect.catchAll(() =>
        Effect.succeed({
          text: "❌ Не удалось обработать результат создания события.",
          parseMode: "Markdown" as const,
        })
      )
    )

const formatEventCard = (
  event: CalendarEvent,
  index: number,
  options: CalendarFormatterOptions
) => {
  const start = new Date(event.startDate)
  const end = new Date(event.endDate)

  const formattedDate = start.toLocaleString(options.locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options.timeZone
  })

  const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
  const durationText = durationMinutes
    ? durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)}ч ${durationMinutes % 60}мин`
      : `${durationMinutes}мин`
    : undefined

  const summary = escapeMarkdown(event.summary || "Событие")
  const safeDate = escapeMarkdown(formattedDate)

  let card = `${index}. **${summary}**\n`
  card += `   📅 ${safeDate}`
  if (durationText) {
    card += ` • ${escapeMarkdown(durationText)}`
  }
  card += "\n"

  if (event.location) {
    card += `   📍 ${escapeMarkdown(event.location)}\n`
  }

  if (event.description) {
    card += `   📝 ${escapeMarkdown(event.description)}\n`
  }

  if (event.organizer) {
    card += `   👤 ${escapeMarkdown(event.organizer)}\n`
  }

  if (event.attendees && event.attendees.length > 0) {
    const attendeesPreview = event.attendees.slice(0, 3).join(", ")
    const moreCount = event.attendees.length - 3
    const attendeesText = `${attendeesPreview}${
      moreCount > 0 ? ` и ещё ${moreCount}` : ""
    }`
    card += `   👥 ${escapeMarkdown(attendeesText)}\n`
  }

  if (event.categories && event.categories.length > 0) {
    const tags = event.categories
      .map((category) => `#${category.replace(/\s+/g, "_")}`)
      .join(" ")
    card += `   🏷 ${escapeMarkdown(tags)}\n`
  }

  card += `   🕒 ${escapeMarkdown(options.timeZone)}\n`

  return card.trimEnd()
}

const DEFAULT_CALENDAR_TIMEZONE = "UTC"
const DEFAULT_CALENDAR_LOCALE = "ru-RU"

const resolveTimezone = (value?: string): string => {
  const candidate = value?.trim()
  if (!candidate) {
    return DEFAULT_CALENDAR_TIMEZONE
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format()
    return candidate
  } catch {
    return DEFAULT_CALENDAR_TIMEZONE
  }
}

const resolveLocale = (value?: string): string => {
  const candidate = value?.trim()
  if (!candidate) {
    return DEFAULT_CALENDAR_LOCALE
  }
  try {
    new Intl.DateTimeFormat(candidate).format(new Date())
    return candidate
  } catch {
    return DEFAULT_CALENDAR_LOCALE
  }
}

export const YandexCalendarIntegration = {
  name: "YandexCalendar",
  createTools: createYandexCalendarTools
}

export const fetchEventsForRange = async (
  credentials: YandexCredentials,
  start: Date,
  end: Date
) => {
  const events = await fetchCalendarEvents(credentials)

  const filtered = filterEventsByDateRange(events, {
    dateRange: {
      start: start.toISOString(),
      end: end.toISOString()
    }
  })

  return sortEventsByStartDate(filtered)
}

export type { CalendarEvent };
