import { Effect, Context, Layer } from "effect"
import { Bot } from "grammy"
import { TelegramClientError } from "../errors"
import type { BotConfig, UpdateContext } from "../types"

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

      // Handle text messages with simple echo
      bot.on("message:text", async (ctx) => {
        const chatId = ctx.chat.id
        const text = ctx.message.text

        // Simple echo response for now
        const response = `Получил ваше сообщение: "${text}"`
        await ctx.reply(response)

        console.log(`📨 Обработано сообщение от ${chatId}: ${text}`)
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