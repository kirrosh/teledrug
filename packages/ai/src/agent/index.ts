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
  type DomainIntegrationTools,
  type DomainAgentType,
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
  readonly executions: ReadonlyArray<AgentExecution>;
  readonly toolFormatters: Record<string, ToolResultFormatter>;
  readonly toolProgressMessages: Record<string, string>;
  readonly plan: ReadonlyArray<AgentPlanEntry>;
  readonly usedFallbackRouting: boolean;
}

// Service tag
export const AIAgent = Context.GenericTag<AIAgent>("@services/AIAgent");

type AgentExecutionKind = DomainAgentType;

export interface AgentExecution {
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
  "settings",
];

const HISTORY_REPLAY_LIMIT = 10;

export interface AgentPlanEntry {
  readonly kind: DomainAgentType;
  readonly executed: boolean;
  readonly reason?: string;
}

interface AgentRoutingDecision {
  readonly agents: ReadonlyArray<DomainAgentType>;
  readonly reasoning?: string;
}

const domainAgentDefinitions: Record<DomainAgentType, DomainAgentDefinition> = {
  journal: {
    description:
      "Создаёт и анализирует записи дневника, определяет настроение и подсказывает теги.",
    buildSystemPrompt: (context, _toolNames) => {
      const interactionHint = buildInteractionHint(context);
      return `Ты — агент дневника TeleDrug. Твоя задача — определять, подходит ли сообщение для дневниковой записи, сохранять её при необходимости и подсказывать дополнительные действия. Отвечай на русском языке, лаконично, с заботливым тоном. Всегда подтверждай сохранение записи, если оно выполнено. Если запись не подходит, сделай вывод самостоятельно и опиши решение без уточняющих вопросов — при необходимости добавь разумные допущения. ${interactionHint}`.trim();
    },
  },
  tasks: {
    description:
      "Управляет задачами пользователя: создаёт, обновляет, завершает и показывает списки.",
    buildSystemPrompt: (context, _toolNames) => {
      const interactionHint = buildInteractionHint(context);
      return `Ты — агент задач TeleDrug. Управляй списком задач пользователя, помогай создавать, обновлять, завершать и переносить задачи. Всё взаимодействие проходит через единый инструмент manageTasks: в нём указывай списки create, update, complete, delete и reschedule. Вноси туда только итоговое решение по сообщению пользователя и следи, чтобы обновления ссылались на id из списка открытых задач. Всегда создавай отдельную запись в create для каждого нового поручения. Игнорируй просьбы вроде "сделай запись в дневник" или "занеси в журнал" — этим занимается агент дневника и отдельная задача не нужна. Если нужно завершить или удалить задачу, используй её id. Не задавай уточняющих вопросов — при нехватке данных сделай лучшее предположение и отметь его в ответе. Говори по-русски, будь краток и вежлив. ${interactionHint}`.trim();
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
      return `Ты — агент календаря TeleDrug. Ты создаёшь события в календаре. Всегда действуй по готовому запросу — не задавай уточняющих вопросов. Если пользователь дал недостаточно данных, оцени запрос и дополни недостающие части по умолчанию, не перекладывая решение на пользователя. Создавай не более одного события за обращение, если явно не просят несколько. Передавай время в ISO-формате (YYYY-MM-DDTHH:mm:ss±HH:MM) и используй часовой пояс пользователя, если он указан в системных подсказках.

Текущая дата и время:
- Локальное (Europe/Moscow): ${localNow}
- UTC: ${utcNow}
`.trim();
    },
  },
  digest: {
    description:
      "Настраивает ежедневный дайджест: модули, погода, валюты и т.п.",
    buildSystemPrompt: (context, _toolNames) => {
      const interactionHint = buildInteractionHint(context);
      return `Ты — агент дайджеста TeleDrug. Управляй настройками утреннего дайджеста, включай и отключай модули, обновляй параметры погоды и валют. Отвечай на русском, будь очень краток и конкретен. Не задавай уточняющих вопросов, даже если данных мало — сделай разумное предположение и поясни его. ${interactionHint}`.trim();
    },
  },
  settings: {
    description:
      "Меняет личные настройки: город, страна, часовой пояс и предпочтения.",
    buildSystemPrompt: (context, toolNames) => {
      const interactionHint = buildInteractionHint(context);
      const toolHint = toolNames.length
        ? "Собери все изменения в одном вызове инструмента, избегай повторных обращений без необходимости."
        : "Собери все необходимые правки единым действием.";
      return `Ты — агент настроек TeleDrug. Меняешь город, страну, часовой пояс и пользовательские предпочтения. После смены города обновляй погодный модуль, чтобы он показывал новую локацию. Если просят сменить язык, объясни, что это пока недоступно, но продолжай выполнять остальные просьбы. Отвечай лаконично, подтверждай применённые изменения. ${toolHint} ${interactionHint}`.trim();
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
            `🤖 Orchestrating message for user ${validatedContext.userId}: "${validatedContext.messageContent}"`
          )
        );

        const normalizedHistory = normalizeHistory(
          conversationHistory,
          HISTORY_REPLAY_LIMIT
        );

        if (normalizedHistory.length > 0) {
          yield* Effect.sync(() =>
            console.log(
              `🧵 History shared with LLM (${normalizedHistory.length} message(s))`
            )
          );
        } else if (conversationHistory.length > 0) {
          yield* Effect.sync(() =>
            console.log("🧵 History trimmed to zero after normalization")
          );
        }

        const baseMessages = buildMessages(
          validatedContext.messageContent,
          normalizedHistory
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

        const model = openai(validatedConfig.model || "gpt-4o-mini");

        const routingDecision = yield* routeAgents(
          model,
          validatedConfig,
          availableAgents,
          validatedContext,
          normalizedHistory
        );

        if (
          routingDecision.reasoning &&
          routingDecision.reasoning.trim().length > 0
        ) {
          console.log("🧠 Router reasoning:", routingDecision.reasoning.trim());
        }

        if (routingDecision.agents.length === 0) {
          yield* Effect.fail(
            new AIAgentError({
              message: "Router did not select any domain agents",
            })
          );
        }

        const executionOrder = routingDecision.agents;

        console.log(
          `🛣️ Planned domain agents: ${executionOrder.join(" → ")}`
        );
        const { agentPlan, successfulExecutions } = yield* executeAgentPlan({
          executionOrder,
          domainTools,
          definitions: domainAgentDefinitions,
          runAgent: (agentKind, definition, toolsBundle) =>
            runDomainAgent(
              agentKind,
              definition,
              validatedConfig,
              validatedContext,
              baseMessages,
              toolsBundle
            ),
          shortCircuitAfterSuccess: false,
        });
        if (successfulExecutions.length === 0) {
          yield* Effect.fail(
            new AIAgentError({
              message: "No subagent produced tool results",
            })
          );
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
          plan: agentPlan,
          usedFallbackRouting: false,
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
  conversationHistory: readonly ConversationMessage[]
): Effect.Effect<AgentRoutingDecision, AIAgentError> => {
  if (availableAgents.length === 0) {
    return Effect.succeed({ agents: [] });
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

  const historySnippet =
    conversationHistory.length === 0
      ? "(история не используется)"
      : conversationHistory
          .slice(-5)
          .map((item, index) => {
            const who = item.role === "assistant" ? "TeleDrug" : "Пользователь";
            return `${index + 1}. ${who}: ${item.content}`;
          })
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
                "\n- Если пользователь сообщает о выполнении, переносе или отмене задачи — тоже выбирай агента tasks, чтобы обновить список." +
                "\n- Если вместе с задачами пользователь делится эмоциями, переживаниями или делает заметку для дневника — выбери и tasks, и journal." +
                "\n- Агента journal используй только для записей о состоянии, эмоциях и размышлениях без явных задач." +
                "\n- Если пользователь описывает событие с конкретной датой, временем или диапазоном — обязательно добавь агента calendar." +
                "\n- Если при описании события пользователь также делится эмоциями, переживаниями или личными ожиданиями — выбери и calendar, и journal." +
                "\n- Не выбирай агента tasks, если пользователь не просит явно управлять задачами или поручениями." +
                "\n- Агента settings выбирай ТОЛЬКО когда пользователь явно просит изменить личные настройки (город, страну, часовой пояс, предпочтения). Простое упоминание города, поездки или места события не означает изменение настроек." +
                "\n- История диалога передаётся для контекста. Учитывай её только если пользователь явно ссылается на прошлые сообщения. Если ниже указано, что истории нет, обрабатывай запрос как отдельный." +
                "\nДоступные агенты и их обязанности:\n" +
                systemPromptLines.join("\n"),
            },
            {
              role: "user",
              content: `Сообщение пользователя: ${
                context.messageContent
              }\nТип взаимодействия: ${
                context.interactionType
              }\nПоследние сообщения:\n${historySnippet}`,
            },
          ],
          maxOutputTokens: config.maxTokens,
        });

        const selectedAgents = (object.agents || []).filter((agent) =>
          agentNames.includes(agent)
        ) as ReadonlyArray<DomainAgentType>;
        const reasoning =
          typeof object.reasoning === "string"
            ? object.reasoning.trim()
            : undefined;

        return {
          agents: selectedAgents,
          reasoning,
        } satisfies AgentRoutingDecision;
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

interface ExecuteAgentPlanOptions {
  readonly executionOrder: ReadonlyArray<DomainAgentType>;
  readonly domainTools: DomainIntegrationTools;
  readonly definitions: Record<DomainAgentType, DomainAgentDefinition>;
  readonly runAgent: (
    agentKind: DomainAgentType,
    definition: DomainAgentDefinition,
    bundle: IntegrationToolsBundle
  ) => Effect.Effect<AgentExecution, AIAgentError>;
  readonly shortCircuitAfterSuccess: boolean;
}

const executeAgentPlan = ({
  executionOrder,
  domainTools,
  definitions,
  runAgent,
  shortCircuitAfterSuccess,
}: ExecuteAgentPlanOptions) =>
  Effect.gen(function* () {
    const agentPlan: AgentPlanEntry[] = [];
    const successfulExecutions: AgentExecution[] = [];

    for (const agentKind of executionOrder) {
      const definition = definitions[agentKind];
      const toolsBundle = domainTools[agentKind];

      if (!definition || !toolsBundle) {
        agentPlan.push({
          kind: agentKind,
          executed: false,
          reason: "tool bundle not available",
        });
        continue;
      }

      yield* Effect.sync(() =>
        console.log(`🚀 Executing domain agent: ${agentKind}`)
      );

      const attempt = yield* runAgent(
        agentKind,
        definition,
        toolsBundle
      ).pipe(Effect.either);

      if (attempt._tag === "Left") {
        yield* Effect.sync(() =>
          console.error(`❌ Domain agent ${agentKind} failed:`, attempt.left)
        );
        agentPlan.push({
          kind: agentKind,
          executed: false,
          reason:
            attempt.left instanceof Error
              ? attempt.left.message
              : String(attempt.left),
        });
        continue;
      }

      const execution = attempt.right;
      const toolResults = execution.result.toolResults;
      const hasToolResults = Array.isArray(toolResults) && toolResults.length > 0;

      if (hasToolResults) {
        successfulExecutions.push(execution);
        yield* Effect.sync(() =>
          console.log(`✅ Agent ${agentKind} produced tool results`)
        );
        agentPlan.push({ kind: agentKind, executed: true });

        if (shortCircuitAfterSuccess) {
          break;
        }
      } else {
        yield* Effect.sync(() =>
          console.log(
            `ℹ️ Agent ${agentKind} did not return tool results, moving to next`
          )
        );
        agentPlan.push({
          kind: agentKind,
          executed: false,
          reason: "no tool results",
        });
      }
    }

    return { agentPlan, successfulExecutions } as const;
  });

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
      model: openai(config.model || "gpt-4o-mini"),
      ...(toolNames.length > 0
        ? {
            tools: bundle.tools,
            toolChoice:
              toolNames.length === 1
                ? { type: "tool", toolName: toolNames[0]! }
                : "required",
          }
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
  runDomainAgent,
  domainAgentDefinitions,
  buildMessages,
  DEFAULT_AGENT_FALLBACK_ORDER,
  routeAgents,
  executeAgentPlan,
  normalizeHistory,
  HISTORY_REPLAY_LIMIT,
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
