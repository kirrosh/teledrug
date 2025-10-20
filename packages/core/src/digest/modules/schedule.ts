import { Effect } from "effect";
import type { DigestModuleImpl } from "../types";
import {
  TaskRepository as TaskRepositoryTag,
  type TaskRepository as TaskRepositoryService,
} from "../../services/task-repository";
import {
  isEvent,
  formatEventTimeRange,
  formatTaskDueDate,
  getTaskTypeEmoji,
  compareByDate,
} from "../../tasks/utils";
import {
  getDayBoundsInTimezone,
  formatInTimezone,
  normalizeTimezone,
} from "@teledrug/timezone";
import type { Task } from "@teledrug/db";

const formatTaskLine = (
  task: Task,
  options: { locale: string; timezone: string }
): string => {
  const emoji = getTaskTypeEmoji(task);
  const title = task.title.trim();

  if (isEvent(task)) {
    const timeRange = formatEventTimeRange(task, options);
    const location = task.location ? ` (${task.location})` : "";
    return `${emoji} ${timeRange} — ${title}${location}`;
  }

  // Задача
  const dueDate = formatTaskDueDate(task, options);
  const dueSuffix = dueDate ? ` (до ${dueDate})` : "";
  return `${emoji} ${title}${dueSuffix}`;
};

/**
 * Объединенный модуль дайджеста для задач и событий
 * Показывает все на сегодня: и события из календаря, и задачи с дедлайнами
 */
export const ScheduleDigestModule: DigestModuleImpl<TaskRepositoryService> = {
  id: "schedule",
  fetch: (context, entry) =>
    Effect.gen(function* () {
      if (!entry?.enabled) {
        return null;
      }

      const taskRepository = yield* TaskRepositoryTag;
      const timeZone = normalizeTimezone(context.userSettings.timezone);
      const locale = context.userSettings.locale || "ru-RU";
      const { start, end } = getDayBoundsInTimezone(context.date, timeZone);

      // Получаем все задачи и события на сегодня
      const items = yield* taskRepository
        .listByFilters(context.userId, {
          status: ["todo"],
          dueFrom: start,
          dueTo: end,
          includeWithoutDue: false,
          limit: 50,
        })
        .pipe(
          Effect.catchAll((error) => {
            console.error("❌ Failed to fetch schedule for digest:", error);
            return Effect.succeed([] as Task[]);
          })
        );

      if (items.length === 0) {
        return "📅 Сегодня дел и событий нет";
      }

      // Сортируем по времени (события по startAt, задачи по dueAt)
      const sorted = items.slice().sort(compareByDate);

      const options = { locale, timezone: timeZone };
      const lines = sorted.map((item) => formatTaskLine(item, options)).join("\n");

      const dateLabel = formatInTimezone(
        context.date,
        locale,
        { weekday: "long", day: "numeric", month: "long" },
        timeZone
      );

      return `📅 Расписание на сегодня (${dateLabel}):\n${lines}`;
    }),
};
