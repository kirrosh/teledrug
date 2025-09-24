import { Effect, Context, Layer } from "effect";
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
import { createJournalTools } from "../journal/tools";
import { JournalAnalysisService } from "./journal-analysis";
import { JournalRepository } from "./journal-repository";
import { createTaskTools } from "../tasks/tools";
import { TaskRepository, TaskRepositoryLive } from "./task-repository";

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
  const journalAnalysis = yield* JournalAnalysisService;
  const journalRepository = yield* JournalRepository;
  // TaskRepository is lightweight; we'll provide its live layer on demand

  yield* Effect.sync(() => console.log("🔧 Initializing Integration Registry..."));

  const getToolsForUser = (
    userId: string | number,
    interactionType: InteractionType
  ): Effect.Effect<IntegrationToolsBundle, IntegrationError> =>
    Effect.gen(function* () {
      const numericUserId = yield* Effect.try({
        try: () => toNumericUserId(userId),
        catch: (cause) =>
          new IntegrationError({
            message: "Failed to normalise user identifier",
            cause,
          }),
      });

      yield* Effect.sync(() =>
        console.log(
          `🔧 Registry: loading tools for user ${numericUserId} (${interactionType})`
        )
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

      const journalToolsBundle = yield* createJournalTools(numericUserId).pipe(
        Effect.provideService(JournalAnalysisService, journalAnalysis),
        Effect.provideService(JournalRepository, journalRepository),
        Effect.provide(TaskRepositoryLive),
        Effect.mapError(
          (cause) =>
            new IntegrationError({
              message: "Failed to prepare journal tools",
              cause,
            })
        )
      );

      const taskToolsBundle = yield* createTaskTools(numericUserId).pipe(
        Effect.provide(TaskRepositoryLive),
        Effect.mapError(
          (cause) =>
            new IntegrationError({
              message: "Failed to prepare task tools",
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

      const tools: Record<string, AITool> = {
        ...digestToolsBundle.tools,
        ...journalToolsBundle.tools,
        ...taskToolsBundle.tools,
      };
      const formatters: Record<string, ToolResultFormatter> = {
        ...digestToolsBundle.formatters,
        ...journalToolsBundle.formatters,
        ...taskToolsBundle.formatters,
      };
      const progressMessages: Record<string, string> = {
        ...digestToolsBundle.progressMessages,
        ...journalToolsBundle.progressMessages,
        ...taskToolsBundle.progressMessages,
      };

      if (integrations.length === 0) {
        yield* Effect.sync(() =>
          console.log(
            `📭 Registry: user ${numericUserId} has no external integrations`
          )
        );
      }

      for (const { integration, credentials } of integrations) {
        if (!integration.enabled) {
          yield* Effect.sync(() =>
            console.log(
              `⏭️ Registry: integration ${integration.integrationType} disabled for user ${numericUserId}`
            )
          );
          continue;
        }

        switch (integration.integrationType) {
          case "YandexCalendar": {
            if (interactionType !== "TEXT" && interactionType !== "VOICE") {
              yield* Effect.sync(() =>
                console.log(
                  `⚖️ Registry: skipping YandexCalendar tools for unsupported interaction type ${interactionType}`
                )
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
            yield* Effect.sync(() =>
              console.log(
                `✅ Registry: added ${
                  Object.keys(yandexTools.tools).length
                } YandexCalendar tool(s)`
              )
            );
            break;
          }
          default: {
            yield* Effect.sync(() =>
              console.log(
                `ℹ️ Registry: no Effect implementation for integration ${integration.integrationType}`
              )
            );
          }
        }
      }

      yield* Effect.sync(() =>
        console.log(
          `✅ Registry: prepared ${
            Object.keys(tools).length
          } tool(s) for user ${numericUserId}`
        )
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
