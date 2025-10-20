import type { Task } from "@teledrug/db";
import { isEvent, formatEventTimeRange } from "./utils.js";
import { createTaskKeyboard } from "./keyboard.js";

/**
 * Эмодзи для статусов задач
 */
export const taskStatusEmoji: Record<string, string> = {
  todo: "🟦",
  done: "✅",
  cancelled: "🚫",
};

/**
 * Метки статусов задач на русском
 */
export const taskStatusLabel: Record<string, string> = {
  todo: "активна",
  done: "выполнена",
  cancelled: "отменена",
};

/**
 * Экранирует специальные символы для MarkdownV2
 */
export const escapeMarkdown = (value: string): string =>
  value.replace(/[_*\[\]()~`>#+=|{}.!-]/g, (match) => `\\${match}`);

/**
 * Форматирует дату дедлайна в читаемый вид
 */
export const formatDueDate = (
  date: Date | string | null | undefined,
  options?: { locale?: string; timeZone?: string }
): string => {
  if (!date) return "—";

  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";

  const locale = options?.locale ?? "ru-RU";
  const now = new Date();

  const formatterOptions: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
  };

  if (options?.timeZone) {
    formatterOptions.timeZone = options.timeZone;
  }

  if (d.getFullYear() !== now.getFullYear()) {
    formatterOptions.year = "numeric";
  }

  return new Intl.DateTimeFormat(locale, formatterOptions).format(d);
};

/**
 * Форматирует отдельную задачу с деталями и кнопками
 */
export const formatSingleTaskMessage = (
  task: Task,
  options: { locale?: string; timezone?: string } = {}
) => {
  const locale = options.locale ?? "ru-RU";
  const timezone = options.timezone ?? "UTC";

  const emoji = taskStatusEmoji[task.status] ?? "•";
  const title = escapeMarkdown(task.title.trim());
  const lines: string[] = [];

  // Заголовок
  lines.push(`${emoji} *#${task.id}* — ${title}`);

  // Описание (если есть)
  if (task.description && task.description.trim().length > 0) {
    lines.push(`📝 ${escapeMarkdown(task.description.trim())}`);
  }

  // Время/дедлайн
  if (isEvent(task) && task.startAt && task.endAt) {
    const timeRange = formatEventTimeRange(task, { locale, timeZone: timezone });
    const startDate = new Date(task.startAt);
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: timezone,
    });
    lines.push(`📅 ${escapeMarkdown(dateFormatter.format(startDate))}`);
    if (timeRange) {
      lines.push(`🕐 ${escapeMarkdown(timeRange)}`);
    }
  } else if (task.dueAt) {
    const dueLabel = formatDueDate(task.dueAt, { locale, timeZone: timezone });
    if (dueLabel !== "—") {
      lines.push(`⏰ До: ${escapeMarkdown(dueLabel)}`);
    }
  }

  // Место (если есть)
  if (task.location && task.location.trim().length > 0) {
    lines.push(`📍 ${escapeMarkdown(task.location.trim())}`);
  }

  // Статус
  const statusLabel = taskStatusLabel[task.status];
  if (statusLabel && task.status !== "todo") {
    lines.push(`ℹ️ Статус: ${escapeMarkdown(statusLabel)}`);
  }

  return {
    text: lines.join("\n"),
    parseMode: "Markdown" as const,
    replyMarkup: createTaskKeyboard(task),
  };
};
