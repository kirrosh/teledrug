"use server";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorizedAction } from "@/actions/action-client";
import type { JournalEntry as JournalEntryDto, JournalResponse } from "@/types/api";
import { db, journalEntries, type JournalEntry } from "@teledrug/db";

const serializeJournalEntry = (entry: JournalEntry): JournalEntryDto => ({
  id: entry.id,
  title: entry.title,
  content: entry.content,
  entryDate: new Date(entry.entryDate as string | number | Date).toISOString(),
  mood: entry.mood,
  energy: entry.energy,
  tags: entry.tags ?? [],
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});

const listJournalSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional();

interface FetchJournalParams {
  limit?: number;
}

export const fetchJournalEntriesForUser = async (
  userId: number,
  params: FetchJournalParams = {},
): Promise<JournalEntryDto[]> => {
  const limit = params.limit ?? 50;

  const rows = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.userId, userId))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit);

  return rows.map(serializeJournalEntry);
};

export const listJournalEntriesAction = authorizedAction
  .inputSchema(listJournalSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { session } = ctx;
    const userId = session.telegram!.id;
    const entries = await fetchJournalEntriesForUser(userId, {
      limit: parsedInput?.limit,
    });

    return { entries } satisfies JournalResponse;
  });
