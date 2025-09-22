import { Effect, Console } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";

const fxCache = new Map<string, FxSummary>();
const DEFAULT_BASE = "USD";
const DEFAULT_QUOTE = "RUB";

interface FxSummary {
  readonly summary: string;
}

interface FxSettings {
  readonly base?: string;
  readonly quote?: string;
}

const parseSettings = (
  settings: ModuleSettingEntry | undefined
): FxSettings => {
  if (!settings?.settings) {
    return {};
  }
  const value = settings.settings;
  return {
    base: typeof value.base === "string" ? value.base.toUpperCase() : undefined,
    quote: typeof value.quote === "string"
      ? value.quote.toUpperCase()
      : undefined,
  };
};

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const fetchFxRate = (base: string, quote: string) =>
  Effect.tryPromise(async () => {
    const cacheKey = `${base}-${quote}`;
    const cached = fxCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const latestResponse = await fetch(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`
    );

    if (!latestResponse.ok) {
      throw new Error(
        `FX latest request failed: ${latestResponse.status} ${latestResponse.statusText}`
      );
    }

    const latestPayload = (await latestResponse.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };

    if (latestPayload.result !== "success") {
      throw new Error(`FX API responded with result "${latestPayload.result}"`);
    }

    const rate = latestPayload.rates?.[quote];
    if (rate === undefined) {
      return null;
    }

    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    let changePct: number | undefined = undefined;

    const histResponse = await fetch(
      `https://open.er-api.com/v6/history/${encodeURIComponent(base)}/${encodeURIComponent(quote)}?start=${formatDate(thirtyDaysAgo)}&end=${formatDate(today)}`
    );

    if (histResponse.ok) {
      const histPayload = (await histResponse.json()) as {
        result?: string;
        rates?: Record<string, Record<string, number>>;
      };

      if (histPayload.result === "success" && histPayload.rates) {
        const keys = Object.keys(histPayload.rates).sort();
        const firstDay = histPayload.rates[keys[0]]?.[quote];
        if (firstDay && firstDay !== 0) {
          changePct = ((rate - firstDay) / firstDay) * 100;
        }
      }
    }

    const summary = formatFxSummary(base, quote, rate, changePct);
    const result: FxSummary = { summary };
    fxCache.set(cacheKey, result);
    return result;
  });

const formatFxSummary = (
  base: string,
  quote: string,
  rate: number,
  changePct: number | undefined
) => {
  const changeText =
    changePct !== undefined
      ? ` (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`
      : "";
  return `💱 ${base}/${quote} = ${rate.toFixed(2)}${changeText}`;
};

export const FxDigestModule: DigestModuleImpl = {
  id: "fx",
  fetch: (_context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) {
        return null;
      }

      const settings = parseSettings(entry);
      const base = settings.base ?? DEFAULT_BASE;
      const quote = settings.quote ?? DEFAULT_QUOTE;

      const fx = yield* fetchFxRate(base, quote).pipe(
        Effect.catchAll((error) =>
          Console.error("❌ FX fetch failed:", error).pipe(
            Effect.flatMap(() => Effect.succeed<FxSummary | null>(null))
          )
        )
      );

      if (!fx) {
        return "⚠️ Не удалось получить курс валют";
      }

      return fx.summary;
    }),
};
