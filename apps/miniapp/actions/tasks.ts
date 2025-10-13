"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorizedAction } from "@/actions/action-client";
import type { Task as TaskDto, TasksResponse } from "@/types/api";
import { db, tasks, type Task } from "@teledrug/db";

const serializeTask = (task: Task): TaskDto => ({
  id: task.id,
  title: task.title,
  status: task.status,
  dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
});

const listTasksSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    status: z.string().min(1).optional(),
  })
  .optional();

interface FetchTasksParams {
  limit?: number;
  status?: string;
}

export const fetchTasksForUser = async (
  userId: number,
  params: FetchTasksParams = {},
): Promise<TaskDto[]> => {
  const limit = params.limit ?? 50;
  const status = params.status?.trim() || undefined;

  const filters = status
    ? and(eq(tasks.userId, userId), eq(tasks.status, status))
    : eq(tasks.userId, userId);

  const rows = await db
    .select()
    .from(tasks)
    .where(filters)
    .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
    .limit(limit);

  return rows.map(serializeTask);
};

export const listTasksAction = authorizedAction
  .inputSchema(listTasksSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { session } = ctx;
    const userId = session.telegram!.id;
    const tasks = await fetchTasksForUser(userId, {
      limit: parsedInput?.limit,
      status: parsedInput?.status,
    });

    return { tasks } satisfies TasksResponse;
  });
