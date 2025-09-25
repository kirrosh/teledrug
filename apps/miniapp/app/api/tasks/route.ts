import { NextResponse } from "next/server";

import { getReadonlySession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getReadonlySession();

  if (!session.isAuthorized || !session.telegram) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: integrate with @teledrug/core task repository once UI requirements are ready.
  return NextResponse.json({ tasks: [] });
}

