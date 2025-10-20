import { Effect } from "effect";
import type { Context as TelegramContext } from "grammy";
import type { PhotoSize } from "grammy/types";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Headers from "@effect/platform/Headers";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const toError = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause : new Error(`${fallback}: ${String(cause)}`);

const stripCodeFences = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^[`]{3}[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  if (trimmed.startsWith("`")) {
    return trimmed.replace(/^`+/, "").replace(/`+$/, "").trim();
  }
  return trimmed;
};

export interface ImageAnalysisResult {
  readonly extractedText?: string;
  readonly description?: string;
  readonly contentType?: string;
  readonly size: number;
}

export type ImageAnalyzer = (
  ctx: TelegramContext,
  photo: PhotoSize
) => Effect.Effect<ImageAnalysisResult, Error, HttpClient.HttpClient>;

export const createImageAnalyzer =
  (telegramToken: string): ImageAnalyzer =>
  (ctx, photo) =>
    Effect.gen(function* () {
      const file = yield* Effect.tryPromise({
        try: () => ctx.api.getFile(photo.file_id),
        catch: (cause) => toError(cause, "Failed to fetch telegram file metadata"),
      });

      if (!file.file_path) {
        return yield* Effect.fail(new Error("File path is missing for Telegram file"));
      }

      const fileUrl = `https://api.telegram.org/file/bot${telegramToken}/${file.file_path}`;

      const response = yield* Effect.mapError(
        HttpClient.get(fileUrl),
        (cause) => toError(cause, "Failed to download telegram photo")
      );

      const okResponse = yield* Effect.mapError(
        HttpClientResponse.filterStatusOk(response),
        (cause) => toError(cause, "Telegram photo download returned an error status")
      );

      const arrayBuffer = yield* Effect.mapError(
        okResponse.arrayBuffer,
        (cause) => toError(cause, "Failed to read telegram photo body")
      );

      const imageBytes = new Uint8Array(arrayBuffer);
      const contentType = pipe(
        Headers.get(okResponse.headers, "content-type"),
        Option.getOrUndefined
      );
      const safeContentType = contentType ?? "image/jpeg";

      const base64 = Buffer.from(imageBytes).toString("base64");
      const dataUrl = `data:${safeContentType};base64,${base64}`;

      const analysis = yield* Effect.tryPromise({
        try: async () => {
          const model = openai("gpt-4o-mini");
          const result = await generateText({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Ты помощник TeleDrug. Извлеки читаемый текст с изображения и кратко опиши, что на нём изображено. Ответь строго в JSON формате {\"text\": string, \"description\": string}. Если текст отсутствует, верни пустую строку.",
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Извлеки текст и опиши изображение. Сохрани язык оригинала, если это возможно.",
                  },
                  {
                    type: "image",
                    image: dataUrl,
                  },
                ],
              },
            ],
          });

          return stripCodeFences(result.text);
        },
        catch: (cause) => toError(cause, "Failed to analyse image via OpenAI"),
      });

      let parsed: { text?: string; description?: string } = {};
      try {
        const value = JSON.parse(analysis);
        if (typeof value === "object" && value) {
          parsed = value as { text?: string; description?: string };
        }
      } catch (error) {
        return {
          size: imageBytes.length,
          contentType: safeContentType,
        } satisfies ImageAnalysisResult;
      }

      const extractedText = parsed.text?.trim();
      const description = parsed.description?.trim();

      return {
        extractedText: extractedText && extractedText.length > 0 ? extractedText : undefined,
        description: description && description.length > 0 ? description : undefined,
        contentType: safeContentType,
        size: imageBytes.length,
      } satisfies ImageAnalysisResult;
    });
