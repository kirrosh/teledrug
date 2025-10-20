import { Effect, Context, Layer, Data, Option } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  journalEntries,
  journalEntryTags,
  journalTags,
  type JournalEntry,
  type NewJournalEntry,
  type JournalTag,
} from "@teledrug/db";
import type { JournalAnalysisResult } from "../journal/model";

export class JournalRepositoryError extends Data.TaggedError("JournalRepositoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class JournalEntryNotFoundError extends Data.TaggedError("JournalEntryNotFoundError")<{
  readonly entryId: number;
}> {}

export interface CreateJournalEntryInput {
  readonly userId: number;
  readonly content: string;
  readonly entryDate?: Date;
  readonly analysis: JournalAnalysisResult;
}

export interface JournalRepository {
  readonly createEntry: (
    input: CreateJournalEntryInput
  ) => Effect.Effect<JournalEntry, JournalRepositoryError>;
  readonly deleteEntry: (
    entryId: number,
    userId: number
  ) => Effect.Effect<boolean, JournalRepositoryError>;
  readonly findEntry: (
    entryId: number,
    userId: number
  ) => Effect.Effect<Option.Option<JournalEntry>, JournalRepositoryError>;
}

export const JournalRepository = Context.GenericTag<JournalRepository>(
  "@services/JournalRepository"
);

const normalizeTags = (tags: ReadonlyArray<string>): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const trimmed = rawTag.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(trimmed);
    if (normalized.length >= 10) {
      break;
    }
  }

  return normalized;
};

const makeJournalRepository = Effect.sync(() => {
  const createEntry: JournalRepository["createEntry"] = ({
    userId,
    content,
    entryDate,
    analysis,
  }) =>
    Effect.tryPromise({
      try: async () =>
        db.transaction(async (trx) => {
          const tags = normalizeTags(analysis.tags ?? []);

          const entryDateIso = entryDate
            ? entryDate.toISOString().slice(0, 10)
            : undefined;

          const entryValues: NewJournalEntry = {
            userId,
            ...(entryDateIso ? { entryDate: entryDateIso } : {}),
            title: analysis.title,
            content,
            mood: analysis.mood,
            energy: analysis.energy,
            tags,
            aiMetadata: analysis.aiMetadata,
          };

          const [entry] = await trx
            .insert(journalEntries)
            .values(entryValues)
            .returning();

          if (!entry) {
            throw new Error("Failed to insert journal entry");
          }

          if (tags.length > 0) {
            const tagRecords = tags.map((name) => ({
              userId,
              name,
            }));

            if (tagRecords.length > 0) {
              await trx
                .insert(journalTags)
                .values(tagRecords)
                .onConflictDoNothing({
                  target: [journalTags.userId, journalTags.name],
                });

              const existingTags = await trx
                .select()
                .from(journalTags)
                .where(
                  and(
                    eq(journalTags.userId, userId),
                    inArray(journalTags.name, tags)
                  )
                );

              if (existingTags.length > 0) {
                await trx
                  .insert(journalEntryTags)
                  .values(
                    existingTags.map((tag) => ({
                      entryId: entry.id,
                      tagId: tag.id,
                    }))
                  )
                  .onConflictDoNothing({
                    target: [journalEntryTags.entryId, journalEntryTags.tagId],
                  });
              }
            }
          }

          return entry satisfies JournalEntry;
        }),
      catch: (cause) =>
        new JournalRepositoryError({
          message: "Не удалось сохранить запись дневника",
          cause,
        }),
    });

  const deleteEntry: JournalRepository["deleteEntry"] = (entryId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const [deleted] = await db
          .delete(journalEntries)
          .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)))
          .returning({ id: journalEntries.id });

        return Boolean(deleted);
      },
      catch: (cause) =>
        new JournalRepositoryError({
          message: "Не удалось удалить запись дневника",
          cause,
        }),
    });

  const findEntry: JournalRepository["findEntry"] = (entryId, userId) =>
    Effect.tryPromise({
      try: async () => {
        const [entry] = await db
          .select()
          .from(journalEntries)
          .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)));

        return entry ?? null;
      },
      catch: (cause) =>
        new JournalRepositoryError({
          message: "Не удалось получить запись дневника",
          cause,
        }),
    }).pipe(Effect.map((entry) => Option.fromNullable(entry)));

  return JournalRepository.of({
    createEntry,
    deleteEntry,
    findEntry,
  });
});

export const JournalRepositoryLive = Layer.effect(
  JournalRepository,
  makeJournalRepository
);
