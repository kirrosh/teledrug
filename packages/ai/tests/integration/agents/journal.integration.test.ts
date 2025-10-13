import { expect } from "bun:test";
import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";

import { __testInternals } from "../../../src/agent";
import type { AIAgentConfig, SimpleChatContext } from "@teledrug/ai";
import type { IntegrationToolsBundle } from "@teledrug/ai";
import {
  buildSimpleContext,
  describeLLM,
  ensureOpenAIKey,
  forceToolContext,
  getModelName,
  isNetworkError,
  testLLM,
} from "./harness";

const { runDomainAgent, domainAgentDefinitions, buildMessages } = __testInternals;

describeLLM("Journal agent", () => {
  testLLM(
    "saves reflective entry via tool call",
    async () => {
    const openaiApiKey = ensureOpenAIKey();

    const context: SimpleChatContext = buildSimpleContext(
      "Сегодня чувствую вдохновение, хочу зафиксировать мысли о новом проекте и отметить благодарность коллегам",
      { userId: 101 }
    );

    const capturedInputs: Array<{ content: string; mood: string; tags?: string[] }> = [];

    const createJournalEntry = tool({
      description:
        "Сохраняет запись дневника. Передавай текст записи в поле content, а настроение в поле mood (например, 'вдохновлённый'). Добавляй массив tags при необходимости.",
      inputSchema: z.object({
        content: z.string().min(10),
        mood: z.string().min(3),
        tags: z.array(z.string().min(1)).max(5).optional(),
      }),
      execute: async (input) => {
        capturedInputs.push(input);
        return {
          success: true,
          data: {
            entryId: 501,
            title: "Новый проект",
            content: input.content,
            mood: input.mood,
            energy: "balanced",
            moodEmoji: "😊",
            energyEmoji: "⚖️",
            entryDate: new Date().toISOString(),
            tags: input.tags ?? [],
          },
        };
      },
    });

    const bundle: IntegrationToolsBundle = {
      tools: {
        createJournalEntry,
      },
      formatters: {},
      progressMessages: {},
      contextMessages: forceToolContext(
        "createJournalEntry",
        "Кратко перескажи эмоции и сохрани запись."
      ),
    };

    const baseMessages = buildMessages(context.messageContent, []);

    const config: AIAgentConfig = {
      openaiApiKey,
      model: getModelName(),
      maxTokens: 600,
      userId: context.userId,
    };

    const outcome = await Effect.runPromise(
      runDomainAgent(
        "journal",
        domainAgentDefinitions.journal,
        config,
        context,
        baseMessages,
        bundle
      ).pipe(
        Effect.map((execution) => ({ _tag: "ok" as const, execution })),
        Effect.catchAll((error) =>
          isNetworkError(error)
            ? Effect.succeed({ _tag: "network" as const, error })
            : Effect.fail(error)
        )
      )
    );

    if (outcome._tag === "network") {
      console.warn("[journal] skipping due to network error", outcome.error);
      return;
    }

    const execution = outcome.execution;

    expect(execution.result.toolCalls?.[0]?.toolName).toBe("createJournalEntry");
    expect(execution.result.toolResults?.[0]?.toolName).toBe("createJournalEntry");
    expect(capturedInputs).toHaveLength(1);
    const payload = capturedInputs[0];
    expect(payload.content.toLowerCase()).toContain("вдох");
    expect(payload.mood.toLowerCase()).toContain("вдох");
    },
    { timeout: 20000 }
  );
});
