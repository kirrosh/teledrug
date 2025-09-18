import { Effect, Context, Layer } from "effect"
import { Bot } from "grammy"
import { TelegramClientError } from "../errors"
import { UserConfigStorage } from "./user-config-storage"
import { AIAgentFactory } from "./ai-agent"
import { MessageHistory } from "./message-history"
import { IntegrationRegistry } from "./integration-registry"
import type { BotConfig, UpdateContext } from "../types"

// Helper function to generate response from tool results
const generateResponseFromToolResults = (toolResults: any[]): string => {
  if (!toolResults || toolResults.length === 0) {
    return "❌ Извините, не удалось получить результаты."
  }

  let response = ""

  for (const toolResult of toolResults) {
    if (toolResult.toolName === "getEvents") {
      const output = toolResult.output
      if (output?.success && output?.events) {
        if (output.events.length === 0) {
          response += "📅 У вас нет событий на этот период.\n"
        } else {
          response += `📅 **События на неделе:**\n\n`
          output.events.forEach((event: any, index: number) => {
            const date = new Date(event.date).toLocaleDateString('ru-RU', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
            response += `${index + 1}. **${event.title}**\n`
            response += `   📍 ${date}\n`
            if (event.description) {
              response += `   📝 ${event.description}\n`
            }
            response += "\n"
          })
          if (output.message) {
            response += `ℹ️ ${output.message}`
          }
        }
      } else {
        response += "❌ Ошибка при получении событий календаря.\n"
      }
    }
  }

  return response.trim() || "❌ Извините, не удалось обработать результаты."
}

// Service interface
export interface TelegramClient {
  readonly start: Effect.Effect<void, TelegramClientError>
  readonly stop: Effect.Effect<void, TelegramClientError>
  readonly sendMessage: (chatId: number, text: string) => Effect.Effect<number, TelegramClientError>
  readonly handleUpdate: (update: UpdateContext) => Effect.Effect<void, TelegramClientError>
}

// Service tag
export const TelegramClient = Context.GenericTag<TelegramClient>("@services/TelegramClient")

// Implementation
const makeTelegramClient = (config: BotConfig) => Effect.gen(function* () {
  const userConfigStorage = yield* UserConfigStorage
  const aiAgentFactory = yield* AIAgentFactory
  const messageHistory = yield* MessageHistory
  const integrationRegistry = yield* IntegrationRegistry

  // Create bot instance directly
  const bot = new Bot(config.telegramToken)

  // Setup basic handlers
  const setupHandlers = () => {
      bot.command("start", async (ctx) => {
        await ctx.reply(
          "🤖 Привет! Я AI-ассистент на Effect Framework.\n\n" +
          "Это минимальная версия бота для первой итерации миграции.\n" +
          "Просто напишите мне сообщение!"
        )
      })

      bot.command("clear", async (ctx) => {
        await ctx.reply("🗑️ История очищена!")
        console.log(`🗑️ Очистка истории для чата ${ctx.chat.id}`)
      })

      bot.command("integrations", async (ctx) => {
        const chatId = ctx.chat.id
        const userId = ctx.from?.id || chatId

        console.log(`📊 Запрос интеграций для пользователя ${userId}`)

        try {
          // Get user integrations using Effect Cache
          const effect = userConfigStorage.get(userId).pipe(
            Effect.map(config => {
              if (config.integrations.length === 0) {
                return "📊 **Интеграции:**\n\nУ вас пока нет настроенных интеграций."
              }

              const integrationsText = config.integrations
                .map(integration => {
                  const status = integration.enabled ? "✅" : "❌"
                  return `${status} **${integration.name}**`
                })
                .join("\n")

              return `📊 **Интеграции:**\n\n${integrationsText}`
            }),
            Effect.catchAll(error => {
              console.error("Ошибка при получении интеграций:", error)
              if (error._tag === "UserConfigError" && error.message.includes("not found")) {
                return Effect.succeed("📊 **Интеграции:**\n\nПользователь не найден. Используйте /start для инициализации.")
              }
              return Effect.succeed("❌ Ошибка при получении списка интеграций.")
            })
          )

          // Run the effect and get result
          const result = await Effect.runPromise(effect)

          await ctx.reply(result, { parse_mode: "Markdown" })
        } catch (error) {
          console.error("Ошибка в команде /integrations:", error)
          await ctx.reply("❌ Произошла ошибка при получении интеграций.")
        }
      })

      // Handle text messages with AI Agent
      bot.on("message:text", async (ctx) => {
        const chatId = ctx.chat.id
        const userId = ctx.from?.id || chatId
        const text = ctx.message.text

        console.log(`📨 Получено сообщение от ${userId}: ${text}`)

        try {
          // Create AI agent processing effect
          const processEffect = Effect.gen(function* () {
            // Get or create AI agent for user
            const aiAgent = yield* aiAgentFactory.getOrCreateAgent(userId)

            // Get conversation history
            const history = yield* messageHistory.getHistory(chatId)

            // Add user message to history
            yield* messageHistory.addUserMessage(chatId, text)

            // Process message through AI
            const result = yield* aiAgent.processText(userId, text, history)

            console.log("🔍 AI Agent result:", JSON.stringify(result, null, 2))

            // Handle different response types from AI SDK v5
            let responseText = result.text?.trim() || ""

            // If no direct text but we have tool results, generate response from them
            if (!responseText && result.toolResults && result.toolResults.length > 0) {
              console.log("🔧 Processing tool results to generate response...")
              responseText = generateResponseFromToolResults(result.toolResults)
            }

            // Final fallback
            if (!responseText) {
              responseText = "❌ Извините, не удалось сформировать ответ."
            }

            console.log("📝 Final response text:", responseText)

            // Add AI response to history
            yield* messageHistory.addAssistantMessage(chatId, responseText)

            return responseText
          }).pipe(
            Effect.catchAll(error => {
              console.error("AI processing error:", error)
              return Effect.succeed(`❌ Извините, произошла ошибка при обработке сообщения: ${error}`)
            })
          )

          // Run the effect with proper context including IntegrationRegistry
          const response = await Effect.runPromise(
            processEffect.pipe(
              Effect.provide(Layer.succeed(IntegrationRegistry, integrationRegistry))
            )
          )

          await ctx.reply(response)
          console.log(`✅ Отправлен AI ответ для ${userId}`)

        } catch (error) {
          console.error("Ошибка при обработке сообщения:", error)
          await ctx.reply("❌ Произошла ошибка при обработке вашего сообщения.")
        }
      })
    }

    setupHandlers()

    const start = Effect.gen(function* () {
      try {
        console.log("🚀 Запуск Telegram клиента...")

        // Set bot commands
        yield* Effect.promise(() =>
          bot.api.setMyCommands([
            { command: "start", description: "🚀 Запустить бота" },
            { command: "clear", description: "🧹 Очистить историю" },
            { command: "integrations", description: "📊 Показать интеграции" },
          ])
        )

        yield* Effect.promise(() => bot.start())
        console.log("✅ Telegram клиент запущен!")
      } catch (cause) {
        return yield* Effect.fail(new TelegramClientError({
          message: "Failed to start Telegram client",
          cause
        }))
      }
    })

    const stop = Effect.gen(function* () {
      try {
        console.log("🛑 Остановка Telegram клиента...")
        yield* Effect.promise(() => bot.stop())
        console.log("✅ Telegram клиент остановлен!")
      } catch (cause) {
        return yield* Effect.fail(new TelegramClientError({
          message: "Failed to stop Telegram client",
          cause
        }))
      }
    })

    const sendMessage = (chatId: number, text: string): Effect.Effect<number, TelegramClientError> =>
      Effect.gen(function* () {
        try {
          const result = yield* Effect.promise(() => bot.api.sendMessage(chatId, text))
          return result.message_id
        } catch (cause) {
          return yield* Effect.fail(new TelegramClientError({
            message: `Failed to send message to chat ${chatId}`,
            cause
          }))
        }
      })

    const handleUpdate = (update: UpdateContext): Effect.Effect<void, TelegramClientError> =>
      Effect.gen(function* () {
        // Basic update handling - just echo
        const response = `Обработал обновление: ${update.text}`
        yield* sendMessage(update.chatId, response)
        console.log(`📨 Обработано обновление: ${update.text}`)
      })

  return TelegramClient.of({
    start,
    stop,
    sendMessage,
    handleUpdate,
  })
})

// Live layer
export const TelegramClientLive = (config: BotConfig) =>
  Layer.effect(
    TelegramClient,
    makeTelegramClient(config)
  )