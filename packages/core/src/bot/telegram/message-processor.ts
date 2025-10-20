import { Effect, Layer } from "effect";
import type { Context as TelegramContext } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { IntegrationRegistry } from "../../services/integration-registry";
import type { IntegrationRegistry as IntegrationRegistryService } from "@teledrug/ai";
import { ToolProgressReporter } from "../../core/tool-progress";
import type {
  ToolFormatterResult,
  ToolResultFormatter,
  InteractionType,
} from "../../types/integrations";
import type { MessageHistory } from "../../services/message-history";
import type { AIAgentFactory } from "../../services/ai-agent";
import { TelegramClientError } from "../../errors";

interface AggregatedToolResponse {
  readonly text: string;
  readonly parseMode?: "Markdown" | "HTML";
  readonly replyMarkup?: InlineKeyboardMarkup;
  readonly metadata?: Record<string, unknown>;
}

export interface HandleUserMessageOptions {
  readonly interactionType?: InteractionType;
  readonly progressMessageId?: number;
  readonly initialProgressText?: string;
}

export interface MessageProcessor {
  readonly handleUserMessage: (
    ctx: TelegramContext,
    text: string,
    options?: HandleUserMessageOptions
  ) => Promise<void>;
}

interface MessageProcessorDeps {
  readonly aiAgentFactory: AIAgentFactory;
  readonly integrationRegistry: IntegrationRegistryService;
  readonly messageHistory: MessageHistory;
}

const generateResponseFromToolResults = (
  toolResults: any[],
  formatters: Record<string, ToolResultFormatter>
) =>
  Effect.gen(function* () {
    if (!toolResults || toolResults.length === 0) {
      return {
        text: "❌ Извините, не удалось получить результаты.",
      } satisfies AggregatedToolResponse;
    }

    const responses: ToolFormatterResult[] = [];

    for (const toolResult of toolResults) {
      const formatter = formatters[toolResult.toolName];

      if (formatter) {
        const formatted = yield* formatter(toolResult.output);
        responses.push(formatted);
      } else if (toolResult.output && typeof toolResult.output === "object") {
        responses.push({
          text: `🛠️ ${toolResult.toolName}: ${JSON.stringify(
            toolResult.output,
            null,
            2
          )}`,
        });
      } else {
        responses.push({
          text: `🛠️ ${toolResult.toolName}: ${String(toolResult.output)}`,
        });
      }
    }

    const text = responses
      .map((response) => response.text?.trim())
      .filter((value): value is string => Boolean(value && value.length > 0))
      .join("\n\n")
      .trim();

    const parseMode = responses.find(
      (response) => response.parseMode
    )?.parseMode;
    const replyMarkup = responses.find(
      (response) => response.replyMarkup
    )?.replyMarkup;

    const metadataEntries = responses
      .map((response) => response.metadata)
      .filter((meta): meta is Record<string, unknown> => Boolean(meta));

    const metadata = metadataEntries.length
      ? metadataEntries.reduce<Record<string, unknown>>(
          (acc, current) => ({ ...acc, ...current }),
          {}
        )
      : undefined;

    return {
      text: text || "❌ Извините, не удалось обработать результаты.",
      parseMode,
      replyMarkup,
      metadata,
    } satisfies AggregatedToolResponse;
  });

const createPreview = (value: string, limit = 200) => {
  const normalized = value.trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
};

export const createMessageProcessor = ({
  aiAgentFactory,
  integrationRegistry,
  messageHistory,
}: MessageProcessorDeps) => {
  const handleUserMessage = async (
    ctx: TelegramContext,
    text: string,
    options: HandleUserMessageOptions = {}
  ) => {
    if (!ctx.chat) {
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || chatId;
    const interactionType: InteractionType =
      options.interactionType ?? "TEXT";
    const initialProgressText =
      options.initialProgressText ?? "🤔 Думаю над ответом...";

    const preview = createPreview(text);
    const interactionLabel = (() => {
      switch (interactionType) {
        case "VOICE":
          return "голосовое";
        case "IMAGE":
          return "изображение";
        case "FORWARD":
          return "пересланное сообщение";
        default:
          return "текстовое";
      }
    })();

    const interactionEmoji = (() => {
      switch (interactionType) {
        case "VOICE":
          return "🎙️";
        case "IMAGE":
          return "🖼️";
        case "FORWARD":
          return "🔁";
        default:
          return "📨";
      }
    })();

    console.log(
      `${interactionEmoji} Получено ${interactionLabel} сообщение от ${userId}: ${preview}`
    );

    let progressMessageId = options.progressMessageId;
    let lastProgressText: string | undefined;
    let lastProgressOptionsKey: string | undefined;

    const serializeOptions = (
      editOptions?: Parameters<typeof ctx.api.editMessageText>[3]
    ) => (editOptions ? JSON.stringify(editOptions) : undefined);

    const updateLastProgress = (
      value: string,
      editOptions?: Parameters<typeof ctx.api.editMessageText>[3]
    ) => {
      lastProgressText = value;
      lastProgressOptionsKey = serializeOptions(editOptions);
    };

    const ensureProgressMessage = async () => {
      if (progressMessageId !== undefined) {
        try {
          await ctx.api.editMessageText(
            chatId,
            progressMessageId,
            initialProgressText
          );
          updateLastProgress(initialProgressText);
        } catch (error: any) {
          if (
            error?.error_code === 400 &&
            typeof error?.description === "string" &&
            error.description.includes("message is not modified")
          ) {
            updateLastProgress(initialProgressText);
            return;
          }
          console.error("Не удалось обновить сообщение прогресса:", error);
        }
      } else {
        const progressMessage = await ctx.reply(initialProgressText);
        progressMessageId = progressMessage.message_id;
        updateLastProgress(initialProgressText);
      }
    };

    try {
      await ensureProgressMessage();

      if (progressMessageId === undefined) {
        throw new TelegramClientError({
          message: "Progress message is not initialized",
        });
      }

      const editMessageSafe = (
        content: string,
        editOptions?: Parameters<typeof ctx.api.editMessageText>[3]
      ) =>
        Effect.gen(function* () {
          const nextOptionsKey = serializeOptions(editOptions);
          if (
            lastProgressText === content &&
            lastProgressOptionsKey === nextOptionsKey
          ) {
            return;
          }

          yield* Effect.promise(() =>
            ctx.api.editMessageText(chatId, progressMessageId!, content, editOptions)
          );
          yield* Effect.sync(() => updateLastProgress(content, editOptions));
        }).pipe(
          Effect.catchAll((error: any) =>
            Effect.sync(() => {
              if (
                error?.error_code === 400 &&
                typeof error?.description === "string" &&
                error.description.includes("message is not modified")
              ) {
                updateLastProgress(content, editOptions);
                return;
              }
              console.error("Не удалось обновить сообщение прогресса:", error);
            })
          )
        );

      const updateProgress = (emoji: string, message: string) =>
        editMessageSafe(`${emoji} ${message}`);

      const finalizeMessage = (response: AggregatedToolResponse) => {
        const options = (
          response.parseMode || response.replyMarkup
            ? {
                ...(response.parseMode
                  ? { parse_mode: response.parseMode }
                  : {}),
                ...(response.replyMarkup
                  ? { reply_markup: response.replyMarkup }
                  : {}),
              }
            : undefined
        ) as Parameters<typeof ctx.api.editMessageText>[3] | undefined;

        const editEffect = options
          ? editMessageSafe(response.text, options)
          : editMessageSafe(response.text);

        return editEffect.pipe(
          Effect.catchAll(() =>
            Effect.promise(() =>
              ctx.reply(response.text, {
                parse_mode: response.parseMode,
                reply_markup: response.replyMarkup,
              })
            ).pipe(
              Effect.catchAll((fallbackError) =>
                Effect.sync(() =>
                  console.error(
                    "Не удалось отправить итоговое сообщение:",
                    fallbackError
                  )
                )
              )
            )
          )
        );
      };

      const toolProgressLayer = Layer.succeed(ToolProgressReporter, {
        report: (toolName: string, message: string) =>
          updateProgress(
            "🛠️",
            message && message.trim().length > 0
              ? message
              : `Использую инструмент ${toolName}...`
          ),
      });

      const processEffect = Effect.gen(function* () {
        const aiAgent = yield* aiAgentFactory.getOrCreateAgent(userId);

        const history = yield* messageHistory.getHistory(chatId);
        yield* Effect.sync(() =>
          console.log(
            `🗂️ Loaded conversation history (${history.length} messages)`
          )
        );

        yield* messageHistory.addUserMessage(chatId, text);

        yield* updateProgress("🧠", "Готовлю ответ ассистента...");

        const agentResponse = yield* aiAgent.processMessage(
          {
            userId,
            chatId,
            messageContent: text,
            interactionType,
          },
          history
        );

        const { result, toolFormatters } = agentResponse;

        const toolCalls = result.toolCalls ?? [];
        const toolResults = result.toolResults ?? [];

        if (toolCalls.length > 0) {
          for (const call of toolCalls) {
            const completionMessage = `Инструмент ${call.toolName} выполнен`;
            yield* updateProgress("✅", completionMessage);
          }
        }

        let finalResponse: { text: string; parseMode?: "Markdown" | "HTML"; replyMarkup?: any; metadata?: Record<string, unknown> };

        if (toolResults.length > 0) {
          console.log("🔧 Processing tool results to generate response...");
          finalResponse = yield* generateResponseFromToolResults(
            toolResults,
            toolFormatters
          );
        } else if (result.text) {
          // Agent returned text without calling tools
          console.log("📝 Agent returned text response without tool calls");
          finalResponse = {
            text: result.text,
            parseMode: "Markdown",
          };
        } else {
          yield* Effect.fail(
            new TelegramClientError({
              message: "No tool results or text returned by agent",
            })
          );
          return; // TypeScript needs this for type narrowing
        }

        console.log("📝 Final response text:", finalResponse.text);

        yield* messageHistory.addAssistantMessage(chatId, finalResponse.text);

        yield* finalizeMessage(finalResponse);
      }).pipe(
        Effect.catchAll((error) => {
          console.error("AI processing error:", error);
          const errorMessage =
            "❌ Извините, произошла ошибка при обработке сообщения.";

          return Effect.gen(function* () {
            yield* messageHistory.addAssistantMessage(chatId, errorMessage);
            yield* finalizeMessage({
              text: errorMessage,
            });
          });
        })
      );

      await Effect.runPromise(
        processEffect.pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(IntegrationRegistry, integrationRegistry),
              toolProgressLayer
            )
          )
        )
      );

      console.log(
        `✅ Отправлен AI ответ для ${userId} (${interactionType.toLowerCase()})`
      );
    } catch (error) {
      console.error("Ошибка при обработке сообщения:", error);
      const errorMessage =
        "❌ Произошла ошибка при обработке вашего сообщения.";
      if (progressMessageId !== undefined) {
        try {
          await ctx.api.editMessageText(chatId, progressMessageId, errorMessage);
        } catch (editError) {
          console.error(
            "Не удалось обновить сообщение прогресса после ошибки:",
            editError
          );
          await ctx.reply(errorMessage);
        }
      } else {
        await ctx.reply(errorMessage);
      }
    }
  };

  return {
    handleUserMessage,
  } satisfies MessageProcessor;
};
