import { describe, it, expect } from "bun:test";
import { Effect } from "effect";

import { __testInternals } from "../../src/agent";
import type {
  IntegrationToolsBundle,
  DomainIntegrationTools,
  DomainAgentType,
  ConversationMessage,
  AgentExecution,
} from "@teledrug/ai";

const {
  executeAgentPlan,
  domainAgentDefinitions,
  buildMessages,
  normalizeHistory,
  HISTORY_REPLAY_LIMIT,
} = __testInternals;

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
      } as unknown as AgentExecution);
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
    const firstEntry = agentPlan[0]!;
    expect(firstEntry.executed).toBeFalse();
    expect(firstEntry.reason).toBe("no tool results");
    const secondEntry = agentPlan[1]!;
    expect(secondEntry.executed).toBeTrue();
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
      } as unknown as AgentExecution);
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

describe("history helpers", () => {
  it("normalizes history to limit and trims whitespace", () => {
    const baseTimestamp = Date.now();
    const history: ConversationMessage[] = Array.from(
      { length: HISTORY_REPLAY_LIMIT + 2 },
      (_, index) => ({
        role: index % 2 === 0 ? "assistant" : "user",
        content: `  message ${index}  `,
        timestamp: baseTimestamp - index * 1000,
      })
    );

    const normalized = normalizeHistory(history, HISTORY_REPLAY_LIMIT);
    expect(normalized).toHaveLength(HISTORY_REPLAY_LIMIT);
    expect(normalized.every((entry) => entry.content === entry.content.trim())).toBeTrue();
    expect(normalized[0]?.role).toBe("assistant");
  });

  it("builds messages including existing history and new user input", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: "🧭 Задачи: #12 — Запись на чистку зубов",
        timestamp: Date.now() - 2000,
      },
      {
        role: "user",
        content: "Спасибо!",
        timestamp: Date.now() - 1000,
      },
    ];

    const messages = buildMessages("Закрой эту задачу.", history);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: "assistant",
      content: "🧭 Задачи: #12 — Запись на чистку зубов",
    });
    expect(messages[1]).toEqual({
      role: "user",
      content: "Спасибо!",
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: "Закрой эту задачу.",
    });
  });
});
