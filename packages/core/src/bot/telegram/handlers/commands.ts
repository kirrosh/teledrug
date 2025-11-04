import { Effect } from "effect";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { UserConfigStorage } from "../../../services/user-config-storage";
import crypto from "crypto";

interface CommandHandlersOptions {
  readonly resolvedWebAppUrl?: string;
  readonly webAppUnavailableResponse?: string;
}

export const registerCommandHandlers = (
  bot: Bot,
  userConfigStorage: UserConfigStorage,
  options: CommandHandlersOptions
) => {
  const { resolvedWebAppUrl, webAppUnavailableResponse } = options;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Привет! Я TeleDrug — ваш персональный AI-ассистент.\n\n" +
        "🧠 **Что я умею:**\n\n" +
        "📝 **Журналирование** — записывайте мысли, анализ настроения и автотеги\n" +
        "✅ **Задачи** — создание, отслеживание, умные напоминания\n" +
        "📅 **Календарь** — синхронизация с Яндекс.Календарем\n" +
        "🎙 **Голос** — отправляйте голосовые заметки, я их расшифрую\n" +
        "☀️ **Дайджесты** — утренние сводки с погодой и событиями\n\n" +
        "🚀 **Как начать:**\n" +
        "Просто напишите мне что угодно — текстом или голосом!\n\n" +
        "Примеры:\n" +
        "• \"Создай задачу купить молоко на завтра\"\n" +
        "• \"Какие планы на среду?\"\n" +
        "• \"Запиши в дневник: отличный день!\"\n" +
        "• \"Какая погода завтра?\"\n\n" +
        "📱 **Команды:**\n" +
        "/app — Мини-приложение\n" +
        "/clear — Очистить историю\n" +
        "/integrations — Показать интеграции\n" +
        "/connect_google — Подключить Google Calendar\n\n" +
        "Готов помочь! Чем займемся? 💪",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("app", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply(
        "Давайте перейдем в личные сообщения! 💬\n\nНапишите мне напрямую, и я помогу настроить ваши события."
      );
      return;
    }

    if (!resolvedWebAppUrl) {
      await ctx.reply(
        webAppUnavailableResponse ??
          "Мини-приложение сейчас недоступно. Проверьте значение WEBAPP_URL."
      );
      return;
    }

    const keyboard = new InlineKeyboard().webApp(
      "🚀 Открыть Mini App",
      resolvedWebAppUrl
    );

    await ctx.reply(
      "🚀 Готово! Нажмите кнопку ниже и откройте удобное приложение для управления событиями:",
      {
        reply_markup: keyboard,
      }
    );
  });

  bot.command("clear", async (ctx) => {
    await ctx.reply("🗑️ История очищена!");
    console.log(`🗑️ Очистка истории для чата ${ctx.chat.id}`);
  });

  bot.command("integrations", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || chatId;

    console.log(`📊 Запрос интеграций для пользователя ${userId}`);

    try {
      const effect = userConfigStorage.get(userId).pipe(
        Effect.map((config) => {
          if (config.integrations.length === 0) {
            return "📊 **Интеграции:**\n\nУ вас пока нет настроенных интеграций.";
          }

          const integrationsText = config.integrations
            .map((integration) => {
              const status = integration.enabled ? "✅" : "❌";
              return `${status} **${integration.name}**`;
            })
            .join("\n");

          return `📊 **Интеграции:**\n\n${integrationsText}`;
        }),
        Effect.catchAll((error) => {
          console.error("Ошибка при получении интеграций:", error);
          if (
            error._tag === "UserConfigError" &&
            typeof error.message === "string" &&
            error.message.includes("not found")
          ) {
            return Effect.succeed(
              "📊 **Интеграции:**\n\nПользователь не найден. Используйте /start для инициализации."
            );
          }
          return Effect.succeed(
            "❌ Ошибка при получении списка интеграций."
          );
        })
      );

      const result = await Effect.runPromise(effect);

      await ctx.reply(result, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Ошибка в команде /integrations:", error);
      await ctx.reply("❌ Произошла ошибка при получении интеграций.");
    }
  });

  bot.command("connect_google", async (ctx) => {
    try {
      console.log("🔐 /connect_google command received");
      console.log("📝 Environment variables check:", {
        API_URL: process.env.API_URL,
        hasApiUrl: !!process.env.API_URL,
      });

      const userId = ctx.from?.id;
      console.log("👤 User ID:", userId);

      if (!userId) {
        console.error("❌ User ID not found in context");
        await ctx.reply("❌ Не удалось определить ваш ID.");
        return;
      }

      // Check if API_URL is configured
      const apiUrl = process.env.API_URL;
      console.log("🌐 API_URL value:", apiUrl);

      if (!apiUrl) {
        console.error("❌ API_URL not configured in environment");
        await ctx.reply(
          "❌ OAuth сервис не настроен. Обратитесь к администратору."
        );
        return;
      }

      // Generate unique session ID
      const sessionId = crypto.randomBytes(16).toString('hex');
      console.log("🆔 Generated session ID:", sessionId);

      // Construct OAuth URL
      const authUrl = `${apiUrl}/oauth/google/start?session_id=${sessionId}&user_id=${userId}`;
      console.log("🔗 OAuth URL:", authUrl);

      console.log(`✅ Generating Google OAuth link for user ${userId}, session ${sessionId}`);

      // Create inline keyboard with authorization button
      const keyboard = new InlineKeyboard()
        .url("🔐 Авторизоваться через Google", authUrl)
        .row()
        .text("❌ Отмена", "cancel_oauth");

      console.log("⌨️ Keyboard created, sending reply...");

      await ctx.reply(
        "🗓️ **Подключение Google Calendar**\n\n" +
          "Для авторизации нажмите на кнопку ниже.\n" +
          "Вы будете перенаправлены в браузер для безопасной авторизации через Google.\n\n" +
          "⚠️ **Важно:** Убедитесь, что вы вошли в свой Google аккаунт в браузере.\n\n" +
          "После успешной авторизации вы получите уведомление здесь, в Telegram.",
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );

      console.log("✅ Reply sent successfully");
    } catch (error) {
      console.error("💥 Error in /connect_google command:", error);
      console.error("Stack trace:", error instanceof Error ? error.stack : "No stack trace");

      try {
        await ctx.reply(
          "❌ Произошла ошибка при подключении Google Calendar. Попробуйте позже."
        );
      } catch (replyError) {
        console.error("💥 Failed to send error message:", replyError);
      }
    }
  });

  // Handle cancel OAuth callback
  bot.callbackQuery("cancel_oauth", async (ctx) => {
    try {
      console.log("❌ Cancel OAuth callback triggered");
      await ctx.answerCallbackQuery();
      await ctx.deleteMessage();
      await ctx.reply("❌ Подключение Google Calendar отменено.");
      console.log("✅ Cancel callback completed");
    } catch (error) {
      console.error("💥 Error in cancel_oauth callback:", error);
      try {
        await ctx.answerCallbackQuery({ text: "Ошибка отмены" });
      } catch (answerError) {
        console.error("💥 Failed to answer callback query:", answerError);
      }
    }
  });
};
