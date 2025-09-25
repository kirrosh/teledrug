import { Effect, Context, Layer, Schema, Cache, Duration } from "effect";
import {
  Experimental_Agent as Agent,
  generateObject,
  NoObjectGeneratedError,
  type CoreMessage,
  type GenerateTextResult,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { AIAgentError } from "../errors";
import {
  IntegrationRegistry,
  type DomainIntegrationTools,
  type DomainAgentType,
  type IntegrationToolsBundle,
} from "./integration-registry";
import { IntegrationError, ToolResultFormatter } from "../types/integrations";

// AI Agent Configuration Schema
const AIAgentConfigSchema = Schema.Struct({
  openaiApiKey: Schema.String,
  model: Schema.optionalWith(Schema.String, { default: () => "gpt-5-nano" }),
  maxTokens: Schema.optionalWith(Schema.Number, { default: () => 1000 }),
  userId: Schema.Union(Schema.String, Schema.Number),
});

type AIAgentConfig = Schema.Schema.Type<typeof AIAgentConfigSchema>;

// Simple Chat Context for minimal implementation
const SimpleChatContextSchema = Schema.Struct({
  userId: Schema.Union(Schema.String, Schema.Number),
  chatId: Schema.Union(Schema.String, Schema.Number),
  messageContent: Schema.String,
  interactionType: Schema.optionalWith(
    Schema.Literal("TEXT", "VOICE", "IMAGE", "FORWARD"),
    { default: () => "TEXT" }
  ),
});

type SimpleChatContext = Schema.Schema.Type<typeof SimpleChatContextSchema>;

// Service interface
export interface AIAgent {
  readonly processMessage: (
    context: SimpleChatContext,
    conversationHistory?: readonly string[]
  ) => Effect.Effect<AIAgentResponse, AIAgentError, IntegrationRegistry>;

  readonly processText: (
    userId: string | number,
    text: string,
    conversationHistory?: readonly string[]
  ) => Effect.Effect<AIAgentResponse, AIAgentError, IntegrationRegistry>;
}

export interface AIAgentResponse {
  readonly executions: ReadonlyArray<AgentExecution>;
  readonly toolFormatters: Record<string, ToolResultFormatter>;
  readonly toolProgressMessages: Record<string, string>;
}

// Service tag
export const AIAgent = Context.GenericTag<AIAgent>("@services/AIAgent");

type AgentExecutionKind = DomainAgentType | "fallback";

interface AgentExecution {
  readonly kind: AgentExecutionKind;
  readonly result: GenerateTextResult<any, any>;
  readonly toolFormatters: Record<string, ToolResultFormatter>;
  readonly toolProgressMessages: Record<string, string>;
}

interface DomainAgentDefinition {
  readonly description: string;
  readonly buildSystemPrompt: (
    context: SimpleChatContext,
    toolNames: ReadonlyArray<string>
  ) => string;
}

const DEFAULT_AGENT_FALLBACK_ORDER: readonly DomainAgentType[] = [
  "journal",
  "tasks",
  "calendar",
  "digest",
];

const domainAgentDefinitions: Record<DomainAgentType, DomainAgentDefinition> = {
  journal: {
    description:
      "Создаёт и анализирует записи дневника, определяет настроение и подсказывает теги.",
    buildSystemPrompt: (context, _toolNames) => {
      const interactionHint = buildInteractionHint(context);
      return `Ты — агент дневника TeleDrug. Твоя задача — определять, подходит ли сообщение для дневниковой записи, и при необходимости вызывать инструменты, чтобы сохранить запись и подсказать дополнительные действия. Отвечай на русском языке, лаконично, с заботливым тоном. Всегда подтверждай сохранение записи, если она создана инструментом. Если запись не подходит, дай короткий ответ и пояснение. ${interactionHint}`.trim();
    },
  },
  tasks: {
    description:
      "Управляет задачами пользователя: создаёт, обновляет, завершает и показывает списки.",
    buildSystemPrompt: (context, _toolNames) => {
      const interactionHint = buildInteractionHint(context);
      return `Ты — агент задач TeleDrug. Управляй списком задач пользователя, помогай создавать, обновлять, завершать и переносить задачи. Всё взаимодействие проходит через единый инструмент manageTasks: в нём указывай списки create, update, complete, delete и reschedule. Вноси в инструмент только итоговое решение по сообщению пользователя и следи, чтобы обновления ссылались на id из списка открытых задач. Всегда создавай отдельную запись в create для каждого нового поручения. Если нужно завершить или удалить задачу, используй её id. Говори по-русски, будь краток и вежлив. Если инструментов нет, сообщи пользователю, что пока не можешь выполнить действие и предложи альтернативу. ${interactionHint}`.trim();
    },
  },
  calendar: {
    description:
      "Работает с календарём: показывает события и создаёт новые встречи пользователя.",
    buildSystemPrompt: (_context, _toolNames) => {
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
      return `Ты — агент календаря TeleDrug. Ты создаёшь события в календаре. Всегда действуй по готовому запросу — не задавай уточняющих вопросов. Если пользователь дал недостаточно данных, оцени запрос и попробуй разумно дополнить недостающие части по умолчанию.

Текущая дата и время:
- Локальное (Europe/Moscow): ${localNow}
- UTC: ${utcNow}
`.trim();
    },
  },
  digest: {
    description:
      "Настраивает ежедневный дайджест: модули, погода, валюты и т.п.",
    buildSystemPrompt: (context, toolNames) => {
      const interactionHint = buildInteractionHint(context);
      const toolList = toolNames.length
        ? `Доступные инструменты: ${toolNames.join(", ")}.`
        : "Инструментов нет — дай совет или попроси использовать команду позже.";
      return `Ты — агент дайджеста TeleDrug. Управляй настройками утреннего дайджеста, включай и отключай модули, обновляй параметры погоды и валют. Отвечай на русском, будь очень краток и конкретен. ${toolList} ${interactionHint}`.trim();
    },
  },
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
      conversationHistory: readonly string[] = []
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
            `🤖 Orchestrating message for user ${validatedContext.userId}: "${validatedContext.messageContent}"`
          )
        );

        const baseMessages = buildMessages(
          validatedContext.messageContent,
          conversationHistory
        );

        const integrationRegistry = yield* IntegrationRegistry;
        const domainTools = yield* integrationRegistry
          .getDomainToolsForUser(
            validatedContext.userId,
            validatedContext.interactionType || "TEXT"
          )
          .pipe(
            Effect.mapError(
              (registryError: IntegrationError) =>
                new AIAgentError({
                  message: `Failed to prepare integrations for user ${validatedContext.userId}`,
                  cause: registryError,
                })
            )
          );

        const availableAgents = selectAvailableAgents(domainTools);

        if (availableAgents.length === 0) {
          console.log("📭 No domain agents with tools available for this user");
        } else {
          console.log("🧭 Available domain agents:");
          for (const agent of availableAgents) {
            const toolsLabel = agent.tools.length
              ? agent.tools.join(", ")
              : "<нет инструментов>";
            console.log(`  • ${agent.kind}: ${toolsLabel}`);
          }
        }

        const model = openai(validatedConfig.model || "gpt-5-nano");

        const routedAgents = yield* routeAgents(
          model,
          validatedConfig,
          availableAgents,
          validatedContext,
          conversationHistory
        ).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Effect.sync(() =>
                console.warn(
                  "⚠️ Agent routing failed, using fallback order",
                  error
                )
              );
              return DEFAULT_AGENT_FALLBACK_ORDER.slice();
            })
          )
        );

        const executionOrder = routedAgents.length
          ? routedAgents
          : DEFAULT_AGENT_FALLBACK_ORDER.slice();

        if (executionOrder.length > 0) {
          console.log(
            `🛣️ Agent execution order: ${executionOrder.join(" → ")}`
          );
        } else {
          console.log(
            "🛣️ Agent execution order: <empty> — falling back to defaults"
          );
        }

        const successfulExecutions: AgentExecution[] = [];

        for (const agentKind of executionOrder) {
          const definition = domainAgentDefinitions[agentKind];
          const toolsBundle = domainTools[agentKind];

          if (!definition || !toolsBundle) {
            continue;
          }

          console.log(`🚀 Executing domain agent: ${agentKind}`);

          const attempt = yield* runDomainAgent(
            agentKind,
            definition,
            validatedConfig,
            validatedContext,
            baseMessages,
            toolsBundle
          ).pipe(Effect.either);

          if (attempt._tag === "Left") {
            yield* Effect.sync(() =>
              console.error(
                `❌ Domain agent ${agentKind} failed:`,
                attempt.left
              )
            );
            continue;
          }

          const execution = attempt.right;
          const resultText = execution.result.text?.trim();
          const hasToolResults =
            execution.result.toolResults &&
            execution.result.toolResults.length > 0;

          if ((resultText && resultText.length > 0) || hasToolResults) {
            successfulExecutions.push(execution);
            yield* Effect.sync(() =>
              console.log(`✅ Agent ${agentKind} produced a response`)
            );
          } else {
            yield* Effect.sync(() =>
              console.log(
                `ℹ️ Agent ${agentKind} did not provide actionable output, moving to next`
              )
            );
          }
        }

        if (successfulExecutions.length === 0) {
          const fallbackExecution = yield* runFallbackAgent(
            model,
            validatedConfig,
            validatedContext,
            baseMessages
          );
          successfulExecutions.push(fallbackExecution);
        }

        const combinedFormatters = successfulExecutions.reduce<
          Record<string, ToolResultFormatter>
        >((acc, execution) => ({ ...acc, ...execution.toolFormatters }), {});

        const combinedProgressMessages = successfulExecutions.reduce<
          Record<string, string>
        >(
          (acc, execution) => ({
            ...acc,
            ...execution.toolProgressMessages,
          }),
          {}
        );

        return {
          executions: successfulExecutions,
          toolFormatters: combinedFormatters,
          toolProgressMessages: combinedProgressMessages,
        } satisfies AIAgentResponse;
      });

    const processText = (
      userId: string | number,
      text: string,
      conversationHistory: readonly string[] = []
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

const selectAvailableAgents = (
  domainTools: DomainIntegrationTools
): Array<{ kind: DomainAgentType; description: string; tools: string[] }> =>
  Object.entries(domainAgentDefinitions)
    .map(([kind, definition]) => {
      const bundle = domainTools[kind as DomainAgentType];
      const toolNames = bundle ? Object.keys(bundle.tools) : [];
      if (toolNames.length === 0) {
        return undefined;
      }
      return {
        kind: kind as DomainAgentType,
        description: definition.description,
        tools: toolNames,
      };
    })
    .filter(
      (
        value
      ): value is {
        kind: DomainAgentType;
        description: string;
        tools: string[];
      } => Boolean(value)
    );

const routeAgents = (
  model: ReturnType<typeof openai>,
  config: AIAgentConfig,
  availableAgents: ReadonlyArray<{
    kind: DomainAgentType;
    description: string;
    tools: string[];
  }>,
  context: SimpleChatContext,
  conversationHistory: readonly string[]
): Effect.Effect<ReadonlyArray<DomainAgentType>, AIAgentError> => {
  if (availableAgents.length === 0) {
    return Effect.succeed([]);
  }

  const agentNames = availableAgents.map((agent) => agent.kind);
  const agentEnum = z.enum(
    agentNames as [DomainAgentType, ...DomainAgentType[]]
  );
  const schema = z.object({
    agents: z.array(agentEnum).max(Math.min(agentNames.length, 3)).default([]),
    reasoning: z.string().optional(),
  });

  const systemPromptLines = availableAgents.map((agent) => {
    const tools = agent.tools.length
      ? agent.tools.join(", ")
      : "нет инструментов";
    return `- ${agent.kind}: ${agent.description} (инструменты: ${tools}).`;
  });

  const historySnippet = conversationHistory
    .slice(-5)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");

  return Effect.tryPromise({
    try: async () => {
      try {
        const { object } = await generateObject({
          model,
          schema,
          messages: [
            {
              role: "system",
              content:
                "Ты — маршрутизатор TeleDrug. Выбирай только тех специализированных агентов, которые действительно нужны для ответа на запрос пользователя. Не добавляй агентов ради подстраховки. Если достаточно одного агента — верни массив с единственным именем. Если подходящих агентов нет, верни пустой массив." +
                "\n\nПравила выбора:" +
                "\n- Если пользователь перечисляет задачи, планы или поручения — обязательно добавь агента tasks." +
                "\n- Если вместе с задачами пользователь делится эмоциями, переживаниями или делает заметку для дневника — выбери и tasks, и journal." +
                "\n- Агента journal используй только для записей о состоянии, эмоциях и размышлениях без явных задач." +
                "\nДоступные агенты и их обязанности:\n" +
                systemPromptLines.join("\n"),
            },
            {
              role: "user",
              content: `Сообщение пользователя: ${
                context.messageContent
              }\nТип взаимодействия: ${
                context.interactionType
              }\nПоследние сообщения:\n${historySnippet || "(нет)"}`,
            },
          ],
          maxOutputTokens: config.maxTokens,
        });

        const selectedAgents = (object.agents || []).filter((agent) =>
          agentNames.includes(agent)
        );
        if (selectedAgents.length > 0) {
          return selectedAgents as ReadonlyArray<DomainAgentType>;
        }

        throw new AIAgentError({
          message: "Router did not select any agents",
        });
      } catch (cause) {
        if (NoObjectGeneratedError.isInstance?.(cause)) {
          throw new AIAgentError({
            message: "Router did not return an agent list",
            cause,
          });
        }
        throw cause;
      }
    },
    catch: (cause) =>
      new AIAgentError({
        message: "Failed to route message across domain agents",
        cause,
      }),
  });
};

const runDomainAgent = (
  kind: DomainAgentType,
  definition: DomainAgentDefinition,
  config: AIAgentConfig,
  context: SimpleChatContext,
  baseMessages: ReadonlyArray<CoreMessage>,
  bundle: IntegrationToolsBundle
): Effect.Effect<AgentExecution, AIAgentError> =>
  Effect.gen(function* () {
    const toolNames = Object.keys(bundle.tools);
    const systemPrompt = definition.buildSystemPrompt(context, toolNames);
    const contextMessages = bundle.contextMessages ?? [];
    const agentMessages = [...contextMessages, ...baseMessages];
    const agent = new Agent({
      model: openai(config.model || "gpt-5-nano"),
      ...(toolNames.length > 0
        ? { tools: bundle.tools, toolChoice: "auto" as const }
        : {}),
      maxOutputTokens: config.maxTokens,
    });

    const result = yield* Effect.tryPromise({
      try: () =>
        agent.generate({
          system: systemPrompt,
          messages: agentMessages,
        }),
      catch: (cause) =>
        new AIAgentError({
          message: `Domain agent ${kind} failed to generate response`,
          cause,
        }),
    });

    yield* Effect.sync(() => {
      console.log(
        `📨 ${kind} agent primary text:`,
        result.text ? result.text.slice(0, 200) : "<empty>"
      );
      if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
        console.log(
          `🛠️ ${kind} agent tool calls:`,
          result.toolCalls.map((call) => ({
            toolName: call.toolName,
            input: call.input,
          }))
        );
      } else {
        console.log(`🛠️ ${kind} agent tool calls: none`);
      }
      if (Array.isArray(result.toolResults) && result.toolResults.length > 0) {
        console.log(
          `📦 ${kind} agent tool results:`,
          result.toolResults.map((tool) => ({
            toolName: tool.toolName,
            output: tool.output,
          }))
        );
      } else {
        console.log(`📦 ${kind} agent tool results: none`);
      }
    });

    return {
      kind,
      result,
      toolFormatters: bundle.formatters,
      toolProgressMessages: bundle.progressMessages,
    } satisfies AgentExecution;
  });

const runFallbackAgent = (
  model: ReturnType<typeof openai>,
  config: AIAgentConfig,
  context: SimpleChatContext,
  baseMessages: ReadonlyArray<CoreMessage>
): Effect.Effect<AgentExecution, AIAgentError> =>
  Effect.gen(function* () {
    const agent = new Agent({
      model,
      maxOutputTokens: config.maxTokens,
    });

    const result = yield* Effect.tryPromise({
      try: () =>
        agent.generate({
          system:
            "Ты — ассистент TeleDrug. У пользователя недоступны специализированные инструменты, поэтому ответь кратко и дружелюбно, по-русски, предложи общее решение или попроси уточнить запрос.",
          messages: [...baseMessages],
        }),
      catch: (cause) =>
        new AIAgentError({
          message: "Fallback assistant failed",
          cause,
        }),
    });

    return {
      kind: "fallback",
      result,
      toolFormatters: {},
      toolProgressMessages: {},
    } satisfies AgentExecution;
  });

const buildMessages = (
  currentMessage: string,
  conversationHistory: readonly string[]
): Array<CoreMessage> => {
  const messages: Array<CoreMessage> = [];

  const recentHistory = conversationHistory.slice(-10);
  for (let i = 0; i < recentHistory.length; i++) {
    const content = recentHistory[i];
    if (content && content.trim()) {
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: content.trim(),
      });
    }
  }

  messages.push({
    role: "user",
    content: currentMessage,
  });

  return messages;
};

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
