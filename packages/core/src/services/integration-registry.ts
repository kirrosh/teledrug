import { Effect, Layer } from "effect";
import {
  InteractionType,
  IntegrationError,
  ToolResultFormatter,
  IntegrationRegistry,
  type DomainIntegrationTools,
  type DomainAgentType,
  type IntegrationToolsBundle,
} from "@teledrug/ai";
import type { IntegrationRegistry as IntegrationRegistryService } from "@teledrug/ai";
export type {
  DomainIntegrationTools,
  DomainAgentType,
  IntegrationToolsBundle,
} from "@teledrug/ai";
export { IntegrationRegistry } from "@teledrug/ai";
import {
  YandexCalendarIntegration,
  YandexCredentials,
} from "../integrations/yandex-calendar";
import { UserRepository } from "./user-repository";
import { createDigestTools } from "../digest/tools";
import { DigestSettingsRepository } from "./digest-settings";
import { createTaskTools } from "../tasks/tools";
import { createUserSettingsTools } from "../user/tools";
import { TaskRepository, TaskRepositoryLive } from "./task-repository";

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

const mergeBundles = (
  existing: IntegrationToolsBundle | undefined,
  incoming: IntegrationToolsBundle
): IntegrationToolsBundle => {
  if (!existing) {
    return {
      tools: { ...incoming.tools },
      formatters: { ...incoming.formatters },
      progressMessages: { ...incoming.progressMessages },
      ...(incoming.contextMessages
        ? { contextMessages: [...incoming.contextMessages] }
        : {}),
    };
  }

  return {
    tools: { ...existing.tools, ...incoming.tools },
    formatters: { ...existing.formatters, ...incoming.formatters },
    progressMessages: {
      ...existing.progressMessages,
      ...incoming.progressMessages,
    },
    ...(existing.contextMessages || incoming.contextMessages
      ? {
          contextMessages: [
            ...(existing.contextMessages ?? []),
            ...(incoming.contextMessages ?? []),
          ],
        }
      : {}),
  };
};

const makeIntegrationRegistry = Effect.gen(function* () {
  const userRepository = yield* UserRepository;
  const digestSettings = yield* DigestSettingsRepository;
  // TaskRepository is lightweight; we'll provide its live layer on demand

  yield* Effect.sync(() => console.log("🔧 Initializing Integration Registry..."));

  const prepareBundles = (
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

      yield* Effect.sync(() =>
        console.log(
          `🔧 Registry: loading tools for user ${numericUserId} (${interactionType})`
        )
      );

      const domainBundles: DomainIntegrationTools = {};

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

      domainBundles.digest = digestToolsBundle;

      const userSettings = yield* userRepository
        .getUserSettings(numericUserId)
        .pipe(
          Effect.map((settings) => ({
            timezone: settings.timezone ?? "UTC",
            locale: settings.locale ?? "ru-RU",
            city: settings.city ?? null,
            country: settings.country ?? null,
          })),
          Effect.catchAll((cause) =>
            Effect.sync(() => {
              console.warn(
                `⚠️ Registry: failed to load user settings for user ${numericUserId}, using defaults`,
                cause
              );
              return {
                timezone: "UTC",
                locale: "ru-RU",
                city: null,
                country: null,
              } as const;
            })
          )
        );

      const taskToolsBundle = yield* createTaskTools(numericUserId, {
        userSettings,
      }).pipe(
        Effect.provide(TaskRepositoryLive),
        Effect.mapError(
          (cause) =>
            new IntegrationError({
              message: "Failed to prepare task tools",
              cause,
            })
        )
      );

      domainBundles.tasks = taskToolsBundle;

      const settingsToolsBundle = yield* createUserSettingsTools(
        numericUserId,
        {
          snapshot: {
            timezone: userSettings.timezone,
            locale: userSettings.locale,
            city: userSettings.city ?? null,
            country: userSettings.country ?? null,
          },
        }
      ).pipe(
        Effect.provideService(DigestSettingsRepository, digestSettings),
        Effect.provideService(UserRepository, userRepository),
        Effect.mapError(
          (cause) =>
            new IntegrationError({
              message: "Failed to prepare user settings tools",
              cause,
            })
        )
      );

      domainBundles.settings = settingsToolsBundle;

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

      let calendarBundle: IntegrationToolsBundle | undefined;

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
            if (
              interactionType !== "TEXT" &&
              interactionType !== "VOICE" &&
              interactionType !== "IMAGE"
            ) {
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
              userTimezone: userSettings.timezone,
              userLocale: userSettings.locale,
            });

            calendarBundle = mergeBundles(calendarBundle, {
              tools: { ...yandexTools.tools },
              formatters: { ...yandexTools.formatters },
              progressMessages: {
                ...(yandexTools.progressMessages ?? {}),
              },
              ...(yandexTools.contextMessages
                ? { contextMessages: [...yandexTools.contextMessages] }
                : {}),
            });
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

      if (calendarBundle) {
        domainBundles.calendar = calendarBundle;
      }

      const nonEmptyDomainBundles = Object.fromEntries(
        Object.entries(domainBundles).filter(([, bundle]) =>
          bundle ? Object.keys(bundle.tools).length > 0 : false
        )
      ) as DomainIntegrationTools;

      const combined = Object.values(nonEmptyDomainBundles).reduce<
        IntegrationToolsBundle
      >(
        (acc, bundle) => mergeBundles(acc, bundle),
        {
          tools: {},
          formatters: {},
          progressMessages: {},
        }
      );

      yield* Effect.sync(() =>
        console.log(
          `✅ Registry: prepared ${
            Object.keys(combined.tools).length
          } tool(s) for user ${numericUserId}`
        )
      );

      return { combined, domains: nonEmptyDomainBundles } as const;
    });

  const getToolsForUser = (
    userId: string | number,
    interactionType: InteractionType
  ): Effect.Effect<IntegrationToolsBundle, IntegrationError> =>
    prepareBundles(userId, interactionType).pipe(
      Effect.map(({ combined }) => combined)
    );

  const getDomainToolsForUser = (
    userId: string | number,
    interactionType: InteractionType
  ): Effect.Effect<DomainIntegrationTools, IntegrationError> =>
    prepareBundles(userId, interactionType).pipe(
      Effect.map(({ domains }) => domains)
    );

  return {
    getToolsForUser,
    getDomainToolsForUser,
  } satisfies IntegrationRegistryService;
});

export const IntegrationRegistryLive = Layer.effect(
  IntegrationRegistry,
  makeIntegrationRegistry
);
