import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";
import type { ToolResultFormatter } from "../types/integrations";
import { TaskRepository } from "../services/task-repository";
import type { TaskRepository as TaskRepositoryService } from "../services/task-repository";
import type { Task } from "../../storage/database/schema";

const AddTaskSchema = z.object({
  title: z.string().min(1),
  dueAt: z.string().datetime().optional(),
});

const ListTasksSchema = z.object({
  scope: z.enum(["today", "overdue", "week", "open"]).default("today"),
  limit: z.number().int().min(1).max(10).optional(),
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
  shift: z.union([
    z.literal("today"),
    z.literal("tomorrow"),
    z.literal("next_week"),
    z.string().regex(/^\+\d{1,3}days$/i),
  ]),
}).superRefine((value, ctx) => ensureIdentifier(value, ctx));

type AddTaskInput = z.infer<typeof AddTaskSchema>;
type ListTasksInput = z.infer<typeof ListTasksSchema>;
type IdentifyTaskInput = z.infer<typeof IdentifyTaskSchema>;
type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
type RescheduleTaskInput = z.infer<typeof RescheduleTaskSchema>;

const escape = (v: string) => v.replace(/[\\_\*\[\]\(\)~`>#+=|{}.!-]/g, (m) => `\\${m}`);

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
      const diff = ((8 - day) % 7) || 7; // до следующего понедельника
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

const formatAddResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") return { text: "❌ Не удалось создать задачу" };
    const result = output as { success?: boolean; data?: { id: number; title: string }; error?: string };
    if (!result.success || !result.data) {
      const err = result.error?.trim();
      return { text: err ? `❌ ${escape(err)}` : "❌ Не удалось создать задачу", parseMode: "Markdown" };
    }
    return { text: `✅ Задача создана: *${escape(result.data.title)}*`, parseMode: "Markdown" };
  });

const formatListResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") return { text: "❌ Не удалось получить список задач" };
    const result = output as { success?: boolean; items?: Array<{ id: number; title: string; dueAt?: string | null }>; scope?: string };
    if (!result.success || !result.items) return { text: "❌ Не удалось получить список задач" };
    if (result.items.length === 0) return { text: "🧭 Задач нет" };
    const lines = result.items.map((t) => `• ${escape(t.title)}${t.dueAt ? ` — до ${escape(new Date(t.dueAt).toLocaleDateString("ru-RU"))}` : ""}`).join("\n");
    const header = result.scope === "overdue" ? "⏰ Просроченные задачи" : result.scope === "week" ? "🗓 Задачи на неделю" : "🧭 Сегодняшние задачи";
    return { text: `*${header}*\n${lines}`, parseMode: "Markdown" };
  });

const formatMutationResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") return { text: "❌ Операция не выполнена" };
    const result = output as
      | { success: true; message: string }
      | { success?: false; error?: string; suggestions?: Array<{ id: number; title: string }> };

    if (!result.success) {
      if (result.suggestions && result.suggestions.length > 0) {
        const lines = result.suggestions.map((task) => `• #${task.id} — ${escape(task.title)}`).join("\n");
        return {
          text: `⚠️ Найдено несколько задач:\n${lines}\nУточните номер задачи.`,
          parseMode: "Markdown",
        };
      }

      const message = result.error?.trim() || "Операция не выполнена";
      return { text: `⚠️ ${escape(message)}` };
    }

    return { text: result.message, parseMode: "Markdown" };
  });

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
      return { kind: "one", task: matches[0] } as const;
    }
    return { kind: "many", tasks: matches } as const;
  });

export const createTaskTools = (userId: number) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;

    const addTool = tool({
      description: "Создаёт задачу из фразы (заголовок, дедлайн, теги)",
      inputSchema: AddTaskSchema,
      execute: async (raw) => {
        const input = AddTaskSchema.parse(raw);
        const effect = repo
          .create({
            userId,
            title: input.title,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
          })
          .pipe(
          Effect.map((task) => ({ success: true as const, data: { id: task.id, title: task.title } })),
          Effect.catchAll((e) => Effect.succeed({ success: false as const, error: e.message }))
        );
        return await Effect.runPromise(effect);
      },
    });

    const listTool = tool({
      description: "Показывает задачи (сегодня/просрочено/неделя)",
      inputSchema: ListTasksSchema,
      execute: async (raw) => {
        const input = ListTasksSchema.parse(raw);
        const scope = input.scope ?? "today";
        const effect = Effect.gen(function* () {
          if (scope === "today") {
            const items = yield* repo.listForToday(userId, input.limit ?? 10);
            return { success: true as const, items: items.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null })), scope };
          }
          if (scope === "overdue") {
            const all = yield* repo.listOpen(userId, 200);
            const now = Date.now();
            const items = all
              .filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now)
              .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
            return { success: true as const, items: items.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null })), scope };
          }
          if (scope === "week") {
            const items = yield* repo.listOpen(userId, 100);
            const now = new Date();
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            const filtered = items.filter((t) => {
              if (!t.dueAt) return false;
              const due = new Date(t.dueAt);
              return due >= start && due <= end;
            });
            const normalized = filtered
              .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
              .slice(0, input.limit ?? 10);
            return {
              success: true as const,
              items: normalized.map((t) => ({
                id: t.id,
                title: t.title,
                dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null,
              })),
              scope,
            };
          }

          const items = yield* repo.listOpen(userId, input.limit ?? 10);
          return {
            success: true as const,
            items: items.map((t) => ({
              id: t.id,
              title: t.title,
              dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null,
            })),
            scope,
          };
        }).pipe(Effect.catchAll((e) => Effect.succeed({ success: false as const, error: e.message })));
        return await Effect.runPromise(effect);
      },
    });

    const completeTool = tool({
      description: "Отмечает задачу выполненной",
      inputSchema: IdentifyTaskSchema,
      execute: async (raw) => {
        const input = IdentifyTaskSchema.parse(raw);
        const effect = resolveTask(repo, userId, input).pipe(
          Effect.flatMap((resolved) =>
            Effect.gen(function* () {
              switch (resolved.kind) {
                case "none":
                  return {
                    success: false as const,
                    error: "Задача не найдена",
                  };
                case "many":
                  return {
                    success: false as const,
                    suggestions: toSuggestionList(resolved.tasks),
                  };
                case "one": {
                  const ok = yield* repo.complete(resolved.task.id, userId);
                  if (!ok) {
                    return {
                      success: false as const,
                      error: "Не удалось завершить задачу",
                    };
                  }
                  return {
                    success: true as const,
                    message: `✅ Задача завершена: *${escape(resolved.task.title)}*`,
                  };
                }
              }
            })
          ),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        );
        return await Effect.runPromise(effect);
      },
    });

    const deleteTool = tool({
      description: "Удаляет задачу",
      inputSchema: IdentifyTaskSchema,
      execute: async (raw) => {
        const input = IdentifyTaskSchema.parse(raw);
        const effect = resolveTask(repo, userId, input).pipe(
          Effect.flatMap((resolved) =>
            Effect.gen(function* () {
              switch (resolved.kind) {
                case "none":
                  return {
                    success: false as const,
                    error: "Задача не найдена",
                  };
                case "many":
                  return {
                    success: false as const,
                    suggestions: toSuggestionList(resolved.tasks),
                  };
                case "one": {
                  const ok = yield* repo.delete(resolved.task.id, userId);
                  if (!ok) {
                    return {
                      success: false as const,
                      error: "Не удалось удалить задачу",
                    };
                  }
                  return {
                    success: true as const,
                    message: `🗑 Задача удалена: *${escape(resolved.task.title)}*`,
                  };
                }
              }
            })
          ),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        );
        return await Effect.runPromise(effect);
      },
    });

    const updateTool = tool({
      description: "Обновляет название, срок или статус задачи",
      inputSchema: UpdateTaskSchema,
      execute: async (raw) => {
        const input = UpdateTaskSchema.parse(raw);
        const effect = resolveTask(repo, userId, input).pipe(
          Effect.flatMap((resolved) =>
            Effect.gen(function* () {
              switch (resolved.kind) {
                case "none":
                  return {
                    success: false as const,
                    error: "Задача не найдена",
                  };
                case "many":
                  return {
                    success: false as const,
                    suggestions: toSuggestionList(resolved.tasks),
                  };
                case "one": {
                  const dueAt =
                    input.set.dueAt === undefined
                      ? undefined
                      : input.set.dueAt === null
                      ? null
                      : new Date(input.set.dueAt);

                  const updated = yield* repo.update(resolved.task.id, userId, {
                    title: input.set.title,
                    dueAt,
                    status: input.set.status,
                  });

                  const statusLabel = updated.status === "done" ? "✅ выполнена" : updated.status === "cancelled" ? "🚫 отменена" : "🗓 активна";
                  const dueLabel = dueAt === undefined ? formatDueDate(updated.dueAt) : formatDueDate(dueAt);

                  return {
                    success: true as const,
                    message: `✏️ Обновлено: *${escape(updated.title)}*\nСтатус: ${statusLabel}\nСрок: ${escape(dueLabel)}`,
                  };
                }
              }
            })
          ),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        );
        return await Effect.runPromise(effect);
      },
    });

    const rescheduleTool = tool({
      description: "Переносит срок задачи на относительную дату",
      inputSchema: RescheduleTaskSchema,
      execute: async (raw) => {
        const input = RescheduleTaskSchema.parse(raw);
        const effect = resolveTask(repo, userId, input).pipe(
          Effect.flatMap((resolved) =>
            Effect.gen(function* () {
              switch (resolved.kind) {
                case "none":
                  return {
                    success: false as const,
                    error: "Задача не найдена",
                  };
                case "many":
                  return {
                    success: false as const,
                    suggestions: toSuggestionList(resolved.tasks),
                  };
                case "one": {
                  const dueAt = parseShift(input.shift.toLowerCase());
                  const updated = yield* repo.update(resolved.task.id, userId, {
                    dueAt,
                  });
                  return {
                    success: true as const,
                    message: `🗓 Срок обновлён: *${escape(updated.title)}* — ${escape(formatDueDate(updated.dueAt))}`,
                  };
                }
              }
            })
          ),
          Effect.catchAll((e) =>
            Effect.succeed({ success: false as const, error: e.message })
          )
        );
        return await Effect.runPromise(effect);
      },
    });

    return {
      tools: {
        addTask: addTool,
        listTasks: listTool,
        completeTask: completeTool,
        deleteTask: deleteTool,
        updateTask: updateTool,
        rescheduleTask: rescheduleTool,
      },
      formatters: {
        addTask: formatAddResult,
        listTasks: formatListResult,
        completeTask: formatMutationResult,
        deleteTask: formatMutationResult,
        updateTask: formatMutationResult,
        rescheduleTask: formatMutationResult,
      },
      progressMessages: {
        addTask: "Создаю задачу...",
        listTasks: "Получаю список задач...",
        completeTask: "Отмечаю задачу выполненной...",
        deleteTask: "Удаляю задачу...",
        updateTask: "Обновляю задачу...",
        rescheduleTask: "Переношу срок задачи...",
      },
    } as const;
  });
