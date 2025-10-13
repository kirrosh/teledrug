import { Effect } from "effect";
import type { Bot, Context as TelegramContext } from "grammy";
import { NodeHttpClient } from "@effect/platform-node";
import type { PhotoSize } from "grammy/types";
import type { AudioTranscriber } from "../audio-transcriber";
import type { ImageAnalyzer } from "../image-analyzer";
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
  audioTranscriber: AudioTranscriber,
  imageAnalyzer: ImageAnalyzer
) => {
  const { handleUserMessage } = messageProcessor;

  const pickLargestPhoto = (photos: readonly PhotoSize[]): PhotoSize => {
    let best = photos[0]!;
    for (const candidate of photos) {
      if (
        (candidate.file_size ?? candidate.width * candidate.height) >
        (best.file_size ?? best.width * best.height)
      ) {
        best = candidate;
      }
    }
    return best;
  };

  const formatBytes = (value: number): string => {
    const units = ["Б", "КБ", "МБ", "ГБ"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size % 1 === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]!}`;
  };

  const resolveForwardLabel = (ctx: TelegramContext): string | undefined => {
    const message = ctx.message as any;
    if (!message) {
      return undefined;
    }

    const forwardOrigin = message.forward_origin;
    if (forwardOrigin && typeof forwardOrigin === "object") {
      if (forwardOrigin.type === "user") {
        const name =
          forwardOrigin.sender_user?.username ??
          [forwardOrigin.sender_user?.first_name, forwardOrigin.sender_user?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim();
        if (name && name.length > 0) {
          return `Переслано от пользователя ${name}`;
        }
        return "Переслано от пользователя";
      }
      if (forwardOrigin.type === "channel") {
        const title =
          forwardOrigin.chat?.title ??
          forwardOrigin.chat?.username ??
          forwardOrigin.chat?.id;
        return title
          ? `Переслано из канала ${title}`
          : "Переслано из канала";
      }
      if (forwardOrigin.type === "hidden_user") {
        return "Переслано от скрытого пользователя";
      }
      if (forwardOrigin.type === "chat") {
        const title =
          forwardOrigin.sender_chat?.title ??
          forwardOrigin.sender_chat?.username ??
          forwardOrigin.sender_chat?.id;
        return title
          ? `Переслано из чата ${title}`
          : "Переслано из чата";
      }
    }

    if (message.forward_sender_name) {
      return `Переслано от ${message.forward_sender_name}`;
    }

    if (message.forward_from_chat) {
      const title =
        message.forward_from_chat.title ??
        message.forward_from_chat.username ??
        message.forward_from_chat.id;
      return title ? `Переслано из ${title}` : "Переслано из чата";
    }

    if (message.forward_from) {
      const name =
        message.forward_from.username ??
        [message.forward_from.first_name, message.forward_from.last_name].filter(Boolean).join(" ").trim();
      return name && name.length > 0
        ? `Переслано от пользователя ${name}`
        : "Переслано от пользователя";
    }

    return undefined;
  };

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    await handleUserMessage(ctx, text, { interactionType: "TEXT" });
  });

  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message?.voice;
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
    const audio = ctx.message?.audio;
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

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      return;
    }

    const largestPhoto = pickLargestPhoto(photos);
    const forwardLabel = resolveForwardLabel(ctx);
    const summarySections: string[] = [];
    const metadataLines: string[] = [
      `Источник: ${forwardLabel ?? "Прямое сообщение пользователя"}`,
      `Размер: ${largestPhoto.width}×${largestPhoto.height} px`,
      ...(largestPhoto.file_size
        ? [`Вес файла: ${formatBytes(largestPhoto.file_size)}`]
        : []),
      `Telegram file id: ${largestPhoto.file_id}`,
    ];

    const caption = ctx.message?.caption?.trim();
    if (caption && caption.length > 0) {
      summarySections.push(`Подпись отправителя:\n${caption}`);
    }

    try {
      const analysis = await Effect.runPromise(
        imageAnalyzer(ctx, largestPhoto).pipe(Effect.provide(NodeHttpClient.layer))
      );

      if (analysis.extractedText) {
        summarySections.unshift(`Извлечённый текст изображения:\n${analysis.extractedText}`);
      }

      if (analysis.description) {
        summarySections.push(`Описание изображения:\n${analysis.description}`);
      }
    } catch (error) {
      console.error("Ошибка при анализе изображения:", error);
    }

    if (summarySections.length === 0) {
      summarySections.push(
        "Изображение получено, но распознать текст или описание не удалось."
      );
    }

    const messageContent = [...summarySections, metadataLines.join("\n")]
      .filter((section) => section.trim().length > 0)
      .join("\n\n");

    const interactionType = "IMAGE" as const;
    const initialProgressText = forwardLabel
      ? "🔁 Обрабатываю пересланное изображение..."
      : "🖼️ Анализирую изображение...";

    await handleUserMessage(ctx, messageContent, {
      interactionType,
      initialProgressText,
    });
  });
};
