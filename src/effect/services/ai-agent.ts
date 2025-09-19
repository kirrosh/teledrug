import {
  Effect,
  Context,
  Layer,
  Schema,
  Cache,
  Duration,
  Console,
} from "effect";
import { generateText, type GenerateTextResult } from "ai";
import { openai } from "@ai-sdk/openai";
import { AIAgentError } from "../errors";
import { IntegrationRegistry } from "./integration-registry";
import { IntegrationError } from "../types/integrations";

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
  ) => Effect.Effect<
    GenerateTextResult<any, any>,
    AIAgentError,
    IntegrationRegistry
  >;

  readonly processText: (
    userId: string | number,
    text: string,
    conversationHistory?: readonly string[]
  ) => Effect.Effect<
    GenerateTextResult<any, any>,
    AIAgentError,
    IntegrationRegistry
  >;
}

// Service tag
export const AIAgent = Context.GenericTag<AIAgent>("@services/AIAgent");

// Implementation
const makeAIAgent = (config: AIAgentConfig) =>
  Effect.gen(function* () {
    // Validate configuration
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

    // Set OpenAI API key globally (required by Vercel AI SDK)
    process.env.OPENAI_API_KEY = validatedConfig.openaiApiKey;

    const processMessage = (
      context: SimpleChatContext,
      conversationHistory: readonly string[] = []
    ) =>
      Effect.gen(function* () {
        try {
          console.log(
            `🤖 Processing message for user ${context.userId}: "${context.messageContent}"`
          );

          // Validate context
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

          // Build system prompt
          const systemPrompt = buildSystemPrompt(validatedContext);

          // Build messages array
          const messages = buildMessages(
            systemPrompt,
            validatedContext.messageContent,
            conversationHistory
          );

          // Select model
          const model = openai(validatedConfig.model || "gpt-5-nano");

          console.log(
            `📡 Calling OpenAI API with model: ${
              validatedConfig.model || "gpt-5-nano"
            }`
          );

          // Get tools from integration registry
          const integrationRegistry = yield* IntegrationRegistry;
          const tools = yield* integrationRegistry
            .getToolsForUser(
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

          yield* Console.log(
            `🔧 Found ${
              Object.keys(tools).length
            } tools for interaction type: ${
              validatedContext.interactionType || "TEXT"
            }`
          );

          // Call OpenAI API with tools - they execute automatically in AI SDK v5
          const result = yield* Effect.promise(() =>
            generateText({
              model,
              messages,
              tools: Object.keys(tools).length > 0 ? tools : undefined,
            })
          );

          // Tools уже выполнены автоматически, просто логируем
          if (result.toolCalls && result.toolCalls.length > 0) {
            yield* Console.log(`🚀 AI called ${result.toolCalls.length} tools`);

            for (const toolCall of result.toolCalls) {
              yield* Console.log(
                `✅ Tool ${toolCall.toolName} executed successfully`
              );
            }
          }

          if (result.toolResults && result.toolResults.length > 0) {
            yield* Console.log(
              `📊 Received ${result.toolResults.length} tool results`
            );
          }

          console.log(`✅ AI response: ${result.text.substring(0, 100)}...`);

          return result;
        } catch (cause) {
          return yield* Effect.fail(
            new AIAgentError({
              message: `Failed to process message for user ${context.userId}`,
              cause,
            })
          );
        }
      });

    const processText = (
      userId: string | number,
      text: string,
      conversationHistory: readonly string[] = []
    ) => {
      const context: SimpleChatContext = {
        userId,
        chatId: userId, // Use userId as chatId for simplicity
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

// Helper function to build system prompt
const buildSystemPrompt = (context: SimpleChatContext): string => {
  const interactionType = context.interactionType || "TEXT";

  let basePrompt = `Ты - AI ассистент с именем TeleDrug.
Отвечай на русском языке.
Будь вежливым, полезным и профессиональным.
Твои ответы должны быть краткими и по существу.`;

  // Add interaction-specific instructions
  switch (interactionType) {
    case "VOICE":
      basePrompt += `\n\nПользователь отправил голосовое сообщение.`;
      break;
    case "IMAGE":
      basePrompt += `\n\nПользователь отправил изображение.`;
      break;
    case "FORWARD":
      basePrompt += `\n\nПользователь переслал сообщение.`;
      break;
    default:
      basePrompt += `\n\nПользователь отправил текстовое сообщение.`;
  }

  return basePrompt;
};

// Helper function to build messages array
const buildMessages = (
  systemPrompt: string,
  currentMessage: string,
  conversationHistory: readonly string[]
): Array<{ role: "system" | "user" | "assistant"; content: string }> => {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  // Add conversation history (last 10 messages to stay within limits)
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

  // Add current message
  messages.push({
    role: "user",
    content: currentMessage,
  });

  return messages;
};

// Factory for creating user-specific AI agents
export interface AIAgentFactory {
  readonly getOrCreateAgent: (
    userId: string | number
  ) => Effect.Effect<AIAgent, AIAgentError>;
  readonly createAgent: (
    userId: string | number,
    config?: Partial<AIAgentConfig>
  ) => Effect.Effect<AIAgent, AIAgentError>;
  readonly invalidateUser?: (
    userId: string | number
  ) => Effect.Effect<void, never>;
  readonly clearCache?: () => Effect.Effect<void, never>;
}

export const AIAgentFactory = Context.GenericTag<AIAgentFactory>(
  "@services/AIAgentFactory"
);

// AI Agent Factory implementation with Effect Cache
const makeAIAgentFactory = (baseConfig: AIAgentConfig) =>
  Effect.gen(function* () {
    // Create Effect Cache with TTL and capacity limits
    const agentCache = yield* Cache.make({
      capacity: 100, // Maximum 100 cached agents
      timeToLive: Duration.hours(1), // Agents expire after 1 hour
      lookup: (userId: string | number) =>
        Effect.gen(function* () {
          console.log(`🔨 Creating new AI agent for user: ${userId}`);

          const config: AIAgentConfig = {
            ...baseConfig,
            userId,
          };

          // Create agent for this user
          const agent = yield* makeAIAgent(config);

          console.log(`✅ Created AI agent for user: ${userId}`);
          return agent;
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              console.log(`📦 Cached agent for user: ${userId}`)
            )
          )
        ),
    });

    const createAgent = (
      userId: string | number,
      userConfig: Partial<AIAgentConfig> = {}
    ) =>
      Effect.gen(function* () {
        // For custom configs, create without caching
        if (Object.keys(userConfig).length > 0) {
          console.log(`🎨 Creating custom AI agent for user: ${userId}`);
          const config: AIAgentConfig = {
            ...baseConfig,
            ...userConfig,
            userId,
          };
          return yield* makeAIAgent(config);
        }

        // Use cache for default configs
        return yield* agentCache.get(userId);
      });

    const getOrCreateAgent = (userId: string | number) =>
      Effect.gen(function* () {
        const agent = yield* agentCache.get(userId);

        // Cache.get already handles the cache miss case
        const cacheStats = yield* agentCache.cacheStats;
        console.log(
          `📊 Cache stats - Hits: ${cacheStats.hits}, Misses: ${cacheStats.misses}, Size: ${cacheStats.size}`
        );

        return agent;
      });

    // Optional: Add cache management methods
    const invalidateUser = (userId: string | number) =>
      agentCache
        .invalidate(userId)
        .pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              console.log(`🗑️ Invalidated cache for user: ${userId}`)
            )
          )
        );

    const clearCache = () =>
      agentCache.invalidateAll.pipe(
        Effect.tap(() =>
          Effect.sync(() => console.log(`🧹 Cleared all agent cache`))
        )
      );

    return AIAgentFactory.of({
      getOrCreateAgent,
      createAgent,
      invalidateUser,
      clearCache,
    });
  });

// Live layers
export const AIAgentLive = (config: AIAgentConfig) =>
  Layer.effect(AIAgent, makeAIAgent(config));

export const AIAgentFactoryLive = (baseConfig: AIAgentConfig) =>
  Layer.effect(AIAgentFactory, makeAIAgentFactory(baseConfig));

// Export schemas and types for use in other modules
export { AIAgentConfigSchema, SimpleChatContextSchema };
export type { AIAgentConfig, SimpleChatContext };
