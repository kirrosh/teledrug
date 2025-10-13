import { Effect } from "effect";
import { tool } from "ai";
import type { CoreMessage } from "ai";
import { z } from "zod";
import { UserRepository } from "../services/user-repository";
import { DigestSettingsRepository } from "../services/digest-settings";
import { isValidTimezone } from "@teledrug/timezone";
import type { ToolResultFormatter } from "../types/integrations";
import type { UserSettings } from "../schemas/database";

const PreferencesPatchSchema = z
  .object({
    set: z.record(z.string().min(1), z.unknown()).optional(),
    unset: z.array(z.string().min(1)).optional(),
  })
  .refine((value) => value.set || value.unset, {
    message: "Нужно указать изменения в настройках предпочтений",
  });

const LocationSchema = z
  .object({
    city: z.string().min(1).optional(),
    country: z.string().min(1).optional(),
  })
  .refine((value) => value.city || value.country, {
    message: "Укажите город или страну для изменения локации",
  });

const UpdateUserSettingsSchema = z
  .object({
    summary: z.string().optional(),
    timezone: z.string().min(1).optional(),
    location: LocationSchema.optional(),
    locale: z.string().min(1).optional(),
    preferences: PreferencesPatchSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.timezone && !value.location && !value.locale && !value.preferences) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Нужно указать хотя бы одно изменение настроек",
      });
    }
  });

type UpdateUserSettingsInput = z.infer<typeof UpdateUserSettingsSchema>;

type PreferencesValue = Record<string, unknown> | null | undefined;

type UpdateUserSettingsSuccess = {
  success: true;
  updated: ReadonlyArray<string>;
  warnings: ReadonlyArray<string>;
  settings: {
    timezone: string;
    locale: string;
    city: string | null;
    country: string | null;
  };
};

type UpdateUserSettingsFailure = {
  success: false;
  error: string;
  warnings?: ReadonlyArray<string>;
};

type UpdateUserSettingsResult =
  | UpdateUserSettingsSuccess
  | UpdateUserSettingsFailure;

const timezoneAliases: ReadonlyArray<{
  readonly timezone: string;
  readonly keywords: ReadonlyArray<string>;
  readonly label?: string;
}> = [
  { timezone: "Europe/Moscow", keywords: ["моск"] },
  { timezone: "Europe/Moscow", keywords: ["мск"] },
  { timezone: "Europe/Moscow", keywords: ["нижн", "новгор"] },
  { timezone: "Europe/Moscow", keywords: ["санкт", "петер"] },
  { timezone: "Europe/Moscow", keywords: ["питер"] },
  { timezone: "Europe/Samara", keywords: ["самар"] },
  { timezone: "Europe/Kaliningrad", keywords: ["калининг"] },
  { timezone: "Europe/Volgograd", keywords: ["волгоград"] },
  { timezone: "Europe/Saratov", keywords: ["саратов"] },
  { timezone: "Asia/Yekaterinburg", keywords: ["екатерин"] },
  { timezone: "Asia/Yekaterinburg", keywords: ["уральск"] },
  { timezone: "Asia/Omsk", keywords: ["омск"] },
  { timezone: "Asia/Novosibirsk", keywords: ["новосиб"] },
  { timezone: "Asia/Krasnoyarsk", keywords: ["краснояр"] },
  { timezone: "Asia/Irkutsk", keywords: ["иркут"] },
  { timezone: "Asia/Yakutsk", keywords: ["якут"] },
  { timezone: "Asia/Vladivostok", keywords: ["владивост"] },
  { timezone: "Asia/Magadan", keywords: ["магадан"] },
  { timezone: "Asia/Kamchatka", keywords: ["камчат"] },
  { timezone: "Asia/Sakhalin", keywords: ["сахалин"] },
];

const cityAliases: ReadonlyArray<{
  readonly keywords: ReadonlyArray<string>;
  readonly city: string;
  readonly timezone: string;
}> = [
  { keywords: ["моск"], city: "Москва", timezone: "Europe/Moscow" },
  {
    keywords: ["нижн", "новгор"],
    city: "Нижний Новгород",
    timezone: "Europe/Moscow",
  },
  {
    keywords: ["санкт", "петер"],
    city: "Санкт-Петербург",
    timezone: "Europe/Moscow",
  },
  { keywords: ["питер"], city: "Санкт-Петербург", timezone: "Europe/Moscow" },
  { keywords: ["самар"], city: "Самара", timezone: "Europe/Samara" },
  { keywords: ["екатерин"], city: "Екатеринбург", timezone: "Asia/Yekaterinburg" },
  { keywords: ["новосиб"], city: "Новосибирск", timezone: "Asia/Novosibirsk" },
  { keywords: ["казан"], city: "Казань", timezone: "Europe/Moscow" },
  { keywords: ["краснояр"], city: "Красноярск", timezone: "Asia/Krasnoyarsk" },
  { keywords: ["иркут"], city: "Иркутск", timezone: "Asia/Irkutsk" },
  { keywords: ["якут"], city: "Якутск", timezone: "Asia/Yakutsk" },
  {
    keywords: ["владивост"],
    city: "Владивосток",
    timezone: "Asia/Vladivostok",
  },
  { keywords: ["калининг"], city: "Калининград", timezone: "Europe/Kaliningrad" },
  { keywords: ["сочи"], city: "Сочи", timezone: "Europe/Moscow" },
];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9+\-\/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toTitleCase = (value: string): string =>
  value
    .split(/([\s-]+)/)
    .map((part) =>
      /[a-zа-я]/i.test(part)
        ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        : part
    )
    .join("");

const resolveTimezone = (
  raw: string
): { ok: true; timezone: string; label: string } | { ok: false; reason: string } => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Часовой пояс не указан" };
  }

  if (isValidTimezone(trimmed)) {
    return { ok: true, timezone: trimmed, label: trimmed };
  }

  const normalized = normalizeText(trimmed);

  for (const alias of timezoneAliases) {
    if (alias.keywords.every((keyword) => normalized.includes(keyword))) {
      if (isValidTimezone(alias.timezone)) {
        return {
          ok: true,
          timezone: alias.timezone,
          label: alias.label ?? alias.timezone,
        };
      }
    }
  }

  const offsetMatch = normalized.match(/(?:utc|gmt)?\s*([+-]\d{1,2})/);
  if (offsetMatch) {
    const offsetRaw = offsetMatch[1];
    if (!offsetRaw) {
      return {
        ok: false,
        reason: `Не удалось распознать часовой пояс «${trimmed}»`,
      };
    }
    const offset = Number.parseInt(offsetRaw, 10);
    if (!Number.isNaN(offset) && offset >= -12 && offset <= 14) {
      const timezone = `Etc/GMT${offset > 0 ? `-${offset}` : `+${Math.abs(offset)}`}`;
      if (isValidTimezone(timezone)) {
        const label = `UTC${offset >= 0 ? "+" : ""}${offset}`;
        return { ok: true, timezone, label };
      }
    }
  }

  return {
    ok: false,
    reason: `Не удалось распознать часовой пояс «${trimmed}»`,
  };
};

const resolveCity = (
  raw: string
): { city: string; timezone?: string } => {
  const normalized = normalizeText(raw);
  for (const alias of cityAliases) {
    if (alias.keywords.every((keyword) => normalized.includes(keyword))) {
      return { city: alias.city, timezone: alias.timezone };
    }
  }
  return { city: toTitleCase(raw.trim()) || raw.trim() };
};

const mergePreferences = (
  current: PreferencesValue,
  patch: UpdateUserSettingsInput["preferences"] | undefined
): { next: Record<string, unknown> | null; changed: boolean } => {
  if (!patch) {
    return { next: current && typeof current === "object" ? { ...current } : null, changed: false };
  }

  const base: Record<string, unknown> = current && typeof current === "object"
    ? { ...current }
    : {};
  let changed = false;

  if (patch.set) {
    for (const [key, value] of Object.entries(patch.set)) {
      if (base[key] !== value) {
        base[key] = value;
        changed = true;
      }
    }
  }

  if (patch.unset) {
    for (const key of patch.unset) {
      if (key in base) {
        delete base[key];
        changed = true;
      }
    }
  }

  return {
    next: Object.keys(base).length > 0 ? base : null,
    changed,
  };
};

const formatUpdateUserSettingsResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") {
      return {
        text: "❌ Не удалось обновить настройки пользователя.",
      };
    }

    const result = output as UpdateUserSettingsResult;

    if (!result.success) {
      const warningLines = result.warnings && result.warnings.length > 0
        ? `\n${result.warnings.map((warning) => `• ${warning}`).join("\n")}`
        : "";
      return {
        text: `❌ ${result.error}${warningLines}`,
      };
    }

    const lines: string[] = ["✅ Настройки обновлены."];

    if (result.updated.length > 0) {
      lines.push(
        "Изменения:",
        ...result.updated.map((item) => `• ${item}`)
      );
    }

    lines.push(
      "Текущие значения:",
      `• Часовой пояс: ${result.settings.timezone}`,
      `• Локаль: ${result.settings.locale}`,
      `• Город: ${result.settings.city ?? "не указан"}`,
      `• Страна: ${result.settings.country ?? "не указана"}`
    );

    return {
      text: lines.join("\n"),
    };
  });

const createContextMessages = (settings: {
  timezone: string;
  locale: string;
  city: string | null;
  country: string | null;
}): ReadonlyArray<CoreMessage> => [
  {
    role: "system",
    content: [
      "Текущие пользовательские настройки:",
      `- Часовой пояс: ${settings.timezone}.`,
      `- Локаль: ${settings.locale}.`,
      `- Город: ${settings.city ?? "не указан"}.`,
      `- Страна: ${settings.country ?? "не указана"}.`,
      "Если меняешь город, не забудь обновить погодный модуль и подбери подходящий часовой пояс.",
      "Смена языка пока не поддерживается — предупреждай пользователя, если он об этом просит.",
    ].join("\n"),
  },
];

export interface UserSettingsToolOptions {
  readonly snapshot?: {
    readonly timezone: string;
    readonly locale: string;
    readonly city: string | null;
    readonly country: string | null;
  };
}

export const createUserSettingsTools = (
  userId: number,
  options: UserSettingsToolOptions = {}
) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepository;
    const digestRepo = yield* DigestSettingsRepository;

    const snapshot = options.snapshot ?? {
      timezone: "UTC",
      locale: "ru-RU",
      city: null,
      country: null,
    };

    const handleUpdate = (input: UpdateUserSettingsInput) =>
      Effect.gen(function* () {
        const current = yield* userRepo.getUserSettings(userId);

        const updatedLabels: string[] = [];
        const warnings: string[] = [];
        const patch: Partial<{
          timezone: string;
          locale: string;
          city: string | null;
          country: string | null;
          preferences: Record<string, unknown> | null;
        }> = {};

        let nextTimezoneLabel: string | undefined;
        let timezoneChanged = false;

        if (input.locale) {
          warnings.push("Смена языка пока не поддерживается — оставил прежнее значение.");
        }

        if (input.timezone) {
          const resolved = resolveTimezone(input.timezone);
          if (resolved.ok) {
            if (current.timezone !== resolved.timezone) {
              patch.timezone = resolved.timezone;
              nextTimezoneLabel = resolved.label;
              timezoneChanged = true;
              updatedLabels.push(`Часовой пояс → ${resolved.label}`);
            }
          } else {
            warnings.push(resolved.reason);
          }
        }

        let digestWeatherCity: string | undefined;

        if (input.location) {
          if (input.location.city) {
            const resolvedCity = resolveCity(input.location.city);
            if (current.city !== resolvedCity.city) {
              patch.city = resolvedCity.city;
              updatedLabels.push(`Город → ${resolvedCity.city}`);
              digestWeatherCity = resolvedCity.city;
            }

            if (!timezoneChanged && resolvedCity.timezone) {
              if (current.timezone !== resolvedCity.timezone) {
                patch.timezone = resolvedCity.timezone;
                nextTimezoneLabel = resolvedCity.timezone;
                timezoneChanged = true;
                updatedLabels.push(
                  `Часовой пояс → ${resolvedCity.timezone} (подобран по локации)`
                );
              }
            }
          }

          if (input.location.country) {
            const cleanedCountry = toTitleCase(input.location.country);
            if ((current.country ?? null) !== cleanedCountry) {
              patch.country = cleanedCountry;
              updatedLabels.push(`Страна → ${cleanedCountry}`);
            }
          }
        }

        const preferencesMerge = mergePreferences(
          current.preferences as PreferencesValue,
          input.preferences
        );

        if (preferencesMerge.changed) {
          patch.preferences = preferencesMerge.next;
          updatedLabels.push("Предпочтения обновлены");
        }

        if (Object.keys(patch).length === 0 && !digestWeatherCity) {
          if (warnings.length > 0) {
            return {
              success: false,
              error: "Настройки не изменены",
              warnings,
            } satisfies UpdateUserSettingsResult;
          }

          return {
            success: false,
            error: "Не удалось применить изменения — данные совпадают с текущими",
          } satisfies UpdateUserSettingsResult;
        }

        const nextSettings: UserSettings =
          Object.keys(patch).length > 0
            ? yield* userRepo.updateUserSettings(userId, patch)
            : current;

        if (digestWeatherCity) {
          yield* digestRepo
            .updateModuleSettings(userId, "weather", {
              settings: { location: digestWeatherCity },
            })
            .pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  console.warn(
                    "⚠️ Не удалось обновить модуль погоды для пользователя",
                    userId,
                    error
                  );
                })
              )
            );
        }

        const appliedTimezone =
          nextTimezoneLabel ?? patch.timezone ?? nextSettings.timezone;
        if (nextTimezoneLabel && !updatedLabels.some((label) => label.includes("Часовой пояс"))) {
          updatedLabels.push(`Часовой пояс → ${appliedTimezone}`);
        }

        return {
          success: true,
          updated: updatedLabels,
          warnings,
          settings: {
            timezone: appliedTimezone ?? nextSettings.timezone,
            locale: nextSettings.locale,
            city: nextSettings.city ?? null,
            country: nextSettings.country ?? null,
          },
        } satisfies UpdateUserSettingsResult;
      });

    const updateTool = tool({
      description:
        "Обновляет личные настройки пользователя: город, страну, часовой пояс и предпочтения.",
      inputSchema: UpdateUserSettingsSchema,
      execute: async (rawInput) => {
        let input: UpdateUserSettingsInput;
        try {
          input = UpdateUserSettingsSchema.parse(rawInput);
        } catch (error) {
          console.error("❌ Некорректный формат данных для обновления настроек:", error);
          return {
            success: false,
            error: "Не удалось разобрать запрос на изменение настроек",
          } satisfies UpdateUserSettingsResult;
        }

        const effect = handleUpdate(input).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error("❌ Не удалось обновить настройки пользователя:", error);
              return {
                success: false,
                error: "Не удалось обновить настройки пользователя",
              } satisfies UpdateUserSettingsResult;
            })
          )
        );

        return await Effect.runPromise(effect);
      },
    });

    return {
      tools: {
        updateUserSettings: updateTool,
      },
      formatters: {
        updateUserSettings: formatUpdateUserSettingsResult,
      },
      progressMessages: {
        updateUserSettings: "Обновляю настройки пользователя...",
      },
      contextMessages: createContextMessages(snapshot),
    } as const;
  });
