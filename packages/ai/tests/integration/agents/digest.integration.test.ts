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

const { runDomainAgent, domainAgentDefinitions, buildMessages } =
  __testInternals;

describeLLM("Digest agent", () => {
  testLLM(
    "reconfigures enabled modules",
    async () => {
      const openaiApiKey = ensureOpenAIKey();

      const context: SimpleChatContext = buildSimpleContext(
        "Включи в утренний дайджест погоду и курс доллара, а новости выключи",
        { userId: 404 }
      );

      const captured: Array<{
        enable: string[];
        disable: string[];
        parameters?: Record<string, unknown>;
      }> = [];

      const updateDigestTool = tool({
        description:
          "Обновляет настройки дайджеста. Добавляй включаемые модули в enable, выключаемые в disable.",
        inputSchema: z.object({
          enable: z.array(z.string().min(1)).default([]),
          disable: z.array(z.string().min(1)).default([]),
          parameters: z.record(z.any(), z.any()).optional(),
        }),
        execute: async (input) => {
          captured.push({
            enable: input.enable ?? [],
            disable: input.disable ?? [],
            parameters: input.parameters,
          });
          return {
            success: true,
            data: {
              enabled: input.enable,
              disabled: input.disable,
            },
          };
        },
      });

      const bundle: IntegrationToolsBundle = {
        tools: {
          updateDigestSettings: updateDigestTool,
        },
        formatters: {},
        progressMessages: {},
        contextMessages: forceToolContext(
          "updateDigestSettings",
          "Включи нужные модули и отключи лишние."
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
          "digest",
          domainAgentDefinitions.digest,
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
        console.warn("[digest] skipping due to network error", outcome.error);
        return;
      }

      const execution = outcome.execution;

      expect(execution.result.toolCalls?.[0]?.toolName).toBe(
        "updateDigestSettings"
      );
      expect(execution.result.toolResults?.[0]?.toolName).toBe(
        "updateDigestSettings"
      );
      expect(captured).toHaveLength(1);
      const payload = captured[0];
      expect(payload).toBeDefined();
      if (!payload) {
        throw new Error("Payload is undefined");
      }
      expect(payload.enable.length).toBeGreaterThanOrEqual(2);

      const enableSet = new Set(payload.enable.map((entry) => entry.toLowerCase()));
      expect(enableSet.has("weather") || enableSet.has("погода")).toBeTrue();
      expect(
        enableSet.has("usd_exchange_rate") ||
          enableSet.has("currency") ||
          enableSet.has("курс доллара")
      ).toBeTrue();

      const disableSet = new Set(payload.disable.map((entry) => entry.toLowerCase()));
      expect(disableSet.has("news") || disableSet.has("новости")).toBeTrue();
    },
    { timeout: 20000 }
  );
});
