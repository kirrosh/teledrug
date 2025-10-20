import { Effect, Context, Layer, Schema, Cache, Duration } from "effect";
import {
  generateText,
  type CoreMessage,
  type GenerateTextResult,
} from "ai";
import { openai } from "@ai-sdk/openai";
import {
  AIAgentConfigSchema,
  type AIAgentConfig,
} from "../contracts/config";
import {
  SimpleChatContextSchema,
  type SimpleChatContext,
} from "../contracts/context";
import { AIAgentError } from "../errors";
import {
  IntegrationRegistry,
  type IntegrationToolsBundle,
  type ToolResultFormatter,
  IntegrationError,
} from "../contracts/integration";
import type { ConversationMessage } from "../contracts/messages";

// Service interface
export interface AIAgent {
  readonly processMessage: (
    context: SimpleChatContext,
    conversationHistory?: readonly ConversationMessage[]
  ) => Effect.Effect<AIAgentResponse, AIAgentError, IntegrationRegistry>;

  readonly processText: (
    userId: string | number,
    text: string,
    conversationHistory?: readonly ConversationMessage[]
  ) => Effect.Effect<AIAgentResponse, AIAgentError, IntegrationRegistry>;
}

export interface AIAgentResponse {
  readonly result: GenerateTextResult<any, any>;
  readonly toolFormatters: Record<string, ToolResultFormatter>;
  readonly toolProgressMessages: Record<string, string>;
}

// Service tag
export const AIAgent = Context.GenericTag<AIAgent>("@services/AIAgent");

const HISTORY_REPLAY_LIMIT = 10;

// Unified system prompt builder
const buildUnifiedSystemPrompt = (context: SimpleChatContext): string => {
  const interactionHint = buildInteractionHint(context);
  const now = new Date();
  const localNow = now.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const utcNow = now.toISOString();

  return `Ты — TeleDrug AI Assistant, персональный помощник пользователя. Ты помогаешь управлять задачами, событиями в календаре, настройками дайджеста и личными настройками.

**Текущая дата и время:**
- Локальное (Europe/Moscow): ${localNow}
- UTC: ${utcNow}

**Твои возможности:**

1. **Задачи и события** - управление через инструмент manageTasks:
   - Задачи: укажи title и опционально dueAt (дедлайн)
   - События: укажи title, startAt и endAt (встреча с точным временем)
   - Время передавай в ISO-формате (YYYY-MM-DDTHH:mm:ss±HH:MM)
   - Используй часовой пояс пользователя из системных подсказок
   - Обновляй, завершай и удаляй через id или часть названия
   - События автоматически синхронизируются с Яндекс.Календарём

2. **Дайджест** - настройки утреннего дайджеста:
   - Управляй модулями дайджеста (погода, валюты, и т.п.)
   - Включай и отключай нужные модули
   - Обновляй параметры (город для погоды, валюты для отслеживания)

3. **Настройки** - личные настройки пользователя:
   - Меняй город, страну, часовой пояс ТОЛЬКО когда пользователь явно просит это сделать
   - Собирай все изменения в одном вызове инструмента
   - Если просят сменить язык, объясни что это пока недоступно

**Общие правила:**
- Отвечай на русском языке, будь краток и вежлив
- Не задавай уточняющих вопросов — при нехватке данных делай разумное предположение и отмечай его в ответе
- Всегда действуй по запросу пользователя, дополняя недостающие детали по умолчанию
- Подтверждай выполненные действия

${interactionHint}`.trim();
};

const makeAIAgent = (config: AIAgentConfig) =>
  Effect.gen(function* () {
    const validatedConfig = yield* Schema.decodeUnknown(AIAgentConfigSchema)(
      config
    ).pipe(
      Effect.mapError(
        (error) =>
          new AIAgentError({
            message: "Invalid AI Agent configuration",
            cause: error,
          })
      )
    );

    process.env.OPENAI_API_KEY = validatedConfig.openaiApiKey;

    const processMessage = (
      context: SimpleChatContext,
      conversationHistory: readonly ConversationMessage[] = []
    ): Effect.Effect<AIAgentResponse, AIAgentError, IntegrationRegistry> =>
      Effect.gen(function* () {
        const validatedContext = yield* Schema.decodeUnknown(
          SimpleChatContextSchema
        )(context).pipe(
          Effect.mapError(
            (error) =>
              new AIAgentError({
                message: "Invalid chat context",
                cause: error,
              })
          )
        );

        yield* Effect.sync(() =>
          console.log(
            `🤖 Processing message for user ${validatedContext.userId}: "${validatedContext.messageContent}"`
          )
        );

        const normalizedHistory = normalizeHistory(
          conversationHistory,
          HISTORY_REPLAY_LIMIT
        );

        if (normalizedHistory.length > 0) {
          yield* Effect.sync(() =>
            console.log(
              `🧵 History: ${normalizedHistory.length} message(s)`
            )
          );
        }

        const messages = buildMessages(
          validatedContext.messageContent,
          normalizedHistory
        );

        const integrationRegistry = yield* IntegrationRegistry;
        const toolsBundle = yield* integrationRegistry
          .getToolsForUser(
            validatedContext.userId,
            validatedContext.interactionType || "TEXT"
          )
          .pipe(
            Effect.mapError(
              (registryError: IntegrationError) =>
                new AIAgentError({
                  message: `Failed to prepare tools for user ${validatedContext.userId}`,
                  cause: registryError,
                })
            )
          );

        const toolNames = Object.keys(toolsBundle.tools);

        if (toolNames.length === 0) {
          console.log("📭 No tools available for this user");
        } else {
          console.log(`🛠️ Available tools: ${toolNames.join(", ")}`);
        }

        const baseSystemPrompt = buildUnifiedSystemPrompt(validatedContext);
        const contextMessages = toolsBundle.contextMessages ?? [];

        // Extract system messages from contextMessages and merge into system prompt
        const systemContexts = contextMessages
          .filter((msg) => msg.role === "system")
          .map((msg) => msg.content)
          .filter((content): content is string => typeof content === "string");

        const systemPrompt = systemContexts.length > 0
          ? [baseSystemPrompt, ...systemContexts].join("\n\n")
          : baseSystemPrompt;

        // Keep only non-system messages for the messages array
        const nonSystemContextMessages = contextMessages.filter(
          (msg) => msg.role !== "system"
        );
        const agentMessages = [...nonSystemContextMessages, ...messages];

        const generateResult = yield* Effect.tryPromise({
          try: () =>
            generateText({
              model: openai(validatedConfig.model || "gpt-4o-mini"),
              ...(toolNames.length > 0
                ? {
                    tools: toolsBundle.tools,
                    toolChoice: "required", // Force model to call at least one tool
                    maxToolRoundtrips: 1, // Single tool call per turn
                  }
                : {}),
              maxOutputTokens: validatedConfig.maxTokens,
              system: systemPrompt,
              messages: agentMessages,
            }),
          catch: (cause) =>
            new AIAgentError({
              message: "Agent failed to generate response",
              cause,
            }),
        });

        yield* Effect.sync(() => {
          console.log(
            `📨 Agent response:`,
            generateResult.text ? generateResult.text.slice(0, 200) : "<empty>"
          );
          console.log(`🔢 Steps taken: ${generateResult.steps?.length ?? 0}`);
          console.log(`⚙️ Finish reason:`, generateResult.finishReason);

          // Log steps details
          if (generateResult.steps) {
            for (let i = 0; i < generateResult.steps.length; i++) {
              const step = generateResult.steps[i];
              if (!step) continue;
              console.log(`  Step ${i + 1}:`);
              if (step.toolCalls && step.toolCalls.length > 0) {
                console.log(`    🛠️ Tool calls:`, step.toolCalls.map((c) => c.toolName).join(", "));
              }
              if (step.toolResults && step.toolResults.length > 0) {
                console.log(`    📦 Tool results:`, step.toolResults.map((r) => r.toolName).join(", "));
              }
            }
          }

          if (Array.isArray(generateResult.toolCalls) && generateResult.toolCalls.length > 0) {
            console.log(
              `🛠️ Final tool calls (${generateResult.toolCalls.length}):`,
              generateResult.toolCalls.map((call) => call.toolName).join(", ")
            );
          }
          if (Array.isArray(generateResult.toolResults) && generateResult.toolResults.length > 0) {
            console.log(
              `📦 Final tool results (${generateResult.toolResults.length}):`,
              generateResult.toolResults.map((r) => r.toolName).join(", ")
            );
          } else {
            console.log(`⚠️ No tool results in final result`);
            console.log(`🔍 Full result keys:`, Object.keys(generateResult));
          }
        });

        return {
          result: generateResult,
          toolFormatters: toolsBundle.formatters,
          toolProgressMessages: toolsBundle.progressMessages,
        } satisfies AIAgentResponse;
      });

    const processText = (
      userId: string | number,
      text: string,
      conversationHistory: readonly ConversationMessage[] = []
    ): Effect.Effect<AIAgentResponse, AIAgentError, IntegrationRegistry> => {
      const context: SimpleChatContext = {
        userId,
        chatId: userId,
        messageContent: text,
        interactionType: "TEXT",
      };

      return processMessage(context, conversationHistory);
    };

    return AIAgent.of({
      processMessage,
      processText,
    });
  });

const buildInteractionHint = (context: SimpleChatContext): string => {
  switch (context.interactionType) {
    case "VOICE":
      return "Пользователь прислал голосовое сообщение (оно уже расшифровано в текст).";
    case "IMAGE":
      return "Пользователь прислал изображение (описание получено в тексте).";
    case "FORWARD":
      return "Пользователь переслал сообщение из другого чата.";
    default:
      return "Пользователь отправил текстовое сообщение.";
  }
};

const normalizeHistory = (
  conversationHistory: readonly ConversationMessage[],
  maxItems: number
): ReadonlyArray<ConversationMessage> => {
  if (maxItems <= 0) {
    return [];
  }

  return conversationHistory
    .filter(
      (entry): entry is ConversationMessage =>
        Boolean(entry?.content?.trim()) &&
        (entry?.role === "user" || entry?.role === "assistant")
    )
    .slice(-maxItems)
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
      timestamp: entry.timestamp,
    }));
};

const buildMessages = (
  currentMessage: string,
  conversationHistory: readonly ConversationMessage[]
): Array<CoreMessage> => {
  const messages: Array<CoreMessage> = [];

  for (const entry of conversationHistory) {
    messages.push({
      role: entry.role,
      content: entry.content,
    });
  }

  messages.push({
    role: "user",
    content: currentMessage,
  });

  return messages;
};

/**
 * Internal helpers exported for integration tests. Not part of the public API.
 */
export const __testInternals = {
  buildMessages,
  normalizeHistory,
  HISTORY_REPLAY_LIMIT,
  buildUnifiedSystemPrompt,
} as const;

export interface AIAgentFactory {
  readonly getOrCreateAgent: (
    userId: string | number
  ) => Effect.Effect<AIAgent, AIAgentError, IntegrationRegistry>;
  readonly createAgent: (
    userId: string | number,
    config?: Partial<AIAgentConfig>
  ) => Effect.Effect<AIAgent, AIAgentError, IntegrationRegistry>;
  readonly invalidateUser?: (
    userId: string | number
  ) => Effect.Effect<void, never>;
  readonly clearCache?: () => Effect.Effect<void, never>;
}

export const AIAgentFactory = Context.GenericTag<AIAgentFactory>(
  "@services/AIAgentFactory"
);

const makeAIAgentFactory = (baseConfig: AIAgentConfig) =>
  Effect.gen(function* () {
    const agentCache = yield* Cache.make({
      capacity: 100,
      timeToLive: Duration.hours(1),
      lookup: (userId: string | number) =>
        Effect.gen(function* () {
          yield* Effect.sync(() =>
            console.log(`🔨 Creating orchestrator AI agent for user: ${userId}`)
          );

          const config: AIAgentConfig = {
            ...baseConfig,
            userId,
          };

          const agent = yield* makeAIAgent(config);

          yield* Effect.sync(() =>
            console.log(`✅ Created orchestrator agent for user: ${userId}`)
          );
          return agent;
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              console.log(`📦 Cached orchestrator agent for user: ${userId}`)
            )
          )
        ),
    });

    const createAgent = (
      userId: string | number,
      userConfig: Partial<AIAgentConfig> = {}
    ): Effect.Effect<AIAgent, AIAgentError, IntegrationRegistry> =>
      Effect.gen(function* () {
        if (Object.keys(userConfig).length > 0) {
          yield* Effect.sync(() =>
            console.log(
              `🎨 Creating custom orchestrator agent for user: ${userId}`
            )
          );
          const config: AIAgentConfig = {
            ...baseConfig,
            ...userConfig,
            userId,
          };
          return yield* makeAIAgent(config);
        }

        return yield* agentCache.get(userId);
      });

    const getOrCreateAgent = (
      userId: string | number
    ): Effect.Effect<AIAgent, AIAgentError, IntegrationRegistry> =>
      Effect.gen(function* () {
        const agent = yield* agentCache.get(userId);

        const cacheStats = yield* agentCache.cacheStats;
        yield* Effect.sync(() =>
          console.log(
            `📊 Orchestrator cache stats - Hits: ${cacheStats.hits}, Misses: ${cacheStats.misses}, Size: ${cacheStats.size}`
          )
        );

        return agent;
      });

    const invalidateUser = (userId: string | number) =>
      agentCache
        .invalidate(userId)
        .pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              console.log(
                `🗑️ Invalidated orchestrator cache for user: ${userId}`
              )
            )
          )
        );

    const clearCache = () =>
      agentCache.invalidateAll.pipe(
        Effect.tap(() =>
          Effect.sync(() => console.log(`🧹 Cleared orchestrator agent cache`))
        )
      );

    return AIAgentFactory.of({
      getOrCreateAgent,
      createAgent,
      invalidateUser,
      clearCache,
    });
  });

export const AIAgentLive = (config: AIAgentConfig) =>
  Layer.effect(AIAgent, makeAIAgent(config));

export const AIAgentFactoryLive = (baseConfig: AIAgentConfig) =>
  Layer.effect(AIAgentFactory, makeAIAgentFactory(baseConfig));

export { AIAgentConfigSchema, SimpleChatContextSchema };
export type { AIAgentConfig, SimpleChatContext };
