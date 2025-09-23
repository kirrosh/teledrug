import { Effect, Layer, Context } from "effect";
import { db } from "../../storage/database/client";
import {
  digestModules,
  digestModuleSettings,
  type DigestModule,
} from "../../storage/database/schema";
import { and, eq } from "drizzle-orm";

export type DigestModuleId = "weather" | "fx" | "calendar" | "tasks";

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
  readonly updateModuleSettings: (
    userId: number,
    module: DigestModuleId,
    update: {
      readonly enabled?: boolean;
      readonly settings?: Record<string, unknown> | null;
    }
  ) => Effect.Effect<void, never>;
  readonly setAllModulesEnabled: (
    userId: number,
    enabled: boolean
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
  {
    module: "tasks",
    description: "Tasks summary for today",
    enabled: true,
    settings: { limit: 3 },
  },
];

const DEFAULT_MODULES_MAP = new Map(
  DEFAULT_MODULES.map((entry) => [entry.module, entry])
);

type ModuleMap = Map<DigestModuleId, DigestModule>;
type SettingsRows = ReadonlyArray<
  {
    digest_modules: DigestModule;
    digest_module_settings: typeof digestModuleSettings.$inferSelect | null;
  }
>;

type UpdatePatch = {
  readonly enabled?: boolean;
  readonly settings?: Record<string, unknown> | null;
};

type MergeSettings = (
  current: Record<string, unknown> | null,
  patch: Record<string, unknown> | null | undefined
) => Record<string, unknown> | null;

type UpdateModuleFn = (
  userId: number,
  module: DigestModuleId,
  update: UpdatePatch
) => Effect.Effect<void, never>;

type SetAllFn = (
  userId: number,
  enabled: boolean
) => Effect.Effect<void, never>;

type GetSettingsFn = (
  userId: number
) => Effect.Effect<ReadonlyArray<ModuleSettingEntry>, never>;

type EnsureDefaultsFn = (
  userId: number
) => Effect.Effect<void, never>;

const makeRepository = Effect.gen(function* () {
  const loadModules = Effect.tryPromise(async () => {
    const rows = await db.select().from(digestModules);
    const map: ModuleMap = new Map();

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

  const getModuleMap: Effect.Effect<ModuleMap, never> = ensureModulesExist.pipe(
    Effect.flatMap(() => loadModules),
    Effect.catchAll(() => Effect.succeed(new Map()))
  );

  const fetchSettingsRows = (userId: number): Effect.Effect<SettingsRows, never> =>
    Effect.tryPromise(async () =>
      await db
        .select()
        .from(digestModules)
        .leftJoin(
          digestModuleSettings,
          and(
            eq(digestModuleSettings.userId, userId),
            eq(digestModuleSettings.moduleId, digestModules.id)
          )
        )
    ).pipe(Effect.catchAll(() => Effect.succeed<SettingsRows>([])));

const computeEntry = (
  row: SettingsRows[number],
  defaults: {
    readonly enabled: boolean;
    readonly settings: Record<string, unknown> | null;
  } | undefined
): ModuleSettingEntry => ({
    module: row.digest_modules.module as DigestModuleId,
    enabled: row.digest_module_settings?.enabled ?? defaults?.enabled ?? true,
    settings:
      (row.digest_module_settings
        ?.settings as Record<string, unknown> | null) ??
      defaults?.settings ??
      null,
  });

  const getSettingsByUser: GetSettingsFn = (userId) =>
    getModuleMap.pipe(
      Effect.flatMap((moduleMap) =>
        fetchSettingsRows(userId).pipe(
          Effect.map((rows) =>
            rows.map((row) =>
              computeEntry(
                row,
                DEFAULT_MODULES_MAP.get(row.digest_modules.module as DigestModuleId)
              )
            )
          )
        )
      )
    );

  const ensureDefaultSettings: EnsureDefaultsFn = (userId) =>
    getModuleMap.pipe(
      Effect.flatMap((modules) =>
        Effect.forEach(
          modules.values(),
          (module) => {
            const defaults = DEFAULT_MODULES_MAP.get(
              module.module as DigestModuleId
            );

            return defaults
              ? Effect.tryPromise(async () => {
                  await db
                    .insert(digestModuleSettings)
                    .values({
                      userId,
                      moduleId: module.id,
                      enabled: defaults.enabled,
                      settings: defaults.settings,
                    })
                    .onConflictDoNothing();
                }).pipe(Effect.catchAll(() => Effect.void))
              : Effect.void;
          },
          { discard: true }
        )
      )
    );

  const mergeSettings: MergeSettings = (current, patch) => {
    if (!patch) {
      return current ?? null;
    }
    const base = current ? { ...current } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) {
        delete base[key];
      } else {
        base[key] = value;
      }
    }
    return Object.keys(base).length > 0 ? base : null;
  };

  const updateModuleSettings: UpdateModuleFn = (userId, module, update) =>
    getModuleMap.pipe(
      Effect.flatMap((modules) => {
        const moduleRow = modules.get(module);
        if (!moduleRow) {
          return Effect.void;
        }

        const defaults = DEFAULT_MODULES_MAP.get(module);

        return Effect.gen(function* () {
          yield* ensureDefaultSettings(userId);

          const existingRows = yield* Effect.tryPromise(async () =>
            await db
              .select()
              .from(digestModuleSettings)
              .where(
                and(
                  eq(digestModuleSettings.userId, userId),
                  eq(digestModuleSettings.moduleId, moduleRow.id)
                )
              )
              .limit(1)
          ).pipe(Effect.catchAll(() => Effect.succeed([])));

          const existing = existingRows[0];

          const currentEnabled =
            existing?.enabled ?? defaults?.enabled ?? true;

          const currentSettings =
            (existing?.settings as Record<string, unknown> | null) ??
            (defaults?.settings ?? null);

          const nextEnabled = update.enabled ?? currentEnabled;

          const nextSettings = mergeSettings(currentSettings, update.settings);

          yield* Effect.tryPromise(async () => {
            await db
              .insert(digestModuleSettings)
              .values({
                userId,
                moduleId: moduleRow.id,
                enabled: nextEnabled,
                settings: nextSettings,
              })
              .onConflictDoUpdate({
                target: [
                  digestModuleSettings.userId,
                  digestModuleSettings.moduleId,
                ],
                set: {
                  enabled: nextEnabled,
                  settings: nextSettings,
                  updatedAt: new Date(),
                },
              });
          }).pipe(Effect.catchAll(() => Effect.void));
        });
      })
    );

  const setAllModulesEnabled: SetAllFn = (userId, enabled) =>
    getModuleMap.pipe(
      Effect.flatMap((modules) =>
        Effect.forEach(
          modules.keys(),
          (module) => updateModuleSettings(userId, module, { enabled }),
          { discard: true }
        )
      )
    );

  const repo: DigestSettingsRepository = {
    getSettingsByUser,
    ensureDefaultSettings,
    updateModuleSettings,
    setAllModulesEnabled,
  };

  return DigestSettingsRepository.of(repo);
});

export const DigestSettingsRepositoryLive = Layer.effect(
  DigestSettingsRepository,
  makeRepository
);

export { DEFAULT_MODULES };
