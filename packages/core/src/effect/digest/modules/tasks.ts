import { Effect } from "effect";
import type { DigestModuleImpl } from "../types";
import type { ModuleSettingEntry } from "../../services/digest-settings";
import {
  TaskRepository as TaskRepositoryTag,
  type TaskRepository as TaskRepositoryService,
} from "../../services/task-repository";

interface TaskSettings {
  readonly limit?: number;
}

const parseSettings = (settings: ModuleSettingEntry | undefined): TaskSettings => {
  const value = settings?.settings;
  const limit = typeof value?.limit === "number" && value.limit > 0 && value.limit <= 10 ? value.limit : 3;
  return { limit };
};

const formatTaskLine = (title: string, dueAt?: Date | null) => {
  if (!dueAt) return `• ${title}`;
  const d = new Date(dueAt);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `• ${hh}:${mm} — ${title}`;
};

export const TasksDigestModule: DigestModuleImpl<TaskRepositoryService> = {
  id: "tasks",
  fetch: (context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) return null;

      const settings = parseSettings(entry);
      const repo = yield* TaskRepositoryTag;
      const tasks = yield* repo.listForToday(context.userId, settings.limit).pipe(
        Effect.catchAll(() => Effect.succeed([]))
      );
      const overdue = yield* repo.countOverdue(context.userId).pipe(
        Effect.catchAll(() => Effect.succeed(0))
      );

      if (tasks.length === 0 && overdue === 0) {
        return "🧭 На сегодня задач нет";
      }

      const lines = tasks.map((t) => formatTaskLine(t.title, t.dueAt as Date | null));
      const header = "🧭 Задачи на сегодня";
      const overdueText = overdue > 0 ? `\n⏰ Просрочено: ${overdue}` : "";
      return `${header}:\n${lines.join("\n")}${overdueText}`;
    }),
};
