import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";
import { DigestSettingsRepository } from "../services/digest-settings";

const UpdateDigestSettingsSchema = z.object({
  action: z.enum([
    "toggle_digest",
    "toggle_module",
    "update_weather",
    "update_fx",
  ]),
  module: z.enum(["weather", "fx", "calendar", "tasks"]).optional(),
  enabled: z.boolean().optional(),
  weather: z
    .object({
      location: z.string().min(1).optional(),
      units: z.enum(["metric", "imperial"]).optional(),
    })
    .optional(),
  fx: z
    .object({
      base: z.string().optional(),
      quote: z.string().optional(),
    })
    .optional(),
});

type UpdateDigestSettingsInput = z.infer<typeof UpdateDigestSettingsSchema>;

const normalizeCurrency = (value: string | undefined) =>
  value ? value.trim().toUpperCase() : undefined;

export const createDigestTools = (userId: number) =>
  Effect.gen(function* () {
    const repo = yield* DigestSettingsRepository;

    const handleAction = (input: UpdateDigestSettingsInput) =>
      Effect.gen(function* () {
        yield* repo.ensureDefaultSettings(userId);

        switch (input.action) {
          case "toggle_digest": {
            if (typeof input.enabled !== "boolean") {
              return "⚠️ Уточните включить или выключить дайджест";
            }

            yield* repo.setAllModulesEnabled(userId, input.enabled);
            return input.enabled
              ? "✅ Дайджест включен"
              : "⛔️ Дайджест выключен";
          }

          case "toggle_module": {
            if (!input.module) {
              return "⚠️ Уточните, какой модуль нужно изменить";
            }
            if (typeof input.enabled !== "boolean") {
              return "⚠️ Уточните, включить или выключить модуль";
            }
            yield* repo.updateModuleSettings(userId, input.module, {
              enabled: input.enabled,
            });
            return input.enabled
              ? `✅ Модуль ${input.module} включен`
              : `⛔️ Модуль ${input.module} отключен`;
          }

          case "update_weather": {
            const weather = input.weather;
            if (!weather || (!weather.location && !weather.units)) {
              return "⚠️ Уточните новую локацию или единицы измерения для погоды";
            }
            const settings: Record<string, unknown> = {};
            if (weather.location) {
              settings.location = weather.location.trim();
            }
            if (weather.units) {
              settings.units = weather.units;
            }
            yield* repo.updateModuleSettings(userId, "weather", {
              settings,
            });
            return "✅ Настройки погоды обновлены";
          }

          case "update_fx": {
            const fx = input.fx;
            if (!fx || (!fx.base && !fx.quote)) {
              return "⚠️ Уточните базовую или котируемую валюту";
            }
            const settings: Record<string, unknown> = {};
            if (fx.base) {
              settings.base = normalizeCurrency(fx.base);
            }
            if (fx.quote) {
              settings.quote = normalizeCurrency(fx.quote);
            }
            yield* repo.updateModuleSettings(userId, "fx", {
              settings,
            });
            return "✅ Настройки валют обновлены";
          }
        }
      });

    const updateTool = tool({
      description:
        "Обновляет настройки утреннего дайджеста: погода, валюты, календарь",
      inputSchema: UpdateDigestSettingsSchema,
      execute: async (input) => {
        const message = await Effect.runPromise(
          handleAction(input).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.error("❌ Digest settings update failed:", error);
                return "⚠️ Не удалось обновить настройки";
              })
            )
          )
        );

        return { message };
      },
    });

    return {
      tools: {
        updateDigestSettings: updateTool,
      },
      formatters: {},
      progressMessages: {
        updateDigestSettings: "Обновляю настройки дайджеста...",
      },
    } as const;
  });
