export interface ZonedDayBounds {
  readonly start: Date;
  readonly end: Date;
}

const DEFAULT_TIME_ZONE = "UTC";

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const datePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getOffsetFormatter = (timeZone: string) => {
  const key = timeZone;
  const cached = offsetFormatterCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  });
  offsetFormatterCache.set(key, formatter);
  return formatter;
};

const getDatePartsFormatter = (timeZone: string) => {
  const key = timeZone;
  const cached = datePartsFormatterCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  datePartsFormatterCache.set(key, formatter);
  return formatter;
};

const parseOffsetMinutes = (timeZoneName: string): number => {
  const match = timeZoneName.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!match) {
    return 0;
  }
  const hourComponent = match[1] ?? "0";
  const minuteComponent = match[2] ?? "0";
  const sign = hourComponent.startsWith("-") ? -1 : 1;
  const hours = Math.abs(Number.parseInt(hourComponent, 10)) || 0;
  const minutes = Number.parseInt(minuteComponent, 10) || 0;
  return sign * (hours * 60 + minutes);
};

export const isValidTimezone = (timeZone: string): boolean => {
  if (!timeZone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const normalizeTimezone = (timeZone: string | null | undefined): string => {
  if (!timeZone) {
    return DEFAULT_TIME_ZONE;
  }
  return isValidTimezone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
};

export const getTimezoneOffsetMinutes = (timeZone: string, date: Date): number => {
  const formatter = getOffsetFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const timeZoneName = parts.find((part) => part.type === "timeZoneName")?.value;
  if (!timeZoneName) {
    return 0;
  }
  return parseOffsetMinutes(timeZoneName);
};

const getDateParts = (
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} => {
  const formatter = getDatePartsFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes, fallback: number) =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "", 10) || fallback;

  return {
    year: lookup("year", date.getUTCFullYear()),
    month: lookup("month", date.getUTCMonth() + 1),
    day: lookup("day", date.getUTCDate()),
    hour: lookup("hour", date.getUTCHours()),
    minute: lookup("minute", date.getUTCMinutes()),
    second: lookup("second", date.getUTCSeconds()),
  };
};

const buildInstantFromParts = (
  timeZone: string,
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
    millisecond?: number;
  }
): Date => {
  const baseUtcMillis = Date.UTC(
    parts.year,
    (parts.month ?? 1) - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
    parts.millisecond ?? 0
  );
  const offsetMinutes = getTimezoneOffsetMinutes(timeZone, new Date(baseUtcMillis));
  return new Date(baseUtcMillis - offsetMinutes * 60_000);
};

export const getDayBoundsInTimezone = (
  date: Date,
  timeZoneInput: string
): ZonedDayBounds => {
  const timeZone = normalizeTimezone(timeZoneInput);
  const parts = getDateParts(date, timeZone);
  const start = buildInstantFromParts(timeZone, {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
};

export const formatInTimezone = (
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZoneInput: string
): string => {
  const timeZone = normalizeTimezone(timeZoneInput);
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    ...options,
  });
  return formatter.format(date);
};
