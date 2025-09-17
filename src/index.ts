import { BotService } from "./core/bot-service";

async function main() {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!telegramToken) {
    throw new Error(
      "❌ Не установлен токен Telegram бота (TELEGRAM_BOT_TOKEN)"
    );
  }

  if (!openaiApiKey) {
    throw new Error("❌ Не установлен API ключ OpenAI (OPENAI_API_KEY)");
  }

  const botService = new BotService({
    telegramToken,
    openaiApiKey,
  });

  try {
    await botService.start();
  } catch (error) {
    console.error("❌ Критическая ошибка:", error);
    process.exit(1);
  }
}

// Обработка сигналов завершения
process.on("SIGINT", () => {
  console.log("\n👋 Получен сигнал завершения, останавливаем бота...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n👋 Получен сигнал завершения, останавливаем бота...");
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ Ошибка запуска:", error);
  process.exit(1);
});
