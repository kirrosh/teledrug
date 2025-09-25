import { NextResponse, type NextRequest } from "next/server";

import { getWritableSession } from "@/lib/session";
import {
  mapTelegramAuthError,
  validateTelegramInitData,
} from "@/lib/telegram";

export const runtime = "nodejs";

interface TelegramAuthRequestBody {
  initData?: unknown;
}

export async function POST(request: NextRequest) {
  let initData: string | undefined;

  try {
    const body = (await request.json()) as TelegramAuthRequestBody;
    initData = typeof body.initData === "string" ? body.initData : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!initData) {
    return NextResponse.json({ error: "initData must be provided" }, { status: 400 });
  }

  let authResult;

  try {
    authResult = validateTelegramInitData(
      initData,
      process.env.TELEGRAM_BOT_TOKEN ?? "",
    );
  } catch (error) {
    const mapped = mapTelegramAuthError(error);
    return NextResponse.json({ error: mapped.message }, { status: 401 });
  }

  const { user, authDate } = authResult;
  const response = NextResponse.json({
    isAuthorized: true,
    telegram: user,
  });

  const session = await getWritableSession(request, response);
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

  return response;
}

