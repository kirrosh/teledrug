import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";

import { getReadonlySession } from "@/lib/session";

import { db } from "@teledrug/core/storage/database/client";
import { tasks, type Task } from "@teledrug/core/storage/database/schema";

export const runtime = "nodejs";

interface SerializedTask {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const serializeTask = (task: Task): SerializedTask => ({
  id: task.id,
  title: task.title,
  status: task.status,
  dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
});

export async function GET(request: Request) {
  const session = await getReadonlySession();

  if (!session.isAuthorized || !session.telegram) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const statusParam = url.searchParams.get("status");

  const limit = Number.parseInt(limitParam ?? "50", 10);
  const safeLimit = Number.isNaN(limit) || limit <= 0 ? 50 : Math.min(limit, 200);

  try {
    const rows = await db
      .select()
      .from(tasks)
      .where(
        statusParam
          ? and(eq(tasks.userId, session.telegram.id), eq(tasks.status, statusParam))
          : eq(tasks.userId, session.telegram.id),
      )
      .orderBy(asc(tasks.dueAt), desc(tasks.createdAt))
      .limit(safeLimit);

    return NextResponse.json({
      tasks: rows.map(serializeTask),
    });
  } catch (error) {
    console.error("Failed to load tasks", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}
