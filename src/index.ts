import { BotService } from "./core/bot-service";

// Простой HTTP сервер для healthcheck
const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response("Telegram Bot is running", { status: 200 });
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🌐 HTTP сервер запущен на порту ${server.port}`);

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

  // Выполняем миграции БД перед запуском бота
  try {
    console.log("🗄️ Выполнение миграций базы данных...");
    await Bun.$`bun run db:migrate`;
    console.log("✅ Миграции выполнены успешно");
  } catch (error) {
    console.error("❌ Ошибка выполнения миграций:", error);
    // Не прерываем выполнение, так как миграции могут быть уже применены
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
