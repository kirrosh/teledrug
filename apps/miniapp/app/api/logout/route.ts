import { NextResponse, type NextRequest } from "next/server";

import { getWritableSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const session = await getWritableSession(request, response);
  await session.destroy();
  return response;
}
