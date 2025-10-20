import { InlineKeyboard } from "grammy";
import type { Task } from "@teledrug/db";
import { isEvent } from "./utils.js";

/**
 * Типы действий с задачами через callback кнопки
 */
export type TaskCallbackAction = "complete" | "delete" | "open_calendar";

/**
 * Структура данных для callback кнопок задач
 */
export interface TaskCallbackData {
  readonly action: TaskCallbackAction;
  readonly taskId: number;
}

/**
 * Префикс для идентификации callback данных задач
 */
const TASK_CALLBACK_PREFIX = "task:";

/**
 * Кодирует данные callback в строку
 */
export const encodeTaskCallback = (data: TaskCallbackData): string => {
  return `${TASK_CALLBACK_PREFIX}${data.action}:${data.taskId}`;
};

/**
 * Декодирует строку callback в данные
 */
export const decodeTaskCallback = (
  callbackData: string
): TaskCallbackData | null => {
  if (!callbackData.startsWith(TASK_CALLBACK_PREFIX)) {
    return null;
  }

  const withoutPrefix = callbackData.slice(TASK_CALLBACK_PREFIX.length);
  const parts = withoutPrefix.split(":");

  if (parts.length !== 2) {
    return null;
  }

  const [action, taskIdStr] = parts;

  if (!action || !taskIdStr) {
    return null;
  }

  const taskId = parseInt(taskIdStr, 10);

  if (
    isNaN(taskId) ||
    !["complete", "delete", "open_calendar"].includes(action)
  ) {
    return null;
  }

  return {
    action: action as TaskCallbackAction,
    taskId,
  };
};

/**
 * Генерирует ссылку на Яндекс.Календарь для события
 * @param task - событие (должно быть isEvent)
 * @param yandexUid - UID пользователя в Яндекс.Календаре (опционально)
 */
export const generateYandexCalendarUrl = (
  task: Task,
  yandexUid?: string
): string | null => {
  if (!isEvent(task) || !task.startAt) {
    return null;
  }

  const startDate = new Date(task.startAt);
  const dateStr = startDate.toISOString().split("T")[0]; // YYYY-MM-DD

  let url = `https://calendar.yandex.ru/week?show_date=${dateStr}`;

  if (yandexUid) {
    url += `&uid=${yandexUid}`;
  }

  return url;
};

/**
 * Создает inline-клавиатуру для задачи
 * @param task - задача или событие
 * @param options - дополнительные опции (yandexUid для ссылки на календарь)
 */
export const createTaskKeyboard = (
  task: Task,
  options?: { yandexUid?: string }
): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  // Для событий добавляем кнопку "Открыть в календаре"
  if (isEvent(task)) {
    const calendarUrl = generateYandexCalendarUrl(task, options?.yandexUid);
    if (calendarUrl) {
      keyboard.url("📅 Открыть в календаре", calendarUrl);
    }
  }

  // Кнопка "Выполнить" (только если задача не завершена)
  if (task.status !== "done") {
    keyboard.text(
      "✅ Выполнить",
      encodeTaskCallback({ action: "complete", taskId: task.id })
    );
  }

  // Кнопка "Удалить"
  keyboard.text(
    "🗑 Удалить",
    encodeTaskCallback({ action: "delete", taskId: task.id })
  );

  return keyboard;
};
