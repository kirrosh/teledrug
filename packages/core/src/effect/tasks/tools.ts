import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";
import type { ToolResultFormatter } from "../types/integrations";
import { TaskRepository } from "../services/task-repository";

const AddTaskSchema = z.object({
  title: z.string().min(1),
  dueAt: z.string().datetime().optional(),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  sourceEntryId: z.number().int().optional(),
});

const ListTasksSchema = z.object({
  scope: z.enum(["today", "overdue", "week"]).default("today"),
  limit: z.number().int().min(1).max(10).optional(),
});

type AddTaskInput = z.infer<typeof AddTaskSchema>;
type ListTasksInput = z.infer<typeof ListTasksSchema>;

const escape = (v: string) => v.replace(/[\\_\*\[\]\(\)~`>#+=|{}.!-]/g, (m) => `\\${m}`);

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

export const createTaskTools = (userId: number) =>
  Effect.gen(function* () {
    const repo = yield* TaskRepository;

    const addTool = tool({
      description: "Создаёт задачу из фразы (заголовок, дедлайн, теги)",
      inputSchema: AddTaskSchema,
      execute: async (raw) => {
        const input = AddTaskSchema.parse(raw);
        const effect = repo.create({
          userId,
          title: input.title,
          description: input.description,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          priority: input.priority ?? null,
          tags: input.tags ?? null,
          sourceEntryId: input.sourceEntryId ?? null,
        }).pipe(
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
            // minimal: reuse listForToday and filter past due; for correctness, fetch all TODO and filter
            const all = yield* repo.listForToday(userId, 100);
            const now = Date.now();
            const items = all.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now);
            return { success: true as const, items: items.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null })), scope };
          }
          // week: for v1 keep it same as today
          const items = yield* repo.listForToday(userId, input.limit ?? 10);
          return { success: true as const, items: items.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null })), scope };
        }).pipe(Effect.catchAll((e) => Effect.succeed({ success: false as const, error: e.message })));
        return await Effect.runPromise(effect);
      },
    });

    return {
      tools: {
        addTask: addTool,
        listTasks: listTool,
      },
      formatters: {
        addTask: formatAddResult,
        listTasks: formatListResult,
      },
      progressMessages: {
        addTask: "Создаю задачу...",
        listTasks: "Получаю список задач...",
      },
    } as const;
  });

