import type { Task } from "@teledrug/db";

/**
 * Определяет, является ли запись событием (event) или задачей (task)
 * Событие - это запись с заполненными startAt и endAt
 * Задача - это запись с заполненным dueAt или без временных полей
 */
export const isEvent = (task: Task): boolean => {
  return Boolean(task.startAt && task.endAt);
};

export const isTask = (task: Task): boolean => {
  return !isEvent(task);
};

/**
 * Проверяет, синхронизирована ли запись с календарем
 */
export const isSyncedWithCalendar = (task: Task): boolean => {
  return Boolean(task.calendarEventId);
};

/**
 * Проверяет, связана ли запись с Telegram сообщением
 */
export const isLinkedToTelegram = (task: Task): boolean => {
  return Boolean(task.telegramMessageId && task.telegramChatId);
};

/**
 * Получает тип записи как строку для отображения
 */
export const getTaskType = (task: Task): "event" | "task" => {
  return isEvent(task) ? "event" : "task";
};

/**
 * Получает эмодзи для типа записи
 */
export const getTaskTypeEmoji = (task: Task): string => {
  if (isEvent(task)) {
    return "📅"; // Событие с временем
  }
  if (task.dueAt) {
    return "📋"; // Задача с дедлайном
  }
  return "✓"; // Простая задача без дедлайна
};

/**
 * Форматирует временной диапазон для события
 */
export const formatEventTimeRange = (
  task: Task,
  options: { locale?: string; timeZone?: string } = {}
): string | null => {
  if (!isEvent(task) || !task.startAt || !task.endAt) {
    return null;
  }

  const locale = options.locale ?? "ru-RU";
  const start = new Date(task.startAt);
  const end = new Date(task.endAt);

  const formatterOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };

  if (options.timeZone) {
    formatterOptions.timeZone = options.timeZone;
  }

  const timeFormatter = new Intl.DateTimeFormat(locale, formatterOptions);
  return `${timeFormatter.format(start)}–${timeFormatter.format(end)}`;
};

/**
 * Форматирует дату дедлайна для задачи
 */
export const formatTaskDueDate = (
  task: Task,
  options: { locale?: string; timeZone?: string } = {}
): string | null => {
  if (!task.dueAt) {
    return null;
  }

  const locale = options.locale ?? "ru-RU";
  const date = new Date(task.dueAt);

  const formatterOptions: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
  };

  if (options.timeZone) {
    formatterOptions.timeZone = options.timeZone;
  }

  const now = new Date();
  if (date.getFullYear() !== now.getFullYear()) {
    formatterOptions.year = "numeric";
  }

  return new Intl.DateTimeFormat(locale, formatterOptions).format(date);
};

/**
 * Получает основную дату/время для сортировки
 * Для событий - startAt, для задач - dueAt
 */
export const getPrimaryDate = (task: Task): Date | null => {
  if (isEvent(task) && task.startAt) {
    return new Date(task.startAt);
  }
  if (task.dueAt) {
    return new Date(task.dueAt);
  }
  return null;
};

/**
 * Сравнивает две записи для сортировки по дате
 */
export const compareByDate = (a: Task, b: Task): number => {
  const dateA = getPrimaryDate(a);
  const dateB = getPrimaryDate(b);

  if (!dateA && !dateB) return 0;
  if (!dateA) return 1; // Записи без даты в конец
  if (!dateB) return -1;

  return dateA.getTime() - dateB.getTime();
};
