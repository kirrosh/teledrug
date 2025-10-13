import { Schema } from "effect";
import {
  JournalEnergySchema,
  JournalMoodSchema,
  type JournalEnergy as JournalEnergyType,
  type JournalMood as JournalMoodType,
} from "../schemas/database";

export const JournalMood = JournalMoodSchema;
export const JournalEnergy = JournalEnergySchema;

export type Mood = JournalMoodType;
export type Energy = JournalEnergyType;

export const moodEmojiMap: Record<Mood, string> = {
  very_negative: "😞",
  negative: "🙁",
  neutral: "😐",
  positive: "🙂",
  very_positive: "🤩",
  mixed: "🤔",
};

export const energyEmojiMap: Record<Energy, string> = {
  very_low: "😴",
  low: "🥱",
  medium: "😌",
  high: "⚡️",
  very_high: "🚀",
};

export interface JournalAnalysisResult {
  readonly title: string;
  readonly mood: Mood;
  readonly energy: Energy;
  readonly tags: ReadonlyArray<string>;
  readonly aiMetadata?: Record<string, unknown>;
}

export const sanitizeTitle = (title: string, fallback: string): string => {
  const cleaned = title
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return fallback;
  }

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length <= 3) {
    return words.join(" ");
  }

  return words.slice(0, 3).join(" ");
};

export const fallbackTitleFromContent = (content: string): string => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Без названия";
  }
  const words = normalized.split(" ").filter(Boolean);
  return words.slice(0, 3).join(" ") || "Без названия";
};

export const moodSchema = Schema.decodeUnknown(JournalMoodSchema);
export const energySchema = Schema.decodeUnknown(JournalEnergySchema);
