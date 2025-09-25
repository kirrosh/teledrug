"use server";

import { z } from "zod";

import { authorizedAction, sessionAction } from "@/actions/action-client";
import { buildSessionPayload } from "@/lib/session";
import { mapTelegramAuthError, validateTelegramInitData } from "@/lib/telegram";

export const getSessionAction = sessionAction.action(async ({ ctx }) =>
  buildSessionPayload(ctx.session),
);

export const authorizeTelegramAction = sessionAction
  .inputSchema(z.object({ initData: z.string().min(1, "initData является обязательным") }))
  .action(async ({ parsedInput, ctx }) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN не настроен на сервере");
    }

    let authResult;
    try {
      authResult = validateTelegramInitData(parsedInput.initData, botToken);
    } catch (error) {
      const mapped = mapTelegramAuthError(error);
      throw new Error(mapped.message);
    }

    const { user, authDate } = authResult;
    const { session } = ctx;

    session.isAuthorized = true;
    session.authDate = authDate;
    session.telegram = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
      languageCode: user.languageCode,
    };

    await session.save();

    return buildSessionPayload(session);
  });

export const logoutAction = authorizedAction.action(async ({ ctx }) => {
  await ctx.session.destroy();
  return { ok: true } as const;
});
