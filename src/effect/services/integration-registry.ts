import { Effect, Context, Layer, Console } from "effect"
import { Tool as AITool } from "ai"
import {
  InteractionType,
  IntegrationError
} from "../types/integrations"
import {
  YandexCalendarIntegration,
  YandexCredentials
} from "../integrations/yandex-calendar"
import { UserRepository } from "./user-repository"

// Integration registry interface для AI SDK v5
export interface IntegrationRegistry {
  readonly getToolsForUser: (
    userId: string | number,
    interactionType: InteractionType
  ) => Effect.Effect<Record<string, AITool>, IntegrationError>
}

export const IntegrationRegistry = Context.GenericTag<IntegrationRegistry>(
  "@services/IntegrationRegistry"
)

const toNumericUserId = (userId: string | number) => {
  if (typeof userId === "number") {
    return userId
  }

  const parsed = Number.parseInt(userId, 10)
  if (Number.isNaN(parsed)) {
    throw new IntegrationError({
      message: `Invalid user id received from context: ${userId}`
    })
  }

  return parsed
}

// Реализация registry с реальными интеграциями
const makeIntegrationRegistry = Effect.gen(function* () {
  const userRepository = yield* UserRepository

  yield* Console.log("🔧 Initializing Integration Registry...")

  const getToolsForUser = (
    userId: string | number,
    interactionType: InteractionType
  ) =>
    Effect.gen(function* () {
      const numericUserId = yield* Effect.try({
        try: () => toNumericUserId(userId),
        catch: (cause) =>
          new IntegrationError({
            message: "Failed to normalise user identifier",
            cause
          })
      })

      yield* Console.log(
        `🔧 Registry: loading tools for user ${numericUserId} (${interactionType})`
      )

      const integrations = yield* userRepository
        .getAllDecryptedIntegrations(numericUserId)
        .pipe(
          Effect.mapError((cause) =>
            new IntegrationError({
              message: "Failed to fetch user integrations",
              cause
            })
          )
        )

      if (integrations.length === 0) {
        yield* Console.log(
          `📭 Registry: user ${numericUserId} has no integrations configured`
        )
        return {} satisfies Record<string, AITool>
      }

      const tools: Record<string, AITool> = {}

      for (const { integration, credentials } of integrations) {
        if (!integration.enabled) {
          yield* Console.log(
            `⏭️ Registry: integration ${integration.integrationType} disabled for user ${numericUserId}`
          )
          continue
        }

        switch (integration.integrationType) {
          case "YandexCalendar": {
            if (interactionType !== "TEXT" && interactionType !== "VOICE") {
              yield* Console.log(
                `⚖️ Registry: skipping YandexCalendar tools for unsupported interaction type ${interactionType}`
              )
              break
            }

            const yandexTools = YandexCalendarIntegration.createTools({
              credentials: credentials as YandexCredentials,
              encryptedCredentials: {
                encrypted: integration.credentialsEncrypted,
                iv: integration.credentialsIv,
                tag: integration.credentialsTag
              }
            })

            Object.assign(tools, yandexTools)
            yield* Console.log(
              `✅ Registry: added ${Object.keys(yandexTools).length} YandexCalendar tool(s)`
            )
            break
          }
          default: {
            yield* Console.log(
              `ℹ️ Registry: no Effect implementation for integration ${integration.integrationType}`
            )
          }
        }
      }

      yield* Console.log(
        `✅ Registry: prepared ${Object.keys(tools).length} tool(s) for user ${numericUserId}`
      )

      return tools
    })

  return {
    getToolsForUser
  } satisfies IntegrationRegistry
})

export const IntegrationRegistryLive = Layer.effect(
  IntegrationRegistry,
  makeIntegrationRegistry
)
