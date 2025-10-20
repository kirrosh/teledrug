import { describe, test } from "bun:test";
import type { CoreMessage } from "ai";

import type { SimpleChatContext } from "@teledrug/ai";

export const RUN_LLM_TESTS = process.env.RUN_LLM_TESTS === "1";

export const describeLLM = RUN_LLM_TESTS ? describe : describe.skip;

type TestOptions = {
  timeout?: number;
  skip?: boolean;
};

type TestFunction = Parameters<typeof test>[1];

export const testLLM = (
  name: string,
  fn: TestFunction,
  options: TestOptions = {}
) => {
  const shouldSkip = options.skip ?? false;
  const runner = shouldSkip ? test.skip : RUN_LLM_TESTS ? test : test.skip;
  const timeout = options.timeout ?? 25000;
  return runner(name, fn, timeout);
};

export const ensureOpenAIKey = (): string => {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "OPENAI_API_KEY is required to run LLM integration tests. Provide the key and rerun with RUN_LLM_TESTS=1."
    );
  }
  return key;
};

export const buildSimpleContext = (
  messageContent: string,
  overrides: Partial<SimpleChatContext> = {}
): SimpleChatContext => ({
  userId: overrides.userId ?? 9001,
  chatId: overrides.chatId ?? overrides.userId ?? 9001,
  interactionType: overrides.interactionType ?? "TEXT",
  messageContent,
});

export const getModelName = (): string =>
  process.env.LLM_TEST_MODEL?.trim().length
    ? process.env.LLM_TEST_MODEL.trim()
    : "gpt-4o-mini";

const NETWORK_ERROR_CODES = new Set([
  "FailedToOpenSocket",
  "ConnectionRefused",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const NETWORK_MESSAGE_REGEX =
  /Unable to connect|Failed to open socket|ECONN|ENOTFOUND|timed out/i;

const collectCandidates = (
  value: unknown,
  seen: Set<unknown>
): Array<unknown> => {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return [];
  }
  seen.add(value);
  const next: Array<unknown> = [];
  if (Array.isArray(value)) {
    next.push(...value);
  } else {
    const record = value as Record<string, unknown>;
    for (const key of [
      "cause",
      "error",
      "errors",
      "failure",
      "left",
      "right",
    ]) {
      if (key in record) {
        next.push(record[key]);
      }
    }
  }
  return next;
};

export const isNetworkError = (error: unknown): boolean => {
  const queue: Array<unknown> = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    if (current instanceof Error) {
      if (NETWORK_MESSAGE_REGEX.test(current.message)) {
        return true;
      }
      queue.push(current.cause);
    }

    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
        return true;
      }
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string" && NETWORK_MESSAGE_REGEX.test(message)) {
        return true;
      }
      queue.push(...collectCandidates(current, seen));
    }
  }

  return false;
};

export const forceToolContext = (
  toolName: string,
  extraHint = ""
): ReadonlyArray<CoreMessage> => [
  {
    role: "system",
    content: [
      `Всегда вызывай инструмент ${toolName} хотя бы один раз.`,
      "Отвечать текстом без вызова инструмента запрещено.",
      "Если данных не хватает — сделай разумное предположение и всё равно вызови инструмент.",
      extraHint,
    ]
      .filter((part) => part && part.trim().length > 0)
      .join("\n"),
  },
];

export const guardToolContext = (
  toolName: string,
  hint: string
): ReadonlyArray<CoreMessage> => [
  {
    role: "system",
    content: `Инструмент ${toolName}: ${hint}`,
  },
];
