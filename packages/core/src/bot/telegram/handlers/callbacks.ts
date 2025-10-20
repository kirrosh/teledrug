import type { Bot } from "grammy";

export const registerCallbackHandlers = (
  bot: Bot
) => {
  bot.on("callback_query:data", async (ctx) => {
    // No callback handlers registered yet
    // Add handlers here as needed
    await ctx.answerCallbackQuery();
  });
};
