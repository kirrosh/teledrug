import { Effect } from "effect";
import type { Bot } from "grammy";
import { decodeTaskCallback } from "../../../tasks/keyboard.js";
import { TaskRepository, TaskRepositoryLive } from "../../../services/task-repository.js";
import { formatSingleTaskMessage } from "../../../tasks/formatters.js";

export const registerCallbackHandlers = (bot: Bot) => {
  bot.on("callback_query:data", async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from?.id;

    if (!userId) {
      await ctx.answerCallbackQuery({
        text: "❌ Не удалось определить пользователя",
      });
      return;
    }

    // Декодируем callback данные задачи
    const taskCallback = decodeTaskCallback(callbackData);

    if (!taskCallback) {
      // Это не callback задачи, игнорируем
      await ctx.answerCallbackQuery();
      return;
    }

    const { action, taskId } = taskCallback;

    // Обрабатываем действия с задачами
    try {
      if (action === "complete") {
        // Выполняем задачу и получаем обновленные данные
        const completed = await Effect.runPromise(
          TaskRepository.pipe(
            Effect.andThen((repo) => repo.complete(taskId, userId))
          ).pipe(Effect.provide(TaskRepositoryLive))
        );

        if (completed) {
          // Получаем обновленную задачу из БД
          const updatedTask = await Effect.runPromise(
            TaskRepository.pipe(
              Effect.andThen((repo) => repo.findById(taskId, userId))
            ).pipe(Effect.provide(TaskRepositoryLive))
          );

          if (updatedTask) {
            await ctx.answerCallbackQuery({
              text: "✅ Задача выполнена!",
            });

            // Форматируем обновленное сообщение с новым статусом и кнопками
            try {
              const formattedMessage = formatSingleTaskMessage(updatedTask);
              await ctx.editMessageText(formattedMessage.text, {
                parse_mode: formattedMessage.parseMode,
                reply_markup: formattedMessage.replyMarkup,
              });
            } catch (editError) {
              console.error("Не удалось обновить сообщение:", editError);
            }
          } else {
            await ctx.answerCallbackQuery({
              text: "✅ Задача выполнена, но не удалось обновить сообщение",
            });
          }
        } else {
          await ctx.answerCallbackQuery({
            text: "❌ Задача не найдена",
          });
        }
      } else if (action === "delete") {
        // Удаляем задачу
        const result = await Effect.runPromise(
          TaskRepository.pipe(
            Effect.andThen((repo) => repo.delete(taskId, userId))
          ).pipe(Effect.provide(TaskRepositoryLive))
        );

        if (result) {
          await ctx.answerCallbackQuery({
            text: "🗑 Задача удалена",
          });

          // Удаляем сообщение полностью или обновляем его
          try {
            await ctx.deleteMessage();
          } catch (deleteError) {
            // Если не удалось удалить, обновляем текст
            try {
              await ctx.editMessageText("🗑 _Задача удалена_", {
                parse_mode: "Markdown",
              });
            } catch (editError) {
              console.error("Не удалось обновить сообщение:", editError);
            }
          }
        } else {
          await ctx.answerCallbackQuery({
            text: "❌ Задача не найдена",
          });
        }
      } else {
        // Неизвестное действие
        await ctx.answerCallbackQuery();
      }
    } catch (error) {
      console.error("Ошибка при обработке callback:", error);
      await ctx.answerCallbackQuery({
        text: "❌ Произошла ошибка",
      });
    }
  });
};
