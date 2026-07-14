import { NextResponse } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";

const startedAt = new Date().toISOString();

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const sql = getDatabaseClient();
    const rows = await sql<{ database_time: Date | string }[]>`
      SELECT now() AS database_time
    `;
    const databaseTime = rows[0]?.database_time;

    return NextResponse.json(
      {
        success: true,
        service: "awadi-branch-operations",
        scope: "aden-only",
        version: "0.1.0",
        started_at: startedAt,
        checked_at: checkedAt,
        database: "ready",
        database_time:
          databaseTime instanceof Date
            ? databaseTime.toISOString()
            : databaseTime ?? null,
        writes_performed: 0,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        service: "awadi-branch-operations",
        scope: "aden-only",
        version: "0.1.0",
        started_at: startedAt,
        checked_at: checkedAt,
        database: "unavailable",
        writes_performed: 0,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
