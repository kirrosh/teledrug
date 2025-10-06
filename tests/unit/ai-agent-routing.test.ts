import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

import {
  __testInternals,
} from "../../packages/core/src/effect/services/ai-agent";
import type {
  IntegrationToolsBundle,
  DomainIntegrationTools,
  DomainAgentType,
} from "../../packages/core/src/effect/services/integration-registry";

const { executeAgentPlan, domainAgentDefinitions } = __testInternals;

const createBundle = (toolName: string): IntegrationToolsBundle => ({
  tools: { [toolName]: {} as any },
  formatters: {},
  progressMessages: {},
});

describe("executeAgentPlan", () => {
  it("supports optional short-circuit behaviour", async () => {
    const executionOrder: DomainAgentType[] = [
      "journal",
      "tasks",
      "calendar",
      "digest",
      "settings",
    ];

    const domainTools: DomainIntegrationTools = {
      journal: createBundle("createJournalEntry"),
      tasks: createBundle("manageTasks"),
      calendar: createBundle("createCalendarEvent"),
      digest: createBundle("updateDigestSettings"),
      settings: createBundle("updateUserSettings"),
    };

    const runCalls: DomainAgentType[] = [];

    const runAgent = (
      agentKind: DomainAgentType,
      _definition: any,
      _bundle: IntegrationToolsBundle
    ) => {
      runCalls.push(agentKind);
      const hasResults = agentKind === "tasks";
      return Effect.succeed({
        kind: agentKind,
        result: {
          text: `${agentKind} response`,
          toolCalls: [],
          toolResults: hasResults
            ? [{ toolName: `${agentKind}-tool`, output: { ok: true } }]
            : [],
        },
        toolFormatters: {},
        toolProgressMessages: {},
      });
    };

    const { agentPlan, successfulExecutions } = await Effect.runPromise(
      executeAgentPlan({
        executionOrder,
        domainTools,
        definitions: domainAgentDefinitions,
        runAgent,
        shortCircuitAfterSuccess: true,
      })
    );

    expect(runCalls).toEqual(["journal", "tasks"]);
    expect(successfulExecutions.map((exec) => exec.kind)).toEqual(["tasks"]);
    expect(agentPlan.map((entry) => entry.kind)).toEqual([
      "journal",
      "tasks",
    ]);
    expect(agentPlan[0].executed).toBeFalse();
    expect(agentPlan[0].reason).toBe("no tool results");
    expect(agentPlan[1].executed).toBeTrue();
  });

  it("executes every agent when short-circuit disabled", async () => {
    const executionOrder: DomainAgentType[] = ["journal", "tasks"];
    const domainTools: DomainIntegrationTools = {
      journal: createBundle("createJournalEntry"),
      tasks: createBundle("manageTasks"),
    };

    const runCalls: DomainAgentType[] = [];

    const runAgent = (
      agentKind: DomainAgentType,
      _definition: any,
      _bundle: IntegrationToolsBundle
    ) => {
      runCalls.push(agentKind);
      return Effect.succeed({
        kind: agentKind,
        result: {
          text: `${agentKind} handled`,
          toolCalls: [],
          toolResults: [
            { toolName: `${agentKind}-tool`, output: { ok: true } },
          ],
        },
        toolFormatters: {},
        toolProgressMessages: {},
      });
    };

    const { agentPlan, successfulExecutions } = await Effect.runPromise(
      executeAgentPlan({
        executionOrder,
        domainTools,
        definitions: domainAgentDefinitions,
        runAgent,
        shortCircuitAfterSuccess: false,
      })
    );

    expect(runCalls).toEqual(["journal", "tasks"]);
    expect(successfulExecutions.map((exec) => exec.kind)).toEqual([
      "journal",
      "tasks",
    ]);
    expect(agentPlan.every((entry) => entry.executed)).toBeTrue();
  });
});
