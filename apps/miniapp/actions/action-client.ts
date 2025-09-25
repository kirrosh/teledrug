import { createSafeActionClient } from "next-safe-action";

import { getReadonlySession, type MiniAppSession } from "@/lib/session";

export type SessionContext = {
  session: MiniAppSession;
};

const baseAction = createSafeActionClient({
  handleServerError(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    console.error("Unhandled action error", error);
    return "Произошла ошибка. Попробуйте ещё раз.";
  },
});

export const sessionAction = baseAction.use(async ({ next }) => {
  const session = await getReadonlySession();
  return next<SessionContext>({ ctx: { session } });
});

export const authorizedAction = sessionAction.use(async ({ ctx, next }) => {
  if (!ctx.session.isAuthorized || !ctx.session.telegram) {
    return {
      success: false,
      serverError: "Необходима авторизация",
    } as const;
  }

  return next({ ctx });
});
