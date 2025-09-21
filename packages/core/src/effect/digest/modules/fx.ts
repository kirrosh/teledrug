import { Effect, Console } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";

const fxCache = new Map<string, FxSummary>();

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
    quote: typeof value.quote === "string" ? value.quote.toUpperCase() : undefined,
  };
};

const fetchFxRate = (base: string, quote: string) =>
  Effect.tryPromise(async () => {
    const cacheKey = `${base}-${quote}`;
    const cached = fxCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const params = new URLSearchParams({ base, symbols: quote });
    const latestResponse = await fetch(
      `https://api.exchangerate.host/latest?${params.toString()}`
    );

    if (!latestResponse.ok) {
      throw new Error(`FX latest request failed: ${latestResponse.status}`);
    }

    const latestPayload = (await latestResponse.json()) as {
      rates?: Record<string, number>;
      date?: string;
    };

    const rate = latestPayload.rates?.[quote];
    if (rate === undefined) {
      return null;
    }

    const fluctuationResponse = await fetch(
      `https://api.exchangerate.host/fluctuation?${params.toString()}`
    );

    if (!fluctuationResponse.ok) {
      throw new Error(
        `FX fluctuation request failed: ${fluctuationResponse.status}`
      );
    }

    const fluctuationPayload = (await fluctuationResponse.json()) as {
      rates?: Record<string, { change_pct?: number }>;
    };

    const changePct =
      fluctuationPayload.rates?.[quote]?.change_pct ?? undefined;

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
      const base = settings.base ?? "USD";
      const quote = settings.quote ?? "RUB";

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
