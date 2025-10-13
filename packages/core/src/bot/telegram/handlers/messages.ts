import { Effect } from "effect";
import type { Bot, Context as TelegramContext } from "grammy";
import { NodeHttpClient } from "@effect/platform-node";
import type { AudioTranscriber } from "../audio-transcriber";
import type { HandleUserMessageOptions } from "../message-processor";
import type { MessageProcessor } from "../message-processor";

const createPreview = (value: string, limit = 200) => {
  const normalized = value.trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
};

export const registerMessageHandlers = (
  bot: Bot,
  messageProcessor: MessageProcessor,
  audioTranscriber: AudioTranscriber
) => {
  const { handleUserMessage } = messageProcessor;

  bot.on("message:text", async (ctx: TelegramContext) => {
    const text = ctx.message.text;
    if (!text) {
      return;
    }

    await handleUserMessage(ctx, text, { interactionType: "TEXT" });
  });

  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message.voice;
    if (!voice) {
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || chatId;
    console.log(
      `🎙️ Получено голосовое сообщение от ${userId}: duration=${
        voice.duration ?? 0
      }s, size=${voice.file_size ?? 0}B`
    );

    let progressMessageId: number | undefined;

    try {
      const progressMessage = await ctx.reply(
        "🎙️ Расшифровываю голосовое сообщение..."
      );
      progressMessageId = progressMessage.message_id;

      const transcription = await Effect.runPromise(
        audioTranscriber(ctx, voice.file_id).pipe(
          Effect.provide(NodeHttpClient.layer)
        )
      );

      const transcriptionPreview = createPreview(transcription.text);
      console.log(
        `📝 Расшифровка голосового сообщения (${userId}, язык=${
          transcription.language ?? "unknown"
        }): ${transcriptionPreview}`
      );

      await handleUserMessage(ctx, transcription.text, {
        interactionType: "VOICE",
        progressMessageId,
        initialProgressText: "🤔 Думаю над ответом...",
      });
    } catch (error) {
      console.error("Ошибка при обработке голосового сообщения:", error);
      const errorMessage =
        "❌ Не удалось распознать голосовое сообщение. Попробуйте ещё раз или отправьте текст.";
      if (progressMessageId !== undefined) {
        try {
          await ctx.api.editMessageText(chatId, progressMessageId, errorMessage);
        } catch (editError) {
          console.error(
            "Не удалось обновить сообщение прогресса (voice):",
            editError
          );
          await ctx.reply(errorMessage);
        }
      } else {
        await ctx.reply(errorMessage);
      }
    }
  });

  bot.on("message:audio", async (ctx) => {
    const audio = ctx.message.audio;
    if (!audio) {
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || chatId;
    console.log(
      `🎵 Получено аудио от ${userId}: ${
        audio.file_name ?? "<без имени>"
      }, duration=${audio.duration ?? 0}s, size=${audio.file_size ?? 0}B`
    );

    let progressMessageId: number | undefined;

    try {
      const progressMessage = await ctx.reply("🎧 Обрабатываю аудио...");
      progressMessageId = progressMessage.message_id;

      const transcription = await Effect.runPromise(
        audioTranscriber(ctx, audio.file_id).pipe(
          Effect.provide(NodeHttpClient.layer)
        )
      );

      const transcriptionPreview = createPreview(transcription.text);
      console.log(
        `📝 Расшифровка аудио (${userId}, язык=${
          transcription.language ?? "unknown"
        }): ${transcriptionPreview}`
      );

      const options: HandleUserMessageOptions = {
        interactionType: "VOICE",
        progressMessageId,
        initialProgressText: "🤔 Думаю над ответом...",
      };

      await handleUserMessage(ctx, transcription.text, options);
    } catch (error) {
      console.error("Ошибка при обработке аудио файла:", error);
      const errorMessage =
        "❌ Не удалось распознать аудио. Попробуйте другое сообщение или отправьте текст.";
      if (progressMessageId !== undefined) {
        try {
          await ctx.api.editMessageText(chatId, progressMessageId, errorMessage);
        } catch (editError) {
          console.error(
            "Не удалось обновить сообщение прогресса (audio):",
            editError
          );
          await ctx.reply(errorMessage);
        }
      } else {
        await ctx.reply(errorMessage);
      }
    }
  });
};
