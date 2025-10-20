import { Effect } from "effect";
import {
  WeatherDigestModule,
  FxDigestModule,
  CalendarDigestModule,
  TasksDigestModule,
  ScheduleDigestModule,
} from "./modules";
import { DigestSettingsRepository } from "../services/digest-settings";
import { TaskRepository } from "../services/task-repository";
import { UserRepository } from "../services/user-repository";
import {
  DigestModuleContext,
  type DigestModuleImpl,
  type DigestModuleResult,
  type DigestUserSettingsSnapshot,
} from "./types";
import { normalizeTimezone } from "@teledrug/timezone";

const MODULES: ReadonlyArray<DigestModuleImpl<any>> = [
  WeatherDigestModule,
  FxDigestModule,
  ScheduleDigestModule, // Объединенный модуль задач и событий
  // CalendarDigestModule, // Заменен на ScheduleDigestModule
  // TasksDigestModule,    // Заменен на ScheduleDigestModule
];

const DEFAULT_SETTINGS: DigestUserSettingsSnapshot = {
  timezone: "UTC",
  locale: "ru-RU",
  city: null,
  country: null,
};

const toDigestUserSettings = (
  input:
    | {
        readonly timezone?: string | null;
        readonly locale?: string | null;
        readonly city?: string | null;
        readonly country?: string | null;
      }
    | null
    | undefined
): DigestUserSettingsSnapshot => ({
  timezone: normalizeTimezone(input?.timezone ?? undefined),
  locale: input?.locale?.trim() && input.locale.trim().length > 0 ? input.locale.trim() : "ru-RU",
  city: input?.city ?? null,
  country: input?.country ?? null,
});

interface RunDailyDigestOptions {
  readonly userSettings?: DigestUserSettingsSnapshot;
}

export const runDailyDigest = (
  userId: number,
  date: Date,
  options: RunDailyDigestOptions = {}
): Effect.Effect<
  ReadonlyArray<DigestModuleResult>,
  never,
  typeof DigestSettingsRepository | typeof TaskRepository | typeof UserRepository
> =>
  Effect.gen(function* () {
    const settingsRepo = yield* DigestSettingsRepository;
    const userRepo = yield* UserRepository;
    const moduleSettings = yield* settingsRepo.getSettingsByUser(userId);
    const settingsMap = new Map(
      moduleSettings.map((entry) => [entry.module, entry])
    );

    const userSettings =
      options.userSettings ??
      (yield* userRepo
        .getUserSettings(userId)
        .pipe(
          Effect.map((settings) => toDigestUserSettings(settings)),
          Effect.catchAll(() => Effect.succeed(DEFAULT_SETTINGS))
        ));

    const results: DigestModuleResult[] = [];

    const context: DigestModuleContext = {
      userId,
      date,
      userSettings,
    };

    for (const module of MODULES) {
      const setting = settingsMap.get(module.id);
      const text = yield* module.fetch(context, setting);

      if (text && text.trim().length > 0) {
        results.push({ id: module.id, text });
      }
    }

    return results;
  });
