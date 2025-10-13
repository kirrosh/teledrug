import { describe, it, expect } from "bun:test";
import {
  formatInTimezone,
  getDayBoundsInTimezone,
  getTimezoneOffsetMinutes,
  isValidTimezone,
  normalizeTimezone,
} from "../src";

describe("@teledrug/timezone", () => {
  describe("isValidTimezone", () => {
    it("recognises IANA timezones", () => {
      expect(isValidTimezone("Europe/Moscow")).toBe(true);
      expect(isValidTimezone("America/New_York")).toBe(true);
    });

    it("rejects invalid identifiers", () => {
      expect(isValidTimezone("Mars/OlympusMons")).toBe(false);
      expect(isValidTimezone("")).toBe(false);
    });
  });

  describe("normalizeTimezone", () => {
    it("returns the timezone when valid", () => {
      expect(normalizeTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
    });

    it("falls back to UTC when timezone is missing or invalid", () => {
      expect(normalizeTimezone(undefined)).toBe("UTC");
      expect(normalizeTimezone(null)).toBe("UTC");
      expect(normalizeTimezone("Not/AZone")).toBe("UTC");
    });
  });

  describe("getTimezoneOffsetMinutes", () => {
    it("computes offset for winter dates", () => {
      const date = new Date("2024-01-01T00:00:00Z");
      expect(getTimezoneOffsetMinutes("Europe/Moscow", date)).toBe(180);
      expect(getTimezoneOffsetMinutes("America/New_York", date)).toBe(-300);
    });

    it("computes offset for summer dates (DST aware zones)", () => {
      const date = new Date("2024-07-01T00:00:00Z");
      expect(getTimezoneOffsetMinutes("America/New_York", date)).toBe(-240);
    });
  });

  describe("getDayBoundsInTimezone", () => {
    it("returns UTC bounds that match local midnight for given timezone", () => {
      const date = new Date("2024-06-15T12:34:56Z");
      const bounds = getDayBoundsInTimezone(date, "Asia/Tokyo");

      expect(bounds.start.toISOString()).toBe("2024-06-14T15:00:00.000Z");
      expect(bounds.end.toISOString()).toBe("2024-06-15T14:59:59.999Z");
    });

    it("defaults to UTC when timezone is invalid", () => {
      const date = new Date("2024-03-10T05:00:00Z");
      const bounds = getDayBoundsInTimezone(date, "Invalid/Zone");

      expect(bounds.start.toISOString()).toBe("2024-03-10T00:00:00.000Z");
      expect(bounds.end.toISOString()).toBe("2024-03-10T23:59:59.999Z");
    });
  });

  describe("formatInTimezone", () => {
    it("formats date in requested locale and timezone", () => {
      const date = new Date("2024-12-31T18:45:00Z");
      const formatted = formatInTimezone(
        date,
        "ru-RU",
        { hour: "2-digit", minute: "2-digit" },
        "Europe/Moscow"
      );

      expect(formatted).toBe("21:45");
    });
  });
});
