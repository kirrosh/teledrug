import { Effect } from "effect";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { UserConfigStorage } from "../../../services/user-config-storage";

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
      "🤖 Привет! Я AI-ассистент на Effect Framework.\n\n" +
        "Это минимальная версия бота для первой итерации миграции.\n" +
        "Просто напишите мне сообщение!"
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
};
