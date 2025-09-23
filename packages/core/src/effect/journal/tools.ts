import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";
import { JournalAnalysisService } from "../services/journal-analysis";
import { JournalRepository } from "../services/journal-repository";
import { energyEmojiMap, moodEmojiMap } from "./model";
import type { ToolResultFormatter } from "../types/integrations";
import { generateText, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { TaskRepository } from "../services/task-repository";

const CreateJournalEntrySchema = z.object({
  content: z.string().min(1, "Текст записи не может быть пустым"),
  entryDate: z.string().optional(),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
});

const parseOptionalDate = (value: string | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const combineTags = (
  aiTags: ReadonlyArray<string>,
  manualTags: ReadonlyArray<string> | undefined
): ReadonlyArray<string> => {
  if (!manualTags || manualTags.length === 0) {
    return aiTags;
  }
  const combined: string[] = [];
  const seen = new Set<string>();

  for (const tag of [...manualTags, ...aiTags]) {
    const cleaned = tag.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combined.push(cleaned);
    if (combined.length >= 10) {
      break;
    }
  }

  return combined;
};

export interface CreateJournalEntryResult {
  readonly entryId: number;
  readonly title: string;
  readonly content: string;
  readonly mood: string;
  readonly energy: string;
  readonly moodEmoji: string;
  readonly energyEmoji: string;
  readonly entryDate: string;
  readonly tags: ReadonlyArray<string>;
  readonly suggestions?: ReadonlyArray<{
    title: string;
    dueAt?: string | null;
  }>;
  readonly completeSuggestions?: ReadonlyArray<{ title: string }>;
}

const escapeMarkdown = (value: string): string =>
  value.replace(/[\\_\*\[\]\(\)~`>#+=|{}.!-]/g, (match) => `\\${match}`);

const formatCreateJournalEntryResult: ToolResultFormatter = (output) =>
  Effect.sync(() => {
    if (!output || typeof output !== "object") {
      return {
        text: "❌ Не удалось обработать запись дневника.",
      };
    }

    const result = output as
      | { success: true; data: CreateJournalEntryResult }
      | { success?: false; error?: string };

    if (!result.success) {
      const message = result.error?.trim();
      return {
        text: message
          ? `❌ ${escapeMarkdown(message)}`
          : "❌ Не удалось сохранить запись дневника.",
        parseMode: "Markdown",
      };
    }

    const data = result.data;
    const date = new Date(data.entryDate);
    const isValidDate = !Number.isNaN(date.getTime());
    const dateLabel = isValidDate
      ? date.toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year:
            date.getFullYear() !== new Date().getFullYear()
              ? "numeric"
              : undefined,
        })
      : "Сегодня";

    const body = escapeMarkdown(data.content.trim());
    const tagsLine = data.tags.length
      ? `\n\nТеги: ${data.tags
          .map((tag) => `#${escapeMarkdown(tag.replace(/\s+/g, "_"))}`)
          .join(" ")}`
      : "";

    const suggestions = Array.isArray((data as any).suggestions)
      ? ((data as any).suggestions as ReadonlyArray<{
          title: string;
          dueAt?: string | null;
        }>)
      : [];
    const completeSuggestions = Array.isArray((data as any).completeSuggestions)
      ? ((data as any).completeSuggestions as ReadonlyArray<{ title: string }>)
      : [];

    const suggestionLines = suggestions.length
      ? `\n\n🧩 Предложения задач:\n${suggestions
          .slice(0, 5)
          .map(
            (s) =>
              `• ${escapeMarkdown(s.title)}${
                s.dueAt
                  ? ` — до ${escapeMarkdown(
                      new Date(s.dueAt).toLocaleDateString("ru-RU")
                    )}`
                  : ""
              }`
          )
          .join("\n")}`
      : "";
    const completeLines = completeSuggestions.length
      ? `\n\n✅ Возможно выполнено:\n${completeSuggestions
          .map((c) => `• ${escapeMarkdown(c.title)}`)
          .join("\n")}`
      : "";

    const text = `${data.moodEmoji} ${data.energyEmoji} *${escapeMarkdown(
      data.title
    )}*\n_${escapeMarkdown(
      dateLabel
    )}_\n\n${body}${tagsLine}${suggestionLines}${completeLines}`;

    // Inline buttons: optional quick-create for a single suggestion, and delete
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    if (suggestions.length === 1 && suggestions[0]) {
      const ymd = suggestions[0].dueAt
        ? new Date(suggestions[0].dueAt)
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, "")
        : "0";
      buttons.push([
        {
          text: "➕ Создать задачу",
          callback_data: `journal:createTask:${data.entryId}:${ymd}`,
        },
      ]);
    }
    buttons.push([
      {
        text: "🗑 Удалить",
        callback_data: `journal:delete:${data.entryId}`,
      },
    ]);

    return {
      text,
      parseMode: "Markdown",
      metadata: {
        entryId: data.entryId,
      },
      replyMarkup: {
        inline_keyboard: buttons,
      },
    };
  });

export const createJournalTools = (userId: number) =>
  Effect.gen(function* () {
    const analysisService = yield* JournalAnalysisService;
    const repository = yield* JournalRepository;
    const tasksRepo = yield* TaskRepository;

    const model = openai("gpt-5-nano");

    const extractTasksAI = (
      content: string,
      existingTasks: ReadonlyArray<{ id: number; title: string }>
    ) =>
      Effect.tryPromise(async () => {
        const existing = existingTasks.map((t) => `- ${t.title}`).join("\n");
        const system = `Ты помощник по планированию. На входе — текст дневниковой записи пользователя и список его актуальных задач. Задача — предложить задачи для создания и кандидатов на завершение. Верни данные строго по схеме.`;
        const user = `Запись:\n"""\n${content}\n"""\n\nАктуальные задачи:\n${
          existing || "(нет)"
        }`;
        const schema = z.object({
          create: z
            .array(
              z.object({
                title: z.string().min(1),
                dueAt: z.string().optional().nullable(),
              })
            )
            .default([]),
          complete: z
            .array(
              z.object({
                title: z.string().min(1),
              })
            )
            .default([]),
        });
        const { object } = await generateObject({
          model,
          schema,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        });
        return {
          create: object.create.slice(0, 5),
          complete: object.complete.slice(0, 5),
        } as { create: Array<{ title: string; dueAt?: string | null }>; complete: Array<{ title: string }> };
      }).pipe(
        Effect.catchAll(() => Effect.succeed({ create: [], complete: [] }))
      );

    // (Heuristic extractor removed; using AI-based extractor above)

    const createEntryTool = tool({
      description:
        "Создаёт запись в дневнике пользователя. Используй, когда сообщение похоже на личную дневниковую заметку без явных указаний на задачи, события или запросы.",
      inputSchema: CreateJournalEntrySchema,
      execute: async (rawInput) => {
        const input = CreateJournalEntrySchema.parse(rawInput);
        const content = input.content.trim();
        if (!content) {
          return {
            success: false,
            error: "Пустая запись дневника",
          };
        }

        const effect = Effect.gen(function* () {
          const analysis = yield* analysisService.analyze({ content });
          const combinedTags = combineTags(analysis.tags, input.tags);

          const entry = yield* repository.createEntry({
            userId,
            content,
            entryDate: parseOptionalDate(input.entryDate),
            analysis: {
              ...analysis,
              tags: combinedTags,
            },
          });

          const entryDateValue =
            entry.entryDate instanceof Date
              ? entry.entryDate
              : new Date(entry.entryDate);
          const entryDate = Number.isNaN(entryDateValue.getTime())
            ? new Date().toISOString()
            : entryDateValue.toISOString();

          const existingOpen = yield* tasksRepo
            .listOpen(userId, 20)
            .pipe(Effect.catchAll(() => Effect.succeed([])));
          const ai = yield* extractTasksAI(
            content,
            existingOpen.map((t) => ({ id: t.id, title: t.title }))
          );
          const suggestions = ai.create.map((s) => ({
            title: s.title.trim(),
            dueAt:
              s.dueAt && s.dueAt.trim().length > 0
                ? new Date(s.dueAt).toISOString()
                : null,
          }));

          const data: CreateJournalEntryResult = {
            entryId: entry.id,
            title: entry.title,
            content: entry.content,
            mood: entry.mood,
            energy: entry.energy,
            moodEmoji: moodEmojiMap[entry.mood],
            energyEmoji: energyEmojiMap[entry.energy],
            entryDate,
            tags: entry.tags,
            suggestions,
            completeSuggestions: ai.complete.map((c) => ({
              title: c.title.trim(),
            })),
          };

          return {
            success: true as const,
            data,
          };
        });

        const result = await Effect.runPromise(
          effect.pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Не удалось сохранить запись дневника",
              })
            )
          )
        );

        return result;
      },
    });

    return {
      tools: {
        createJournalEntry: createEntryTool,
      },
      formatters: {
        createJournalEntry: formatCreateJournalEntryResult,
      },
      progressMessages: {
        createJournalEntry: "Сохраняю запись в дневник...",
      },
    } as const;
  });
