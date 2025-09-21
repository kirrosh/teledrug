import { Effect, Layer, Context } from "effect";
import { db } from "../../storage/database/client";
import {
  digestModules,
  digestModuleSettings,
  type DigestModule,
} from "../../storage/database/schema";
import { and, eq } from "drizzle-orm";

export type DigestModuleId = "weather" | "fx" | "calendar";

export interface ModuleSettingEntry {
  readonly module: DigestModuleId;
  readonly enabled: boolean;
  readonly settings: Record<string, unknown> | null;
}

export interface DigestSettingsRepository {
  readonly getSettingsByUser: (
    userId: number
  ) => Effect.Effect<ReadonlyArray<ModuleSettingEntry>, never>;
  readonly ensureDefaultSettings: (
    userId: number
  ) => Effect.Effect<void, never>;
}

export const DigestSettingsRepository = Context.GenericTag<DigestSettingsRepository>(
  "@services/DigestSettingsRepository"
);

const DEFAULT_MODULES: ReadonlyArray<{
  readonly module: DigestModuleId;
  readonly description: string;
  readonly enabled: boolean;
  readonly settings: Record<string, unknown> | null;
}> = [
  {
    module: "weather",
    description: "Daily weather forecast",
    enabled: true,
    settings: { location: "Москва", units: "metric" },
  },
  {
    module: "fx",
    description: "Currency exchange rate",
    enabled: true,
    settings: { base: "USD", quote: "RUB" },
  },
  {
    module: "calendar",
    description: "Calendar events digest",
    enabled: true,
    settings: null,
  },
];

const makeRepository = Effect.gen(function* () {
  const loadModules = Effect.tryPromise(async () => {
    const rows = await db.select().from(digestModules);
    const map = new Map<DigestModuleId, DigestModule>();

    for (const row of rows) {
      map.set(row.module as DigestModuleId, row);
    }

    return map;
  });

  const ensureModulesExist = loadModules.pipe(
    Effect.flatMap((existing) =>
      Effect.forEach(
        DEFAULT_MODULES,
        (module) =>
          existing.has(module.module)
            ? Effect.void
            : Effect.tryPromise(async () => {
                await db.insert(digestModules).values({
                  module: module.module,
                  description: module.description,
                });
              }),
        { discard: true }
      )
    )
  );

  const getSettingsByUser = (userId: number) =>
    ensureModulesExist.pipe(
      Effect.flatMap(() =>
        Effect.tryPromise(async () => {
          const rows = await db
            .select()
            .from(digestModules)
            .leftJoin(
              digestModuleSettings,
              and(
                eq(digestModuleSettings.userId, userId),
                eq(digestModuleSettings.moduleId, digestModules.id)
              )
            );

          return rows.map((row) => ({
            module: row.digest_modules.module as DigestModuleId,
            enabled: row.digest_module_settings
              ? row.digest_module_settings.enabled
              : DEFAULT_MODULES.find((m) => m.module === row.digest_modules.module)
                  ?.enabled ?? true,
            settings: row.digest_module_settings
              ? (row.digest_module_settings.settings as Record<string, unknown> | null)
              : DEFAULT_MODULES.find((m) => m.module === row.digest_modules.module)
                  ?.settings ?? null,
          } satisfies ModuleSettingEntry));
        }).pipe(
          Effect.catchAll(() => Effect.succeed<ReadonlyArray<ModuleSettingEntry>>([]))
        )
      )
    );

  const ensureDefaultSettings = (userId: number) =>
    ensureModulesExist.pipe(
      Effect.flatMap(() =>
        Effect.tryPromise(async () => {
          const modules = await db.select().from(digestModules);

          for (const module of modules) {
            const defaults = DEFAULT_MODULES.find(
              (entry) => entry.module === module.module
            );
            if (!defaults) {
              continue;
            }

            await db
              .insert(digestModuleSettings)
              .values({
                userId,
                moduleId: module.id,
                enabled: defaults.enabled,
                settings: defaults.settings,
              })
              .onConflictDoNothing();
          }
        }).pipe(Effect.catchAll(() => Effect.void))
      )
    );

  return DigestSettingsRepository.of({
    getSettingsByUser,
    ensureDefaultSettings,
  });
});

export const DigestSettingsRepositoryLive = Layer.effect(
  DigestSettingsRepository,
  makeRepository
);

export { DEFAULT_MODULES };
