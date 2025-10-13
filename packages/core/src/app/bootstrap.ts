import { Effect, Console, Duration } from "effect"
import { BotApplication } from "../application/bot-application"
import { MainLayer } from "./layers/main"

// Main program
const program = Effect.gen(function* () {
  yield* Console.log("🚀 Запуск TeleDrug на Effect Framework...")

  // Validate required environment variables
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return yield* Effect.fail(new Error("TELEGRAM_BOT_TOKEN is required"))
  }

  if (!process.env.OPENAI_API_KEY) {
    return yield* Effect.fail(new Error("OPENAI_API_KEY is required"))
  }

  yield* Console.log("✅ Конфигурация валидна")

  const botApp = yield* BotApplication

  yield* Console.log("📱 Запуск бота...")
  yield* botApp.start

  yield* Console.log("✅ TeleDrug запущен успешно!")

  // Keep the program running indefinitely
  yield* Effect.sleep(Duration.days(365))
}).pipe(
  Effect.provide(MainLayer),
  Effect.catchAll((error) =>
    Console.log(`❌ Ошибка запуска: ${error}`)
  )
)

// Graceful shutdown handling
const shutdown = () => {
  console.log("\n🛑 Получен сигнал завершения...")
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// Run the program and keep it running
Effect.runPromise(program).catch((error) => {
  console.error("❌ Критическая ошибка:", error)
  process.exit(1)
})
