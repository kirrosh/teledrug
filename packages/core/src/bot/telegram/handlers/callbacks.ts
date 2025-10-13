import { Effect } from "effect";
import type { Bot } from "grammy";
import type { JournalRepository } from "../../../services/journal-repository";
import type { TaskRepository } from "../../../services/task-repository";

export const registerCallbackHandlers = (
  bot: Bot,
  journalRepository: JournalRepository,
  taskRepository: TaskRepository
) => {
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data || "";

    if (!data.startsWith("journal:")) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("journal:delete:")) {
      const [, , entryIdRaw] = data.split(":");
      if (!entryIdRaw) {
        await ctx.answerCallbackQuery({
          text: "❌ Не удалось удалить запись",
          show_alert: true,
        });
        return;
      }
      const entryId = Number.parseInt(entryIdRaw, 10);
      const userId = ctx.from?.id || ctx.chat?.id;

      if (!userId || Number.isNaN(entryId)) {
        await ctx.answerCallbackQuery({
          text: "❌ Не удалось удалить запись",
          show_alert: true,
        });
        return;
      }

      try {
        const deleted = await Effect.runPromise(
          journalRepository.deleteEntry(entryId, userId)
        );

        if (deleted) {
          await ctx.answerCallbackQuery({ text: "🗑 Запись удалена" });
          try {
            await ctx.editMessageText("Запись не сохранена");
          } catch (error) {
            console.error(
              "Не удалось обновить сообщение после удаления:",
              error
            );
          }
        } else {
          await ctx.answerCallbackQuery({
            text: "⚠️ Запись уже удалена",
            show_alert: false,
          });
        }
      } catch (error) {
        console.error("Ошибка при удалении записи дневника:", error);
        await ctx.answerCallbackQuery({
          text: "❌ Не удалось удалить запись",
          show_alert: true,
        });
      }

      return;
    }

    if (data.startsWith("journal:createTask:")) {
      const parts = data.split(":");
      const dateToken = parts[3] || "0";
      let dueAt: Date | null = null;
      if (/^\d{8}$/.test(dateToken)) {
        const y = Number(dateToken.slice(0, 4));
        const m = Number(dateToken.slice(4, 6)) - 1;
        const d = Number(dateToken.slice(6, 8));
        const dt = new Date(Date.UTC(y, m, d));
        dueAt = new Date(
          dt.getUTCFullYear(),
          dt.getUTCMonth(),
          dt.getUTCDate()
        );
      }

      const messageText = ctx.callbackQuery.message?.text || "";
      const line =
        messageText
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.startsWith("• ")) || "";
      const title = line
        .replace(/^•\s+/, "")
        .replace(/\s+—\s+до\s+.+$/, "")
        .trim();
      const userId = ctx.from?.id || ctx.chat?.id;

      if (!userId || !title) {
        await ctx.answerCallbackQuery({
          text: "❌ Не удалось создать задачу",
          show_alert: true,
        });
        return;
      }

      try {
        await Effect.runPromise(
          taskRepository.create({ userId, title, dueAt })
        );
        await ctx.answerCallbackQuery({ text: "✅ Задача создана" });
        await ctx.reply(`✅ Создана задача: ${title}`);
      } catch (error) {
        console.error("Ошибка создания задачи из записи:", error);
        await ctx.answerCallbackQuery({
          text: "❌ Ошибка создания задачи",
          show_alert: true,
        });
      }

      return;
    }

    await ctx.answerCallbackQuery();
  });
};
