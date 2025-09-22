import { Effect, Console } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";

const geocodeCache = new Map<string, { latitude: number; longitude: number }>();
const weatherCache = new Map<string, WeatherSummary>();

interface WeatherSummary {
  readonly summary: string;
}

interface WeatherSettings {
  readonly location?: string;
  readonly units?: "metric" | "imperial";
}

const parseSettings = (
  settings: ModuleSettingEntry | undefined
): WeatherSettings => {
  if (!settings?.settings) {
    return {};
  }
  const value = settings.settings;
  return {
    location: typeof value.location === "string" ? value.location : undefined,
    units:
      value.units === "imperial" || value.units === "metric"
        ? value.units
        : "metric",
  };
};

const geocodeLocation = (location: string) =>
  Effect.tryPromise(async () => {
    const cached = geocodeCache.get(location.toLowerCase());
    if (cached) {
      return cached;
    }

    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        location
      )}&count=1&language=ru`
    );

    if (!response.ok) {
      throw new Error(`Geocoding request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      results?: Array<{ latitude: number; longitude: number }>;
    };

    const coordinates = payload.results?.[0];
    if (!coordinates) {
      throw new Error(`Location not found: ${location}`);
    }

    geocodeCache.set(location.toLowerCase(), coordinates);
    return coordinates;
  });

const fetchWeather = (
  latitude: number,
  longitude: number,
  units: "metric" | "imperial"
) =>
  Effect.tryPromise(async () => {
    const cacheKey = `${latitude}:${longitude}:${units}`;
    const cached = weatherCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "1",
      temperature_unit: units === "imperial" ? "fahrenheit" : "celsius",
    });

    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };

    const max = payload.daily?.temperature_2m_max?.[0];
    const min = payload.daily?.temperature_2m_min?.[0];
    const precipitation = payload.daily?.precipitation_probability_max?.[0];

    if (max === undefined || min === undefined) {
      throw new Error("Incomplete weather data");
    }

    const summary = formatWeatherSummary(max, min, precipitation, units);
    const result: WeatherSummary = { summary };
    weatherCache.set(cacheKey, result);
    return result;
  });

const formatWeatherSummary = (
  max: number,
  min: number,
  precipitation: number | undefined,
  units: "metric" | "imperial"
) => {
  const unitSymbol = units === "imperial" ? "°F" : "°C";
  const precipText =
    typeof precipitation === "number" ? `, осадки ${precipitation}%` : "";
  return `🌤️ Погода: максимум ${max}${unitSymbol}, минимум ${min}${unitSymbol}${precipText}`;
};

export const WeatherDigestModule: DigestModuleImpl = {
  id: "weather",
  fetch: (context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) {
        return null;
      }

      const settings = parseSettings(entry);
      const location = settings.location;

      if (!location) {
        return "⚠️ Укажите город для прогноза погоды";
      }

      const coords = yield* geocodeLocation(location).pipe(
        Effect.catchAll((error) =>
          Console.error("❌ Weather geocoding failed:", error).pipe(
            Effect.flatMap(() =>
              Effect.succeed<{
                latitude: number;
                longitude: number;
              } | null>(null)
            )
          )
        )
      );

      if (!coords) {
        return "⚠️ Не удалось определить координаты города";
      }

      const weather = yield* fetchWeather(
        coords.latitude,
        coords.longitude,
        settings.units ?? "metric"
      ).pipe(
        Effect.catchAll((error) =>
          Console.error("❌ Weather fetch failed:", error).pipe(
            Effect.flatMap(() => Effect.succeed<WeatherSummary | null>(null))
          )
        )
      );

      if (!weather) {
        return "⚠️ Не удалось получить прогноз погоды";
      }

      return weather.summary;
    }),
};
