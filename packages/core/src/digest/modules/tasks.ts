import { Effect } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";
import {
  TaskRepository as TaskRepositoryTag,
  type TaskRepository as TaskRepositoryService,
} from "../../services/task-repository";
import { getDayBoundsInTimezone, normalizeTimezone } from "@teledrug/timezone";

interface TaskSettings {
  readonly limit?: number;
}

const parseSettings = (settings: ModuleSettingEntry | undefined): TaskSettings => {
  const value = settings?.settings;
  const limit = typeof value?.limit === "number" && value.limit > 0 && value.limit <= 10 ? value.limit : 3;
  return { limit };
};

const formatTaskLine = (
  title: string,
  dueAt: Date | string | null,
  formatter: Intl.DateTimeFormat
) => {
  if (!dueAt) return `• ${title}`;
  const asDate = typeof dueAt === "string" ? new Date(dueAt) : new Date(dueAt);
  return `• ${formatter.format(asDate)} — ${title}`;
};

export const TasksDigestModule: DigestModuleImpl<TaskRepositoryService> = {
  id: "tasks",
  fetch: (context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) return null;

      const settings = parseSettings(entry);
      const repo = yield* TaskRepositoryTag;
      const timeZone = normalizeTimezone(context.userSettings.timezone);
      const tasks = yield* repo
        .listForToday(context.userId, settings.limit, {
          timezone: timeZone,
          now: context.date,
        })
        .pipe(
          Effect.catchAll(() => Effect.succeed([]))
        );
      const overdue = yield* repo.countOverdue(context.userId, context.date).pipe(
        Effect.catchAll(() => Effect.succeed(0))
      );

      if (tasks.length === 0 && overdue === 0) {
        return "🧭 На сегодня задач нет";
      }

      const locale = context.userSettings.locale || "ru-RU";
      const formatter = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      });
      const lines = tasks.map((t) => formatTaskLine(t.title, t.dueAt ?? null, formatter));
      const { start } = getDayBoundsInTimezone(context.date, timeZone);
      const headerDate = new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        timeZone,
      }).format(start);
      const header = `🧭 Задачи на сегодня (${headerDate})`;
      const overdueText = overdue > 0 ? `\n⏰ Просрочено: ${overdue}` : "";
      return `${header}:\n${lines.join("\n")}${overdueText}`;
    }),
};
