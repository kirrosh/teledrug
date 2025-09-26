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

type ManageTasksInput = z.infer<typeof ManageTasksSchema>;
type IdentifyTaskInput = z.infer<typeof IdentifyTaskSchema>;
type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
type RescheduleTaskInput = z.infer<typeof RescheduleTaskSchema>;

const escapeMarkdown = (value: string): string =>
  value.replace(/[\\_\*\[\]\(\)~`>#+=|{}.!-]/g, (match) => `\\${match}`);

type RepoTask = Task;

type ResolveResult =
  | { readonly kind: "one"; readonly task: RepoTask }
  | { readonly kind: "many"; readonly tasks: ReadonlyArray<RepoTask> }
  | { readonly kind: "none" };

const formatDueDate = (dueAt: Date | string | null | undefined) => {
  if (!dueAt) return "—";
  const date = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
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
  input: ManageTasksInput
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
          const dueLabel = formatDueDate(dueAt ?? null);
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
              ? `до ${escapeMarkdown(formatDueDate(task.dueAt))}`
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
              ? `новый срок ${escapeMarkdown(formatDueDate(task.dueAt))}`
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

export const createTaskTools = (userId: number) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;

    const manageTool = tool({
      description:
        "Синхронизирует список задач: передай списки на создание, обновление, завершение, удаление или перенос.",
      inputSchema: ManageTasksSchema,
      execute: async (raw) => {
        const input = ManageTasksSchema.parse(raw);
        const effect = applyManageTasks(repo, userId, input).pipe(
          Effect.catchAll((cause) =>
            Effect.succeed({
              success: false,
              summary: emptySummary(),
              errors: [
                cause instanceof Error && cause.message
                  ? cause.message
                  : "Не удалось обработать задачи",
              ],
            } satisfies ManageTasksResult)
          )
        );
        return await Effect.runPromise(effect);
      },
    });

    const openTasksForContext = yield* repo
      .listOpen(userId, 50)
      .pipe(Effect.catchAll(() => Effect.succeed([] as RepoTask[])));

    const contextMessages: CoreMessage[] = openTasksForContext.length
      ? [
          {
            role: "system",
            content: [
              "Вот актуальные незавершённые задачи пользователя.",
              "Используй их, чтобы закрывать, обновлять или переносить элементы.",
              "Формат: #id — название (срок).",
              openTasksForContext
                .map((task) => {
                  const due = formatDueDate(task.dueAt);
                  const title = task.title.replace(/\s+/g, " ").trim();
                  return `#${task.id} — ${title}${
                    due !== "—" ? ` (до ${due})` : ""
                  }`;
                })
                .join("\n"),
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ]
      : [];

    return {
      tools: {
        manageTasks: manageTool,
      },
      formatters: {
        manageTasks: formatManageResult,
      },
      progressMessages: {
        manageTasks: "Синхронизирую список задач...",
      },
      contextMessages,
    } as const;
  });
