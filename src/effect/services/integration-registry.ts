import { Effect, Context, Layer, Console } from "effect"
import { Tool as AITool } from "ai"
import {
  InteractionType,
  ToolError,
  IntegrationError
} from "../types/integrations"
import { YandexCalendarIntegration } from "../integrations/yandex-calendar"

// Simple registry interface для AI SDK v5
export interface IntegrationRegistry {
  readonly getAllTools: (interactionType: InteractionType) => Effect.Effect<Record<string, AITool>, ToolError>
}

export const IntegrationRegistry = Context.GenericTag<IntegrationRegistry>("@services/IntegrationRegistry")

// Реализация registry с реальными интеграциями
const makeIntegrationRegistry = Effect.gen(function* () {
  yield* Console.log("🔧 Initializing Integration Registry...")

  // Моковые credentials для Yandex Calendar (в реальности будут браться из БД пользователя)
  const mockYandexCredentials = {
    calendarUrl: "https://caldav.yandex.ru/calendars/user@yandex.ru/events/",
    username: "user@yandex.ru",
    password: "mock_password"
  }

  // Создаем tools для Yandex Calendar интеграции
  const yandexTools = YandexCalendarIntegration.createTools(mockYandexCredentials)

  yield* Console.log(`✅ Created tools for ${YandexCalendarIntegration.name} integration`)

  // Функция получения всех tools
  const getAllTools = (interactionType: InteractionType) =>
    Effect.gen(function* () {
      yield* Console.log(`🔧 Registry: Getting tools for interaction type: ${interactionType}`)

      const allTools: Record<string, AITool> = {}

      // Для TEXT и VOICE добавляем tools от Yandex Calendar
      if (interactionType === "TEXT" || interactionType === "VOICE") {
        // Добавляем все tools из Yandex Calendar интеграции
        Object.assign(allTools, yandexTools)
      }

      yield* Console.log(`✅ Registry: Found ${Object.keys(allTools).length} tools total`)
      return allTools
    })

  return {
    getAllTools
  } satisfies IntegrationRegistry
})

export const IntegrationRegistryLive = Layer.effect(
  IntegrationRegistry,
  makeIntegrationRegistry
)