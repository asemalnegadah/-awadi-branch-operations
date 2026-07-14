import { NextRequest, NextResponse } from "next/server";

import { revokeSessionByToken } from "@/lib/auth/postgres-auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";
import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { isSameOriginWrite } from "@/lib/http/same-origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestSecurityContext(request);

  if (!isSameOriginWrite(request)) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "ORIGIN_REJECTED", message: "تم رفض مصدر الطلب." },
        requestId: context.requestId,
      },
      {
        status: 403,
        headers: {
          "cache-control": "no-store",
          "x-request-id": context.requestId,
        },
      },
    );
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  try {
    if (token) {
      const { AUTH_SECRET } = getAuthEnv();
      await revokeSessionByToken(
        getDatabaseClient(),
        token,
        AUTH_SECRET,
        context,
      );
    }
  } catch (error) {
    console.error("auth.logout.failed", {
      requestId: context.requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const response = NextResponse.json(
    { success: true, requestId: context.requestId },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": context.requestId,
      },
    },
  );

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
