import { Experimental_Agent as Agent } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const createJournalEntry = {
  description: "Сохраняет запись в дневник пользователя с полями content и mood.",
  inputSchema: z.object({
    content: z.string().min(20),
    mood: z.string().min(3),
    tags: z.array(z.string()).optional(),
  }),
  execute: async (input: any) => {
    console.log(`  → Called createJournalEntry with content length: ${input.content.length}`);
    return { success: true, entryId: 910 };
  },
};

const createCalendarEvent = {
  description: "Создаёт событие в календаре с полями title, start, end, timezone.",
  inputSchema: z.object({
    title: z.string().min(5),
    start: z.string().min(10),
    end: z.string().min(10),
    timezone: z.string().default("Asia/Dubai"),
    location: z.string().optional(),
    description: z.string().optional(),
  }),
  execute: async (input: any) => {
    console.log(`  → Called createCalendarEvent with title: ${input.title}`);
    return { success: true, eventId: "cal_test" };
  },
};

const manageTasks = {
  description: "Пустышка для задач. Не должна вызываться.",
  inputSchema: z.object({}).passthrough(),
  execute: async () => {
    console.log(`  → Called manageTasks (should NOT be called!)`);
    return { success: true };
  },
};

const updateDigestSettings = {
  description: "Пустышка для дайджеста. Не должна вызываться.",
  inputSchema: z.object({}).passthrough(),
  execute: async () => {
    console.log(`  → Called updateDigestSettings (should NOT be called!)`);
    return { success: true };
  },
};

const updateUserSettings = {
  description: "Пустышка для настроек. Не должна вызываться.",
  inputSchema: z.object({}).passthrough(),
  execute: async () => {
    console.log(`  → Called updateUserSettings (should NOT be called!)`);
    return { success: true };
  },
};

async function testModel(modelName: string) {
  console.log(`\nTesting ${modelName}...`);

  try {
    const agent = new Agent({
      model: openai(modelName),
      tools: {
        createJournalEntry,
        createCalendarEvent,
        manageTasks,
        updateDigestSettings,
        updateUserSettings,
      },
      maxOutputTokens: 800,
    });

    const longSystemPrompt = `You are a helpful AI assistant. Use the available tools to help the user.

When the user mentions a crypto event in Dubai, you should:
1. Create a journal entry about their decision
2. Create a calendar event for the dates mentioned`;

    const result = await agent.generate({
      system: longSystemPrompt,
      messages: [
        {
          role: "user",
          content: `Решил сходить на криптомероприятие в Дубае. Хочется понять насколько там есть что стоящее кроме скамеров спекулянтов и инфоциган.
Событие будет происходить тут
October 28-29 • UAE, DUBAI, Festival Arena`,
        },
      ],
    });

    console.log(`Text: ${result.text || "<empty>"}`);
    console.log(`Tool calls: ${result.toolCalls?.length || 0}`);
    console.log(`Tool results: ${result.toolResults?.length || 0}`);

    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log("✅ Model SUPPORTS tool calling");
      console.log("Tool calls:", result.toolCalls.map(c => c.toolName));
    } else {
      console.log("❌ Model DOES NOT support tool calling");
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

async function main() {
  const models = [
    "gpt-4o-mini",
    "gpt-5-mini-2025-08-07",
    "gpt-5-nano-2025-08-07",
    "gpt-5-mini",
    "gpt-5-nano",
  ];

  for (const model of models) {
    await testModel(model);
  }
}

main();
