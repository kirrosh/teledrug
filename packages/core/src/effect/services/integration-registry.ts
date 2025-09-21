import { Effect, Context, Layer, Console } from "effect";
import { Tool as AITool } from "ai";
import {
  InteractionType,
  IntegrationError,
  ToolResultFormatter,
} from "../types/integrations";
import {
  YandexCalendarIntegration,
  YandexCredentials,
} from "../integrations/yandex-calendar";
import { UserRepository } from "./user-repository";
import { createDigestTools } from "../digest/tools";
import { DigestSettingsRepository } from "./digest-settings";

export interface IntegrationToolsBundle {
  readonly tools: Record<string, AITool>;
  readonly formatters: Record<string, ToolResultFormatter>;
  readonly progressMessages: Record<string, string>;
}

export interface IntegrationRegistry {
  readonly getToolsForUser: (
    userId: string | number,
    interactionType: InteractionType
  ) => Effect.Effect<IntegrationToolsBundle, IntegrationError>;
}

export const IntegrationRegistry = Context.GenericTag<IntegrationRegistry>(
  "@services/IntegrationRegistry"
);

const toNumericUserId = (userId: string | number) => {
  if (typeof userId === "number") {
    return userId;
  }

  const parsed = Number.parseInt(userId, 10);
  if (Number.isNaN(parsed)) {
    throw new IntegrationError({
      message: `Invalid user id received from context: ${userId}`,
    });
  }

  return parsed;
};

const makeIntegrationRegistry = Effect.gen(function* () {
  const userRepository = yield* UserRepository;
  const digestSettings = yield* DigestSettingsRepository;

  yield* Console.log("🔧 Initializing Integration Registry...");

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
            cause,
          }),
      });

      yield* Console.log(
        `🔧 Registry: loading tools for user ${numericUserId} (${interactionType})`
      );

      const digestToolsBundle = yield* createDigestTools(numericUserId).pipe(
        Effect.provideService(DigestSettingsRepository, digestSettings),
        Effect.mapError(
          (cause) =>
            new IntegrationError({
              message: "Failed to prepare digest tools",
              cause,
            })
        )
      );

      const integrations = yield* userRepository
        .getAllDecryptedIntegrations(numericUserId)
        .pipe(
          Effect.mapError(
            (cause) =>
              new IntegrationError({
                message: "Failed to fetch user integrations",
                cause,
              })
          )
        );

      const tools: Record<string, AITool> = { ...digestToolsBundle.tools };
      const formatters: Record<string, ToolResultFormatter> = {
        ...digestToolsBundle.formatters,
      };
      const progressMessages: Record<string, string> = {
        ...digestToolsBundle.progressMessages,
      };

      if (integrations.length === 0) {
        yield* Console.log(
          `📭 Registry: user ${numericUserId} has no external integrations`
        );
      }

      for (const { integration, credentials } of integrations) {
        if (!integration.enabled) {
          yield* Console.log(
            `⏭️ Registry: integration ${integration.integrationType} disabled for user ${numericUserId}`
          );
          continue;
        }

        switch (integration.integrationType) {
          case "YandexCalendar": {
            if (interactionType !== "TEXT" && interactionType !== "VOICE") {
              yield* Console.log(
                `⚖️ Registry: skipping YandexCalendar tools for unsupported interaction type ${interactionType}`
              );
              break;
            }

            const yandexTools = YandexCalendarIntegration.createTools({
              credentials: credentials as YandexCredentials,
              encryptedCredentials: {
                encrypted: integration.credentialsEncrypted,
                iv: integration.credentialsIv,
                tag: integration.credentialsTag,
              },
            });

            Object.assign(tools, yandexTools.tools);
            Object.assign(formatters, yandexTools.formatters);
            if (yandexTools.progressMessages) {
              Object.assign(progressMessages, yandexTools.progressMessages);
            }
            yield* Console.log(
              `✅ Registry: added ${
                Object.keys(yandexTools.tools).length
              } YandexCalendar tool(s)`
            );
            break;
          }
          default: {
            yield* Console.log(
              `ℹ️ Registry: no Effect implementation for integration ${integration.integrationType}`
            );
          }
        }
      }

      yield* Console.log(
        `✅ Registry: prepared ${
          Object.keys(tools).length
        } tool(s) for user ${numericUserId}`
      );

      return {
        tools,
        formatters,
        progressMessages,
      } satisfies IntegrationToolsBundle;
    });

  return {
    getToolsForUser,
  } satisfies IntegrationRegistry;
});

export const IntegrationRegistryLive = Layer.effect(
  IntegrationRegistry,
  makeIntegrationRegistry
);
