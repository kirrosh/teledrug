import { Effect, Context, Layer, Data } from "effect";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  energySchema,
  fallbackTitleFromContent,
  JournalAnalysisResult,
  moodSchema,
  sanitizeTitle,
} from "../journal/model";

const ANALYSIS_PROMPT = `Ты помощник, который анализирует дневниковые записи.\n\nТебе нужно определить настроение и уровень энергии автора по тексту записи.\nИспользуй только следующие значения настроения: very_negative, negative, neutral, positive, very_positive, mixed.\nИспользуй только следующие значения энергии: very_low, low, medium, high, very_high.\nТакже подбери короткий заголовок для записи — не более трёх слов. Заголовок должен быть на языке записи.\n\nОтветь строго JSON-объектом формата:\n{"title": string, "mood": string, "energy": string, "tags": string[]}\nГде "tags" — массив существительных или коротких фраз из текста, которые могут использоваться как теги (если сомневаешься — верни пустой массив).\nНикаких пояснений, markdown или дополнительного текста — только JSON.`;

const stripCodeFences = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^[`]{3}[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  if (trimmed.startsWith("`")) {
    return trimmed.replace(/^`+/, "").replace(/`+$/, "").trim();
  }
  return trimmed;
};

const parseJsonSafe = (text: string): unknown => {
  const stripped = stripCodeFences(text);
  return JSON.parse(stripped);
};

export class JournalAnalysisError extends Data.TaggedError("JournalAnalysisError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface JournalAnalysisService {
  readonly analyze: (
    input: { content: string }
  ) => Effect.Effect<JournalAnalysisResult, JournalAnalysisError>;
}

export const JournalAnalysisService = Context.GenericTag<JournalAnalysisService>(
  "@services/JournalAnalysisService"
);

const makeJournalAnalysisService = Effect.gen(function* () {
  const model = openai("gpt-5-nano");

  const analyze: JournalAnalysisService["analyze"] = ({ content }) =>
    Effect.gen(function* () {
      const fallbackTitle = fallbackTitleFromContent(content);

      const result = yield* Effect.tryPromise({
        try: async () =>
          generateText({
            model,
            messages: [
              { role: "system", content: ANALYSIS_PROMPT },
              { role: "user", content },
            ],
            temperature: 0.2,
          }),
        catch: (cause) =>
          new JournalAnalysisError({
            message: "Не удалось выполнить анализ записи",
            cause,
          }),
      });

      const parsed = yield* Effect.try({
        try: () => parseJsonSafe(result.text),
        catch: (cause) =>
          new JournalAnalysisError({
            message: "Не удалось разобрать ответ модели",
            cause,
          }),
      });

      if (typeof parsed !== "object" || parsed === null) {
        return yield* Effect.fail(
          new JournalAnalysisError({
            message: "Модель вернула неожиданный формат ответа",
          })
        );
      }

      const data = parsed as Record<string, unknown>;

      const rawMood = data.mood;
      const rawEnergy = data.energy;
      const rawTitle = typeof data.title === "string" ? data.title : fallbackTitle;
      const rawTags = Array.isArray(data.tags)
        ? data.tags.filter((value): value is string => typeof value === "string")
        : [];

      const mood = yield* moodSchema(rawMood).pipe(
        Effect.mapError(
          (cause) =>
            new JournalAnalysisError({
              message: "Получено неизвестное значение настроения",
              cause,
            })
        )
      );

      const energy = yield* energySchema(rawEnergy).pipe(
        Effect.mapError(
          (cause) =>
            new JournalAnalysisError({
              message: "Получено неизвестное значение уровня энергии",
              cause,
            })
        )
      );

      return {
        title: sanitizeTitle(rawTitle, fallbackTitle),
        mood,
        energy,
        tags: rawTags.slice(0, 5),
        aiMetadata: {
          raw: data,
          promptVersion: 1,
        },
      } satisfies JournalAnalysisResult;
    });

  return JournalAnalysisService.of({
    analyze,
  });
});

export const JournalAnalysisServiceLive = Layer.effect(
  JournalAnalysisService,
  makeJournalAnalysisService
);
