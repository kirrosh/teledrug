import { NextResponse } from "next/server";

import { getReadonlySession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getReadonlySession();

  if (!session.isAuthorized || !session.telegram) {
    return NextResponse.json({ isAuthorized: false, telegram: null });
  }

  return NextResponse.json({
    isAuthorized: Boolean(session.isAuthorized),
    telegram: session.telegram,
  });
}

