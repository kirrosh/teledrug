import { Effect } from "effect";
import { tool } from "ai";
import type { CoreMessage } from "ai";
import { z } from "zod";
import type { ToolResultFormatter } from "../types/integrations";
import { TaskRepository } from "../services/task-repository";
import type { TaskRepository as TaskRepositoryService } from "../services/task-repository";
import type { Task } from "../../storage/database/schema";

const AddTaskSchema = z.object({
  title: z.string().min(1),
  dueAt: z.string().datetime().optional(),
});

const IdentifyTaskBaseSchema = z.object({
  id: z.number().int().positive().optional(),
  titleLike: z.string().min(1).optional(),
});

const ensureIdentifier = (
  value: { readonly id?: number; readonly titleLike?: string },
  ctx: z.RefinementCtx
) => {
  if (!value.id && (!value.titleLike || value.titleLike.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Нужно указать id или часть названия задачи",
    });
  }
};

const IdentifyTaskSchema = IdentifyTaskBaseSchema.superRefine(ensureIdentifier);

const UpdateTaskSchema = IdentifyTaskBaseSchema.extend({
  set: z.object({
    title: z.string().min(1).optional(),
    dueAt: z.union([z.string().datetime(), z.null()]).optional(),
    status: z.enum(["todo", "done", "cancelled"]).optional(),
  }),
}).superRefine((value, ctx) => {
  ensureIdentifier(value, ctx);
  if (!value.set || Object.keys(value.set).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["set"],
      message: "Нужно указать изменения",
    });
  }
});

const RescheduleTaskSchema = IdentifyTaskBaseSchema.extend({
  shift: z
    .union([
      z.literal("today"),
      z.literal("tomorrow"),
      z.literal("next_week"),
      z.string().regex(/^\+\d{1,3}days$/i),
    ])
    .optional(),
  dueAt: z.union([z.string().datetime(), z.null()]).optional(),
}).superRefine((value, ctx) => {
  ensureIdentifier(value, ctx);
  if (value.shift === undefined && value.dueAt === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Нужно указать новую дату или сдвиг",
    });
  }
});

const ManageTasksSchema = z
  .object({
    summary: z.string().optional(),
    create: z.array(AddTaskSchema).default([]),
    update: z.array(UpdateTaskSchema).default([]),
    complete: z.array(IdentifyTaskSchema).default([]),
    delete: z.array(IdentifyTaskSchema).default([]),
    reschedule: z.array(RescheduleTaskSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const total =
      value.create.length +
      value.update.length +
      value.complete.length +
      value.delete.length +
      value.reschedule.length;
    if (total === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Нужно указать хотя бы одно действие",
      });
    }
  });

const TaskStatusEnum = z.enum(["todo", "done", "cancelled"]);

const ListTasksSchema = z
  .object({
    status: z
      .union([TaskStatusEnum, z.array(TaskStatusEnum).min(1).max(3)])
      .optional(),
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
    includeWithoutDue: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .superRefine((value, ctx) => {
    if ((value.start && !value.end) || (!value.start && value.end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Нужно указать и дату начала, и дату окончания интервала",
        path: value.start ? ["end"] : ["start"],
      });
      return;
    }

    if (value.start && value.end) {
      const startDate = new Date(value.start);
      const endDate = new Date(value.end);
      if (startDate.getTime() > endDate.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Дата начала интервала не может быть позже даты окончания",
          path: ["start"],
        });
      }
    }
  });

type ManageTasksInput = z.infer<typeof ManageTasksSchema>;
type ListTasksInput = z.infer<typeof ListTasksSchema>;
type IdentifyTaskInput = z.infer<typeof IdentifyTaskSchema>;
type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
type RescheduleTaskInput = z.infer<typeof RescheduleTaskSchema>;

interface FormatDueDateOptions {
  readonly locale?: string;
  readonly timeZone?: string;
}

const escapeMarkdown = (value: string): string =>
  value.replace(/[\\_\*\[\]\(\)~`>#+=|{}.!-]/g, (match) => `\\${match}`);

type RepoTask = Task;

type ResolveResult =
  | { readonly kind: "one"; readonly task: RepoTask }
  | { readonly kind: "many"; readonly tasks: ReadonlyArray<RepoTask> }
  | { readonly kind: "none" };

const taskStatusEmoji: Record<string, string> = {
  todo: "🟦",
  done: "✅",
  cancelled: "🚫",
};

const taskStatusLabel: Record<string, string> = {
  todo: "активна",
  done: "выполнена",
  cancelled: "отменена",
};

type ListTasksTaskItem = {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
};

type ListTasksFilters = {
  status?: ReadonlyArray<string>;
  start?: string;
  end?: string;
  includeWithoutDue?: boolean;
  limit: number;
};

type ListTasksContext = {
  locale: string;
  timezone: string;
};

type ListTasksSuccessResult = {
  success: true;
  tasks: ReadonlyArray<ListTasksTaskItem>;
  filters: ListTasksFilters;
  context: ListTasksContext;
};

type ListTasksFailureResult = {
  success: false;
  error: string;
};

type ListTasksResult = ListTasksSuccessResult | ListTasksFailureResult;

const formatDueDate = (
  dueAt: Date | string | null | undefined,
  options: FormatDueDateOptions = {}
) => {
  if (!dueAt) return "—";
  const date = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "—";

  const locale = options.locale ?? "ru-RU";
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

const parseShift = (shift: string): Date => {
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  switch (shift) {
    case "today":
      return base;
    case "tomorrow": {
      const d = new Date(base);
      d.setDate(d.getDate() + 1);
      return d;
    }
    case "next_week": {
      const d = new Date(base);
      const day = d.getDay();
      const diff = (8 - day) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }
    default: {
      const match = /^\+(\d{1,3})days$/i.exec(shift);
      if (match) {
        const offset = Number(match[1]);
        const d = new Date(base);
        d.setDate(d.getDate() + offset);
        return d;
      }
      return base;
    }
  }
};

const toSuggestionList = (tasks: ReadonlyArray<RepoTask>) =>
  tasks.map((task) => ({ id: task.id, title: task.title }));

const resolveTask = (
  repo: TaskRepositoryService,
  userId: number,
  input: IdentifyTaskInput,
  limit = 5
) =>
  Effect.gen(function* () {
    if (input.id) {
      const task = yield* repo.findById(input.id, userId);
      if (task) {
        return { kind: "one", task } as const;
      }
      return { kind: "none" } as const;
    }

    const query = input.titleLike?.trim();
    if (!query) {
      return { kind: "none" } as const;
    }

    const matches = yield* repo.findByTitleLike(userId, query, limit);
    if (matches.length === 0) {
      return { kind: "none" } as const;
    }
    if (matches.length === 1) {
      const [single] = matches;
      if (!single) {
        return { kind: "none" } as const;
      }
      return { kind: "one", task: single } as const;
    }
    return { kind: "many", tasks: matches } as const;
  });

interface ManageTasksSummary {
  readonly created: Array<{ id: number; title: string; dueAt?: string | null }>;
  readonly updated: Array<{
    id: number;
    title: string;
    changes: ReadonlyArray<string>;
  }>;
  readonly completed: Array<{ id: number; title: string }>;
  readonly deleted: Array<{ id: number; title: string }>;
  readonly rescheduled: Array<{
    id: number;
    title: string;
    dueAt?: string | null;
  }>;
}

interface ManageTasksResult {
  readonly success: boolean;
  readonly summary: ManageTasksSummary;
  readonly errors: ReadonlyArray<string>;
  readonly notes?: ReadonlyArray<string>;
  readonly formatOptions?: FormatDueDateOptions;
}

const emptySummary = (): ManageTasksSummary => ({
  created: [],
  updated: [],
  completed: [],
  deleted: [],
  rescheduled: [],
});

const applyManageTasks = (
  repo: TaskRepositoryService,
  userId: number,
  input: ManageTasksInput,
  formatOptions?: FormatDueDateOptions
) =>
  Effect.gen(function* () {
    const summary = emptySummary();
    const errors: string[] = [];
    const notes: string[] = [];

    for (const createInput of input.create) {
      try {
        const dueAtValue = createInput.dueAt
          ? new Date(createInput.dueAt)
          : null;
        if (dueAtValue && Number.isNaN(dueAtValue.getTime())) {
          errors.push(
            `Создание задачи "${createInput.title}": некорректная дата ${createInput.dueAt}`
          );
          continue;
        }
        const task = yield* repo.create({
          userId,
          title: createInput.title.trim(),
          dueAt: dueAtValue,
        });
        summary.created.push({
          id: task.id,
          title: task.title,
          dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
        });
      } catch (cause) {
        const message =
          cause instanceof Error && cause.message
            ? cause.message
            : "Не удалось создать задачу";
        errors.push(`Создание задачи "${createInput.title}": ${message}`);
      }
    }

    const handleTaskResolution = (
      resolved: ResolveResult,
      identifier: IdentifyTaskInput,
      action: string
    ) => {
      switch (resolved.kind) {
        case "none":
          errors.push(`${action}: задача не найдена`);
          return undefined;
        case "many": {
          const options = toSuggestionList(resolved.tasks)
            .map((task) => `#${task.id} — ${task.title}`)
            .join("\n");
          errors.push(
            `${action}: найдено несколько вариантов. Уточните id.\n${options}`
          );
          return undefined;
        }
        case "one":
          return resolved.task;
      }
    };

    for (const completeInput of input.complete) {
      const resolved = yield* resolveTask(repo, userId, completeInput);
      const task = handleTaskResolution(
        resolved,
        completeInput,
        "Завершение задачи"
      );
      if (!task) continue;
      const ok = yield* repo.complete(task.id, userId);
      if (!ok) {
        errors.push(`Не удалось завершить задачу #${task.id}`);
        continue;
      }
      summary.completed.push({ id: task.id, title: task.title });
    }

    for (const deleteInput of input.delete) {
      const resolved = yield* resolveTask(repo, userId, deleteInput);
      const task = handleTaskResolution(
        resolved,
        deleteInput,
        "Удаление задачи"
      );
      if (!task) continue;
      const ok = yield* repo.delete(task.id, userId);
      if (!ok) {
        errors.push(`Не удалось удалить задачу #${task.id}`);
        continue;
      }
      summary.deleted.push({ id: task.id, title: task.title });
    }

    for (const updateInput of input.update) {
      const resolved = yield* resolveTask(repo, userId, updateInput);
      const original = handleTaskResolution(
        resolved,
        updateInput,
        "Обновление задачи"
      );
      if (!original) continue;

      const dueAt =
        updateInput.set.dueAt === undefined
          ? undefined
          : updateInput.set.dueAt === null
          ? null
          : new Date(updateInput.set.dueAt);

      if (dueAt instanceof Date && Number.isNaN(dueAt.getTime())) {
        errors.push(
          `Обновление задачи: некорректная дата ${updateInput.set.dueAt}`
        );
        continue;
      }

      try {
        const updated = yield* repo.update(original.id, userId, {
          title: updateInput.set.title,
          dueAt,
          status: updateInput.set.status,
        });

        const changes: string[] = [];
        if (
          updateInput.set.title &&
          updateInput.set.title.trim() !== original.title.trim()
        ) {
          changes.push(`название → ${updateInput.set.title.trim()}`);
        }
        if (
          updateInput.set.status &&
          updateInput.set.status !== original.status
        ) {
          const label =
            updateInput.set.status === "done"
              ? "✅ выполнена"
              : updateInput.set.status === "cancelled"
              ? "🚫 отменена"
              : "🗓 активна";
          changes.push(`статус → ${label}`);
        }
        if (updateInput.set.dueAt !== undefined) {
          const dueLabel = formatDueDate(dueAt ?? null, formatOptions);
          changes.push(`срок → ${dueLabel}`);
        }

        summary.updated.push({
          id: updated.id,
          title: updated.title,
          changes,
        });
      } catch (cause) {
        const message =
          cause instanceof Error && cause.message
            ? cause.message
            : "Не удалось обновить задачу";
        errors.push(`Обновление задачи #${original.id}: ${message}`);
      }
    }

    for (const rescheduleInput of input.reschedule) {
      const resolved = yield* resolveTask(repo, userId, rescheduleInput);
      const original = handleTaskResolution(
        resolved,
        rescheduleInput,
        "Перенос задачи"
      );
      if (!original) continue;

      let dueAt: Date | null | undefined;
      if (rescheduleInput.dueAt !== undefined) {
        if (rescheduleInput.dueAt === null) {
          dueAt = null;
        } else {
          const date = new Date(rescheduleInput.dueAt);
          if (Number.isNaN(date.getTime())) {
            errors.push(
              `Перенос задачи: некорректная дата ${rescheduleInput.dueAt}`
            );
            continue;
          }
          dueAt = date;
        }
      } else if (rescheduleInput.shift) {
        dueAt = parseShift(rescheduleInput.shift.toLowerCase());
      }

      if (dueAt === undefined) {
        errors.push(`Перенос задачи #${original.id}: не указано новое время`);
        continue;
      }

      try {
        const updated = yield* repo.update(original.id, userId, {
          dueAt,
        });
        summary.rescheduled.push({
          id: updated.id,
          title: updated.title,
          dueAt: updated.dueAt ? new Date(updated.dueAt).toISOString() : null,
        });
      } catch (cause) {
        const message =
          cause instanceof Error && cause.message
            ? cause.message
            : "Не удалось перенести задачу";
        errors.push(`Перенос задачи #${original.id}: ${message}`);
      }
    }

    if (input.summary && input.summary.trim().length > 0) {
      notes.push(input.summary.trim());
    }

    return {
      success: errors.length === 0,
      summary,
      errors,
      notes: notes.length > 0 ? notes : undefined,
      formatOptions,
    } satisfies ManageTasksResult;
  });

const formatManageResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") {
      return { text: "❌ Не удалось обработать задачи" };
    }

    const result = output as ManageTasksResult;
    const sections: string[] = [];

    const formatTaskLine = (
      task: { id: number; title: string },
      extra?: string
    ) =>
      `• #${task.id} — ${escapeMarkdown(task.title)}${
        extra ? ` (${extra})` : ""
      }`;

    if (result.summary.created.length > 0) {
      const lines = result.summary.created
        .map((task) =>
          formatTaskLine(
            task,
            task.dueAt
              ? `до ${escapeMarkdown(
                  formatDueDate(task.dueAt, result.formatOptions)
                )}`
              : undefined
          )
        )
        .join("\n");
      sections.push(`➕ Созданы задачи:\n${lines}`);
    }

    if (result.summary.updated.length > 0) {
      const lines = result.summary.updated
        .map((task) => {
          const changes = task.changes.length
            ? ` — ${task.changes
                .map((change) => escapeMarkdown(change))
                .join(", ")}`
            : "";
          return formatTaskLine(task) + changes;
        })
        .join("\n");
      sections.push(`✏️ Обновлены задачи:\n${lines}`);
    }

    if (result.summary.completed.length > 0) {
      const lines = result.summary.completed
        .map((task) => formatTaskLine(task))
        .join("\n");
      sections.push(`✅ Завершены задачи:\n${lines}`);
    }

    if (result.summary.deleted.length > 0) {
      const lines = result.summary.deleted
        .map((task) => formatTaskLine(task))
        .join("\n");
      sections.push(`🗑 Удалены задачи:\n${lines}`);
    }

    if (result.summary.rescheduled.length > 0) {
      const lines = result.summary.rescheduled
        .map((task) =>
          formatTaskLine(
            task,
            task.dueAt
              ? `новый срок ${escapeMarkdown(
                  formatDueDate(task.dueAt, result.formatOptions)
                )}`
              : "без срока"
          )
        )
        .join("\n");
      sections.push(`🗓 Перенесены задачи:\n${lines}`);
    }

    if (result.notes && result.notes.length > 0) {
      const notes = result.notes.filter(
        (note): note is string => typeof note === "string" && note.length > 0
      );
      const [firstNote, ...otherNotes] = notes;
      if (firstNote) {
        sections.push(
          otherNotes.length === 0
            ? `📝 Комментарий: ${escapeMarkdown(firstNote)}`
            : `📝 Комментарии:\n${[firstNote, ...otherNotes]
                .map((note) => `• ${escapeMarkdown(note)}`)
                .join("\n")}`
        );
      }
    }

    if (result.errors.length > 0) {
      sections.push(
        `⚠️ Ошибки:\n${result.errors
          .map((error) => escapeMarkdown(error))
          .join("\n")}`
      );
    }

    const text = sections.length
      ? sections.join("\n\n")
      : "ℹ️ Не потребовалось менять задачи.";

    return { text, parseMode: "Markdown" };
  });

const formatListTasksResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") {
      return { text: "❌ Не удалось получить список задач." };
    }

    const result = output as ListTasksResult;

    if (result.success !== true) {
      const message = result.error?.trim();
      return {
        text: message
          ? `❌ ${escapeMarkdown(message)}`
          : "❌ Не удалось получить список задач.",
        parseMode: "Markdown",
      };
    }

    const { tasks, filters, context } = result;
    const locale = context.locale;
    const timezone = context.timezone;

    const headerLines: string[] = [];
    const filterParts: string[] = [];

    if (filters.status && filters.status.length > 0) {
      const statuses = filters.status.map((status) => {
        const emoji = taskStatusEmoji[status] ?? "•";
        const label = taskStatusLabel[status] ?? status;
        return `${emoji} ${label}`;
      });
      filterParts.push(`по статусу: ${statuses.join(", ")}`);
    }

    if (filters.start && filters.end) {
      const start = new Date(filters.start);
      const end = new Date(filters.end);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        const formatter = new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeZone: timezone,
        });
        filterParts.push(
          `период: ${formatter.format(start)} — ${formatter.format(end)}`
        );
      }
    }

    if (filters.includeWithoutDue) {
      filterParts.push("включая задачи без срока");
    }

    headerLines.push(
      `📋 Задачи (${tasks.length}${filters.limit ? ` / ${filters.limit}` : ""})`
    );

    if (filterParts.length > 0) {
      headerLines.push(`Фильтры: ${filterParts.join("; ")}`);
    }

    if (tasks.length === 0) {
      headerLines.push("ℹ️ Под условия не нашлось задач.");
      return {
        text: headerLines.map((line) => escapeMarkdown(line)).join("\n"),
        parseMode: "Markdown",
        metadata: {
          filters,
          count: 0,
        },
      };
    }

    const lines = tasks.map((task) => {
      const emoji = taskStatusEmoji[task.status] ?? "•";
      const title = escapeMarkdown(task.title.trim());
      const dueLabel = formatDueDate(task.dueAt, {
        locale,
        timeZone: timezone,
      });
      const details: string[] = [];
      if (dueLabel !== "—") {
        details.push(`до ${escapeMarkdown(dueLabel)}`);
      }
      if (task.status !== "todo") {
        details.push(taskStatusLabel[task.status] ?? task.status);
      }
      const suffix = details.length ? ` (${details.join(", ")})` : "";
      return `${emoji} #${task.id} — ${title}${suffix}`;
    });

    const text = [
      ...headerLines.map((line) => escapeMarkdown(line)),
      ...lines,
    ].join("\n");

    return {
      text,
      parseMode: "Markdown",
      metadata: {
        filters,
        count: tasks.length,
        timezone,
      },
    };
  });

export interface TaskToolsOptions {
  readonly userSettings?: {
    readonly timezone?: string;
    readonly locale?: string;
    readonly preferences?: Record<string, unknown> | null;
  };
}

export const createTaskTools = (
  userId: number,
  options: TaskToolsOptions = {}
) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;

    const rawTimezone = options.userSettings?.timezone?.trim();
    const rawLocale = options.userSettings?.locale?.trim();

    const resolvedTimezone = (() => {
      const fallback = "UTC";
      if (!rawTimezone) return fallback;
      try {
        // Validate timezone; throws RangeError for invalid values.
        new Intl.DateTimeFormat("en-US", { timeZone: rawTimezone }).format();
        return rawTimezone;
      } catch {
        return fallback;
      }
    })();

    const resolvedLocale = rawLocale && rawLocale.length > 0 ? rawLocale : "ru-RU";

    const formatOptions: FormatDueDateOptions = {
      locale: resolvedLocale,
      timeZone: resolvedTimezone,
    };

    const now = new Date();
    const isoNow = now.toISOString();
    let localizedNow = isoNow;
    try {
      localizedNow = new Intl.DateTimeFormat(resolvedLocale, {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: resolvedTimezone,
      }).format(now);
    } catch {
      // Keep ISO fallback if Intl fails
    }

    const manageTool = tool({
      description:
        "Синхронизирует список задач: передай списки на создание, обновление, завершение, удаление или перенос.",
      inputSchema: ManageTasksSchema,
      execute: async (raw) => {
        const input = ManageTasksSchema.parse(raw);
        const effect = applyManageTasks(repo, userId, input, formatOptions).pipe(
          Effect.catchAll((cause) =>
            Effect.succeed({
              success: false,
              summary: emptySummary(),
              errors: [
                cause instanceof Error && cause.message
                  ? cause.message
                  : "Не удалось обработать задачи",
              ],
              formatOptions,
            } satisfies ManageTasksResult)
          )
        );
        return await Effect.runPromise(effect);
      },
    });

    const listTool = tool({
      description:
        "Возвращает задачи пользователя по заданным фильтрам: статус, интервал дат, лимит выборки.",
      inputSchema: ListTasksSchema,
      execute: async (raw) => {
        const input: ListTasksInput = ListTasksSchema.parse(raw);
        const limit = input.limit ?? 50;
        const statuses = input.status
          ? Array.isArray(input.status)
            ? Array.from(new Set(input.status))
            : [input.status]
          : undefined;

        const dueFrom = input.start ? new Date(input.start) : undefined;
        const dueTo = input.end ? new Date(input.end) : undefined;

        const effect = repo
          .listByFilters(userId, {
            status: statuses,
            dueFrom,
            dueTo,
            includeWithoutDue: input.includeWithoutDue ?? false,
            limit,
          })
          .pipe(
            Effect.map((tasks) => {
              const result: ListTasksSuccessResult = {
                success: true,
                tasks: tasks.map((task) => ({
                  id: task.id,
                  title: task.title,
                  status: task.status,
                  dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
                })),
                filters: {
                  status: statuses,
                  start: input.start,
                  end: input.end,
                  includeWithoutDue: input.includeWithoutDue ?? false,
                  limit,
                },
                context: {
                  locale: resolvedLocale,
                  timezone: resolvedTimezone,
                },
              };
              return result;
            })
          )
          .pipe(
            Effect.catchAll((cause) => {
              const fallback: ListTasksFailureResult = {
                success: false,
                error:
                  cause instanceof Error && cause.message
                    ? cause.message
                    : "Не удалось получить список задач",
              };
              return Effect.succeed(fallback);
            })
          );

        return await Effect.runPromise(effect);
      },
    });

    const openTasksForContext = yield* repo
      .listOpen(userId, 50)
      .pipe(Effect.catchAll(() => Effect.succeed([] as RepoTask[])));

    const contextMessages: CoreMessage[] = [
      {
        role: "system",
        content: [
          `Текущая дата и время пользователя: ${localizedNow} (${resolvedTimezone}).`,
          `ISO-время сейчас: ${isoNow}.`,
          `Предпочитаемая локаль: ${resolvedLocale}.`,
          "При планировании учитывай таймзону и возвращай даты в ISO-формате.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    if (openTasksForContext.length > 0) {
      contextMessages.push({
        role: "system",
        content: [
          "Вот актуальные незавершённые задачи пользователя.",
          "Используй их, чтобы закрывать, обновлять или переносить элементы.",
          "Формат: #id — название (срок).",
          openTasksForContext
            .map((task) => {
              const due = formatDueDate(task.dueAt, formatOptions);
              const title = task.title.replace(/\s+/g, " ").trim();
              return `#${task.id} — ${title}${
                due !== "—" ? ` (до ${due})` : ""
              }`;
            })
            .join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }

    return {
      tools: {
        manageTasks: manageTool,
        listTasks: listTool,
      },
      formatters: {
        manageTasks: formatManageResult,
        listTasks: formatListTasksResult,
      },
      progressMessages: {
        manageTasks: "Синхронизирую список задач...",
        listTasks: "Собираю задачи...",
      },
      contextMessages,
    } as const;
  });
