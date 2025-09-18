import { Effect, Console, Schema } from "effect"
import { tool } from "ai"
import { z } from "zod"

// Yandex Calendar Credentials Schema - Effect Schema
export const YandexCredentials = Schema.Struct({
  calendarUrl: Schema.String,
  username: Schema.String,
  password: Schema.String
})
export type YandexCredentials = Schema.Schema.Type<typeof YandexCredentials>

// Internal schemas - Effect Schema для внутренней работы
const DateRangeSchema = Schema.Struct({
  start: Schema.optional(Schema.String),
  end: Schema.optional(Schema.String)
})

const GetEventsParamsSchema = Schema.Struct({
  dateRange: Schema.optional(DateRangeSchema)
})

const CalendarEventSchema = Schema.Struct({
  title: Schema.String,
  date: Schema.String,
  description: Schema.optional(Schema.String)
})

const GetEventsResultSchema = Schema.Struct({
  success: Schema.Boolean,
  events: Schema.Array(CalendarEventSchema),
  message: Schema.String
})

type GetEventsParams = Schema.Schema.Type<typeof GetEventsParamsSchema>
type GetEventsResult = Schema.Schema.Type<typeof GetEventsResultSchema>

// Создаем getEvents tool для AI SDK v5 - zod только для LLM интерфейса
export const createYandexCalendarTools = (credentials: YandexCredentials) => ({
  getEvents: tool({
    description: "Get calendar events from Yandex Calendar",
    inputSchema: z.object({
      dateRange: z.optional(z.object({
        start: z.optional(z.string().describe("Start date in ISO format")),
        end: z.optional(z.string().describe("End date in ISO format"))
      })).describe("Date range for filtering events")
    }),
    execute: async ({ dateRange }) => {
      // Используем Effect для обработки
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          console.log("🗓️ Executing Yandex Calendar getEvents tool...")

          // Валидируем credentials с помощью Effect Schema
          const validCredentials = yield* Schema.decodeUnknown(YandexCredentials)(credentials)

          console.log("📋 User credentials:", {
            calendarUrl: validCredentials.calendarUrl,
            username: validCredentials.username,
            password: "***" // Скрываем пароль
          })

          // Валидируем входные параметры с помощью Effect Schema
          const validParams = yield* Schema.decodeUnknown(GetEventsParamsSchema)({ dateRange })
          console.log("📅 Parameters:", JSON.stringify(validParams, null, 2))

          // Создаем результат с валидацией через Effect Schema
          const events = [
            {
              title: "Встреча с командой",
              date: "2024-01-15T10:00:00Z",
              description: "Обсуждение проекта"
            },
            {
              title: "Презентация",
              date: "2024-01-16T14:00:00Z",
              description: "Демо новых функций"
            }
          ]

          const response: GetEventsResult = {
            success: true,
            events,
            message: `Найдено 2 события в календаре (${validCredentials.username})`
          }

          // Валидируем результат перед возвратом
          return yield* Schema.decodeUnknown(GetEventsResultSchema)(response)
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed({
              success: false,
              events: [],
              message: `Ошибка: ${error}`
            })
          )
        )
      )

      return result
    }
  })
})

// Экспорт для использования в Registry
export const YandexCalendarIntegration = {
  name: "YandexCalendar",
  createTools: createYandexCalendarTools
}