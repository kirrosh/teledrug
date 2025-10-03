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

describeLLM("Settings agent", () => {
  testLLM(
    "applies city and timezone changes",
    async () => {
    const openaiApiKey = ensureOpenAIKey();

    const context: SimpleChatContext = buildSimpleContext(
      "Поменяй город на Нижний Новгород и переведи часовой пояс на GMT+3. Если можно, сделай интерфейс на английском",
      { userId: 505 }
    );

    const captured: Array<{
      city?: string;
      country?: string;
      timezone?: string;
      refreshWeather?: boolean;
    }> = [];

    const updateSettingsTool = tool({
      description:
        "Обновляет настройки пользователя. Поле city для города, timezone для часового пояса. Устанавливай refreshWeather=true после смены города.",
      inputSchema: z.object({
        city: z.string().optional(),
        country: z.string().optional(),
        timezone: z.string().optional(),
        refreshWeather: z.boolean().default(false),
      }),
      execute: async (input) => {
        captured.push(input);
        return {
          success: true,
          data: {
            city: input.city,
            timezone: input.timezone,
            refreshWeather: input.refreshWeather,
          },
        };
      },
    });

    const bundle: IntegrationToolsBundle = {
      tools: {
        updateUserSettings: updateSettingsTool,
      },
      formatters: {},
      progressMessages: {},
      contextMessages: forceToolContext(
        "updateUserSettings",
        "Если пользователь просит сменить язык, сообщи что это недоступно, но всё равно выполни остальные изменения."
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
        "settings",
        domainAgentDefinitions.settings,
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
      console.warn("[settings] skipping due to network error", outcome.error);
      return;
    }

    const execution = outcome.execution;

    expect(execution.result.toolCalls?.[0]?.toolName).toBe("updateUserSettings");
    expect(execution.result.toolResults?.[0]?.toolName).toBe("updateUserSettings");
    expect(captured).toHaveLength(1);
    const payload = captured[0];
    expect(payload.city?.toLowerCase()).toContain("нижний");
    expect(payload.timezone).toMatch(/\bGMT\+3\b|Europe\/Moscow/i);
    expect(payload.refreshWeather).toBeTrue();
    },
    { timeout: 25000 }
  );
});
