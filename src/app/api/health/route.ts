import { NextResponse } from "next/server";

const startedAt = new Date().toISOString();

export function GET() {
  return NextResponse.json(
    {
      success: true,
      service: "awadi-branch-operations",
      scope: "aden-only",
      version: "0.1.0",
      started_at: startedAt,
      checked_at: new Date().toISOString(),
      database: "not-configured",
      writes_performed: 0,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
