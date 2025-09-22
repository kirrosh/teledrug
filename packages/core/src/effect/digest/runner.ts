import { Effect } from "effect";
import type { DigestModuleImpl, DigestModuleResult } from "./types";
import { WeatherDigestModule, FxDigestModule, CalendarDigestModule } from "./modules";
import { DigestSettingsRepository } from "../services/digest-settings";

const MODULES: ReadonlyArray<DigestModuleImpl> = [
  WeatherDigestModule,
  FxDigestModule,
  CalendarDigestModule,
];

export const runDailyDigest = (
  userId: number,
  date: Date
): Effect.Effect<ReadonlyArray<DigestModuleResult>, never> =>
  Effect.gen(function* () {
    const settingsRepo = yield* DigestSettingsRepository;
    const moduleSettings = yield* settingsRepo.getSettingsByUser(userId);
    const settingsMap = new Map(
      moduleSettings.map((entry) => [entry.module, entry])
    );

    const results: DigestModuleResult[] = [];

    for (const module of MODULES) {
      const setting = settingsMap.get(module.id);
      const text = yield* module.fetch({ userId, date }, setting);

      if (text && text.trim().length > 0) {
        results.push({ id: module.id, text });
      }
    }

    return results;
  });
