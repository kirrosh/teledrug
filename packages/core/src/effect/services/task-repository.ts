import { Effect, Context, Layer, Data } from "effect";
import { and, or, eq, gte, lte, isNull } from "drizzle-orm";
import { tasks, type Task, type NewTask } from "../../storage/database/schema";
import { db } from "../../storage/database/client";

export class TaskRepositoryError extends Data.TaggedError("TaskRepositoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface CreateTaskInput {
  readonly userId: number;
  readonly title: string;
  readonly dueAt?: Date | null;
}

export interface TaskRepository {
  readonly create: (input: CreateTaskInput) => Effect.Effect<Task, TaskRepositoryError>;
  readonly complete: (taskId: number, userId: number) => Effect.Effect<boolean, TaskRepositoryError>;
  readonly listForToday: (userId: number, limit?: number) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  readonly countOverdue: (userId: number, now?: Date) => Effect.Effect<number, TaskRepositoryError>;
  readonly listOpen: (userId: number, limit?: number) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
}

export const TaskRepository = Context.GenericTag<TaskRepository>("@services/TaskRepository");

// no-op

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const makeTaskRepository = Effect.sync(() => {
  const create: TaskRepository["create"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const values: NewTask = {
          userId: input.userId,
          title: input.title.trim(),
          status: "todo",
          dueAt: input.dueAt ?? null,
        } as NewTask;

        const [row] = await db.insert(tasks).values(values).returning();
        if (!row) throw new Error("Failed to insert task");
        return row as Task;
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось создать задачу", cause }),
    });

  const complete: TaskRepository["complete"] = (taskId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const [row] = await db
          .update(tasks)
          .set({ status: "done", updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .returning({ id: tasks.id });
        return Boolean(row);
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось завершить задачу", cause }),
    });

  const listForToday: TaskRepository["listForToday"] = (userId, limit = 3) =>
    Effect.tryPromise({
      try: async () => {
        const start = startOfDay(new Date());
        const end = endOfDay(new Date());
        const rows = await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.userId, userId),
              eq(tasks.status, "todo"),
              or(
                and(gte(tasks.dueAt, start), lte(tasks.dueAt, end)),
                isNull(tasks.dueAt)
              )
            )
          )
          .limit(50);

        // Sort: earliest due first
        const sorted = rows.sort((a, b) => {
          const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return ad - bd;
        });
        return sorted.slice(0, limit);
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось получить задачи на сегодня", cause }),
    });

  const countOverdue: TaskRepository["countOverdue"] = (userId, now = new Date()) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select({ id: tasks.id, dueAt: tasks.dueAt })
          .from(tasks)
          .where(and(eq(tasks.userId, userId), eq(tasks.status, "todo")));
        const nowTs = now.getTime();
        const count = rows.reduce((acc, row) => {
          const due = row.dueAt ? new Date(row.dueAt as unknown as string).getTime() : undefined;
          if (due !== undefined && due < nowTs) return acc + 1;
          return acc;
        }, 0);
        return count;
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось посчитать просроченные задачи", cause }),
    });

  const listOpen: TaskRepository["listOpen"] = (userId, limit = 20) =>
    Effect.tryPromise({
      try: async () => {
        const rows = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.userId, userId), eq(tasks.status, "todo")))
          .limit(limit);
        return rows;
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось получить список задач", cause }),
    });

  return TaskRepository.of({ create, complete, listForToday, countOverdue, listOpen });
});

export const TaskRepositoryLive = Layer.effect(TaskRepository, makeTaskRepository);
