import { expect } from "bun:test";
import { Effect } from "effect";
import { tool } from "ai";
import { z } from "zod";

import {
  __testInternals,
  type AIAgentConfig,
  type SimpleChatContext,
} from "../../../packages/core/src/effect/services/ai-agent";
import type { IntegrationToolsBundle } from "../../../packages/core/src/effect/services/integration-registry";
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

describeLLM("Calendar agent", () => {
  testLLM(
    "schedules a meeting with inferred defaults",
    async () => {
    const openaiApiKey = ensureOpenAIKey();

    const context: SimpleChatContext = buildSimpleContext(
      "Запланируй встречу с Машей завтра в 10:00 по Москве, длительность час",
      { userId: 303 }
    );

    const captured: Array<{ title: string; start: string; end: string; timezone: string }> = [];

    const createEventTool = tool({
      description:
        "Создаёт событие в календаре. Название пиши в title, дату и время начала в start (ISO строка), завершение в end.",
      inputSchema: z.object({
        title: z.string().min(3),
        start: z.string().min(10),
        end: z.string().min(10),
        timezone: z.string().default("Europe/Moscow"),
      }),
      execute: async (input) => {
        captured.push(input);
        return {
          success: true,
          data: {
            eventId: "evt_test_1",
            title: input.title,
            start: input.start,
            end: input.end,
            timezone: input.timezone,
          },
        };
      },
    });

    const bundle: IntegrationToolsBundle = {
      tools: {
        createCalendarEvent: createEventTool,
      },
      formatters: {},
      progressMessages: {},
      contextMessages: forceToolContext(
        "createCalendarEvent",
        "Определи дату и время события и обязательно создай запись."
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
        "calendar",
        domainAgentDefinitions.calendar,
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
      console.warn("[calendar] skipping due to network error", outcome.error);
      return;
    }

    const execution = outcome.execution;

      expect(execution.result.toolCalls?.[0]?.toolName).toBe("createCalendarEvent");
      expect(execution.result.toolResults?.[0]?.toolName).toBe("createCalendarEvent");
      expect(captured).toHaveLength(1);
      const payload = captured[0];
      expect(payload.title.toLowerCase()).toContain("встреч");
    expect(new Date(payload.start).getTime()).not.toBeNaN();
    expect(new Date(payload.end).getTime()).not.toBeNaN();
    },
    { timeout: 25000 }
  );
});
