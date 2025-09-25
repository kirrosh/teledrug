import {
  getIronSession,
  type IronSession,
  type SessionOptions,
} from "iron-session";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

const sessionPassword = process.env.IRON_SESSION_PASSWORD;

if (!sessionPassword || sessionPassword.length < 32) {
  throw new Error(
    "IRON_SESSION_PASSWORD must be set and at least 32 characters long"
  );
}

const cookieName = process.env.IRON_SESSION_COOKIE_NAME ?? "miniapp_session";

export interface TelegramSessionUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

export interface SessionData {
  isAuthorized?: boolean;
  telegram?: TelegramSessionUser;
  authDate?: number;
}

export type MiniAppSession = IronSession<SessionData>;

export const sessionOptions: SessionOptions = {
  password: sessionPassword,
  cookieName,
  ttl: 60 * 60 * 24 * 30,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
};

export const getReadonlySession = async (): Promise<MiniAppSession> =>
  getIronSession<SessionData>(await cookies(), sessionOptions);

export const getWritableSession = async (
  request: NextRequest,
  response: NextResponse
): Promise<MiniAppSession> =>
  getIronSession<SessionData>(request, response, sessionOptions);
