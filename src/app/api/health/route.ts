import { NextResponse } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
} as const;

export async function GET() {
  try {
    const sql = getDatabaseClient();
    await sql`SELECT 1`;
    return NextResponse.json({ status: "ok", service: "awadi-branch-operations" }, { status: 200, headers: noStoreHeaders });
  } catch {
    return NextResponse.json(
      { status: "degraded", service: "awadi-branch-operations" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
