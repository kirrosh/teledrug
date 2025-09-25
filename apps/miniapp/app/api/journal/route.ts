import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { getReadonlySession } from "@/lib/session";

import { db } from "@teledrug/core/storage/database/client";
import {
  journalEntries,
  type JournalEntry,
} from "@teledrug/core/storage/database/schema";

export const runtime = "nodejs";

interface SerializedJournalEntry {
  id: number;
  title: string;
  content: string;
  entryDate: string;
  mood: string;
  energy: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const serializeEntry = (entry: JournalEntry): SerializedJournalEntry => ({
  id: entry.id,
  title: entry.title,
  content: entry.content,
  entryDate: entry.entryDate instanceof Date ? entry.entryDate.toISOString() : new Date(entry.entryDate).toISOString(),
  mood: entry.mood,
  energy: entry.energy,
  tags: entry.tags ?? [],
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});

export async function GET(request: Request) {
  const session = await getReadonlySession();

  if (!session.isAuthorized || !session.telegram) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Number.parseInt(limitParam ?? "50", 10);
  const safeLimit = Number.isNaN(limit) || limit <= 0 ? 50 : Math.min(limit, 200);

  try {
    const rows = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.userId, session.telegram.id))
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
      .limit(safeLimit);

    return NextResponse.json({
      entries: rows.map(serializeEntry),
    });
  } catch (error) {
    console.error("Failed to load journal entries", error);
    return NextResponse.json({ error: "Failed to load journal entries" }, { status: 500 });
  }
}
