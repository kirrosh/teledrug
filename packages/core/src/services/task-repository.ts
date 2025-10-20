import { Effect, Context, Layer, Data } from "effect";
import {
  and,
  or,
  eq,
  gte,
  lte,
  isNull,
  ilike,
  asc,
  desc,
  inArray,
  isNotNull,
  type SQL,
} from "drizzle-orm";
import { db, tasks, type Task, type NewTask } from "@teledrug/db";
import { getDayBoundsInTimezone, normalizeTimezone } from "@teledrug/timezone";

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
  readonly listForToday: (
    userId: number,
    limit?: number,
    options?: {
      readonly timezone?: string;
      readonly now?: Date;
    }
  ) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  readonly countOverdue: (userId: number, now?: Date) => Effect.Effect<number, TaskRepositoryError>;
  readonly listOpen: (userId: number, limit?: number) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  readonly listByFilters: (
    userId: number,
    filters: {
      readonly status?: ReadonlyArray<string> | string;
      readonly dueFrom?: Date;
      readonly dueTo?: Date;
      readonly includeWithoutDue?: boolean;
      readonly limit?: number;
    }
  ) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
  readonly delete: (taskId: number, userId: number) => Effect.Effect<boolean, TaskRepositoryError>;
  readonly update: (
    taskId: number,
    userId: number,
    patch: { readonly title?: string; readonly dueAt?: Date | null; readonly status?: string }
  ) => Effect.Effect<Task, TaskRepositoryError>;
  readonly findById: (taskId: number, userId: number) => Effect.Effect<Task | null, TaskRepositoryError>;
  readonly findByTitleLike: (
    userId: number,
    query: string,
    limit?: number
  ) => Effect.Effect<ReadonlyArray<Task>, TaskRepositoryError>;
}

export const TaskRepository = Context.GenericTag<TaskRepository>("@services/TaskRepository");

interface ResolveInput {
  readonly id?: number;
  readonly titleLike?: string;
}

const normalizeTitle = (value: string | undefined | null) =>
  value ? value.trim() : undefined;

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

  const listForToday: TaskRepository["listForToday"] = (
    userId,
    limit = 3,
    options = {}
  ) =>
    Effect.tryPromise({
      try: async () => {
        const timeZone = normalizeTimezone(options.timezone ?? "UTC");
        const now = options.now ?? new Date();
        const { start, end } = getDayBoundsInTimezone(now, timeZone);
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

        const sorted = rows.sort((a, b) => {
          const ad = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          const bd = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          return ad - bd;
        });
        return sorted.slice(0, limit);
      },
      catch: (cause) =>
        new TaskRepositoryError({
          message: "Не удалось получить задачи на сегодня",
          cause,
        }),
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

  const listByFilters: TaskRepository["listByFilters"] = (
    userId,
    { status, dueFrom, dueTo, includeWithoutDue = false, limit = 50 }
  ) =>
    Effect.tryPromise({
      try: async () => {
        const normalizedLimit = Math.max(1, Math.min(limit, 200));
        const statuses = Array.isArray(status)
          ? status.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : typeof status === "string" && status.trim().length > 0
          ? [status]
          : undefined;

        const conditions: Array<SQL<unknown>> = [eq(tasks.userId, userId)];

        if (statuses && statuses.length > 0) {
          const normalizedStatuses = Array.from(
            new Set(statuses.map((value) => value.trim()))
          );
          if (normalizedStatuses.length > 0) {
            const statusCondition =
              normalizedStatuses.length === 1
                ? eq(tasks.status, normalizedStatuses[0]!)
                : inArray(tasks.status, normalizedStatuses);
            conditions.push(statusCondition as SQL<unknown>);
          }
        }

        if (dueFrom || dueTo) {
          const dueClauses: Array<SQL<unknown>> = [];

          if (!includeWithoutDue) {
            dueClauses.push(isNotNull(tasks.dueAt));
          }

          if (dueFrom) {
            dueClauses.push(gte(tasks.dueAt, dueFrom));
          }

          if (dueTo) {
            dueClauses.push(lte(tasks.dueAt, dueTo));
          }

          if (dueClauses.length > 0) {
            const dueCondition =
              dueClauses.length === 1
                ? dueClauses[0]!
                : (and(...dueClauses) as SQL<unknown>);
            conditions.push(dueCondition as SQL<unknown>);
          }
        }

        const whereCondition =
          conditions.length === 1 ? conditions[0]! : (and(...conditions) as SQL<unknown>);

        const rows = await db
          .select()
          .from(tasks)
          .where(whereCondition)
          .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
          .limit(normalizedLimit);

        return rows;
      },
      catch: (cause) =>
        new TaskRepositoryError({
          message: "Не удалось получить список задач",
          cause,
        }),
    });

  const deleteTask: TaskRepository["delete"] = (taskId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const [row] = await db
          .delete(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .returning({ id: tasks.id });
        return Boolean(row);
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось удалить задачу", cause }),
    });

  const updateTask: TaskRepository["update"] = (taskId, userId, patch) =>
    Effect.tryPromise({
      try: async () => {
        const updates: Partial<Task> = {
          updatedAt: new Date(),
        };

        const title = normalizeTitle(patch.title);
        if (title !== undefined) {
          updates.title = title;
        }

        if (patch.dueAt !== undefined) {
          updates.dueAt = patch.dueAt;
        }

        if (patch.status !== undefined) {
          updates.status = patch.status;
        }

        const [row] = await db
          .update(tasks)
          .set(updates)
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .returning();

        if (!row) {
          throw new Error("Task not found");
        }

        return row as Task;
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось обновить задачу", cause }),
    });

  const findById: TaskRepository["findById"] = (taskId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const [row] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
          .limit(1);
        return row ?? null;
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось получить задачу", cause }),
    });

  const findByTitleLike: TaskRepository["findByTitleLike"] = (userId, query, limit = 5) =>
    Effect.tryPromise({
      try: async () => {
        const pattern = `%${query.replace(/%/g, "\\%")}%`;
        const rows = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.userId, userId), ilike(tasks.title, pattern)))
          .orderBy(tasks.dueAt, tasks.title)
          .limit(limit);
        return rows;
      },
      catch: (cause) => new TaskRepositoryError({ message: "Не удалось найти задачи", cause }),
    });

  const repo = TaskRepository.of({
    create,
    complete,
    listForToday,
    countOverdue,
    listOpen,
    listByFilters,
    delete: deleteTask,
    update: updateTask,
    findById,
    findByTitleLike,
  });

  return repo;
});

export const TaskRepositoryLive = Layer.effect(TaskRepository, makeTaskRepository);
