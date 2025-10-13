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

describeLLM("Tasks agent", () => {
  testLLM(
    "plans new and existing tasks in one manage call",
    async () => {
    const openaiApiKey = ensureOpenAIKey();

    const context: SimpleChatContext = buildSimpleContext(
      "Добавь задачу подготовить презентацию к завтрашней встрече в 14:00 и перенеси задачу 'сверстать отчёт' на пятницу утром",
      { userId: 202 }
    );

    const captured: Array<{
      create: Array<{ title: string; dueAt?: string | null }>;
      update: Array<{ id?: number; title?: string; set: { title?: string; dueAt?: string | null; status?: string } }>;
      complete: Array<{ id?: number; title?: string }>;
      delete: Array<{ id?: number; title?: string }>;
      reschedule: Array<{ id?: number; title?: string; dueAt?: string | null; shift?: string }>;
    }> = [];

    const ManageTasksSchema = z.object({
      create: z
        .array(
          z.object({
            title: z.string().min(1),
            dueAt: z.string().optional().nullable(),
          })
        )
        .default([]),
      update: z
        .array(
          z.object({
            id: z.number().int().positive().optional(),
            title: z.string().optional(),
            set: z.object({
              title: z.string().optional(),
              dueAt: z.string().optional().nullable(),
              status: z.string().optional(),
            }),
          })
        )
        .default([]),
      complete: z
        .array(
          z.object({
            id: z.number().int().positive().optional(),
            title: z.string().optional(),
          })
        )
        .default([]),
      delete: z
        .array(
          z.object({
            id: z.number().int().positive().optional(),
            title: z.string().optional(),
          })
        )
        .default([]),
      reschedule: z
        .array(
          z.object({
            id: z.number().int().positive().optional(),
            title: z.string().optional(),
            dueAt: z.string().optional().nullable(),
            shift: z.string().optional(),
          })
        )
        .default([]),
    });

    const manageTasksTool = tool({
      description:
        "Синхронизирует задачи. Заполняй create для новых задач, reschedule для переноса сроков, update для правок названия и статуса.",
      inputSchema: ManageTasksSchema,
      execute: async (input) => {
        captured.push(input);
        return {
          success: true,
          summary: {
            created: input.create.length,
            rescheduled: input.reschedule.length,
            updated: input.update.length,
          },
        };
      },
    });

    const bundle: IntegrationToolsBundle = {
      tools: {
        manageTasks: manageTasksTool,
      },
      formatters: {},
      progressMessages: {},
      contextMessages: forceToolContext(
        "manageTasks",
        "Внеси новые поручения в create и перенеси существующие задачи."
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
        "tasks",
        domainAgentDefinitions.tasks,
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
      console.warn("[tasks] skipping due to network error", outcome.error);
      return;
    }

    const execution = outcome.execution;

    expect(execution.result.toolCalls?.[0]?.toolName).toBe("manageTasks");
    expect(execution.result.toolResults?.[0]?.toolName).toBe("manageTasks");
    expect(captured).toHaveLength(1);
    const payload = captured[0];
    expect(payload.create.length).toBeGreaterThan(0);
    const modifications =
      payload.reschedule.length + payload.update.length + payload.complete.length;
    expect(modifications).toBeGreaterThan(0);
    },
    { timeout: 25000 }
  );
});
