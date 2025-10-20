import { Effect } from "effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import type { Context as TelegramContext } from "grammy";
import { experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as Headers from "@effect/platform/Headers";
import { getTranscriptionModel } from "../../config/ai-models";

const toError = (cause: unknown, fallback: string) =>
  cause instanceof Error
    ? cause
    : new Error(`${fallback}: ${String(cause)}`);

export interface TranscribedAudio {
  readonly text: string;
  readonly language: string | undefined;
  readonly durationInSeconds: number | undefined;
  readonly filePath: string;
  readonly size: number;
  readonly contentType?: string;
}

export type AudioTranscriber = (
  ctx: TelegramContext,
  fileId: string
) => Effect.Effect<TranscribedAudio, Error, HttpClient.HttpClient>;

export const createAudioTranscriber = (telegramToken: string): AudioTranscriber =>
  (ctx, fileId) =>
    Effect.gen(function* () {
      const file = yield* Effect.tryPromise({
        try: () => ctx.api.getFile(fileId),
        catch: (cause) =>
          toError(cause, "Failed to fetch telegram file metadata"),
      });

      if (!file.file_path) {
        return yield* Effect.fail(
          new Error("File path is missing for Telegram file")
        );
      }

      const fileUrl = `https://api.telegram.org/file/bot${telegramToken}/${file.file_path}`;

      const response = yield* Effect.mapError(
        HttpClient.get(fileUrl),
        (cause) => toError(cause, "Failed to download telegram file")
      );

      const okResponse = yield* Effect.mapError(
        HttpClientResponse.filterStatusOk(response),
        (cause) =>
          toError(cause, "Telegram file download returned an error status")
      );

      const arrayBuffer = yield* Effect.mapError(
        okResponse.arrayBuffer,
        (cause) => toError(cause, "Failed to read telegram file body")
      );

      const audioBytes = new Uint8Array(arrayBuffer);
      const contentType = pipe(
        Headers.get(okResponse.headers, "content-type"),
        Option.getOrUndefined
      );

      const transcription = yield* Effect.tryPromise({
        try: () =>
          transcribe({
            model: openai.transcription(getTranscriptionModel()),
            audio: audioBytes,
          }),
        catch: (cause) => toError(cause, "Failed to transcribe audio"),
      });

      const text = transcription.text?.trim();
      if (!text) {
        return yield* Effect.fail(new Error("Transcription result is empty"));
      }

      return {
        text,
        language: transcription.language,
        durationInSeconds: transcription.durationInSeconds,
        filePath: file.file_path,
        size: audioBytes.length,
        contentType: contentType ?? undefined,
      } as const;
    });
