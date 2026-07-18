import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedSessionByToken } from "@/lib/auth/postgres-auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";
import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { safeErrorMetadata } from "@/lib/security/safe-error";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = getRequestSecurityContext(request);
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return unauthorized(context.requestId);
  }

  try {
    const authEnv = getAuthEnv();
    const session = await getAuthenticatedSessionByToken(
      getDatabaseClient(),
      token,
      authEnv.AUTH_SECRET,
      authEnv.SESSION_IDLE_TIMEOUT_MINUTES,
      context,
    );
    if (!session) {
      return unauthorized(context.requestId);
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: session.user.id,
          email: session.user.email,
          fullName: session.user.fullName,
          roles: session.user.roles,
          permissions: [...session.user.permissions],
          operatingMode: session.user.operatingMode,
          mustChangePassword: session.user.mustChangePassword,
        },
        session: { expiresAt: session.expiresAt.toISOString() },
        requestId: context.requestId,
      },
      {
        status: 200,
        headers: { "cache-control": "no-store", "x-request-id": context.requestId },
      },
    );
  } catch (error) {
    console.error("auth.session.read_failed", {
      requestId: context.requestId,
      ...safeErrorMetadata(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: { code: "INTERNAL_ERROR", message: "تعذر التحقق من الجلسة الآن." },
        requestId: context.requestId,
      },
      {
        status: 500,
        headers: { "cache-control": "no-store", "x-request-id": context.requestId },
      },
    );
  }
}

function unauthorized(requestId: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "يجب تسجيل الدخول للوصول إلى النظام." },
      requestId,
    },
    {
      status: 401,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
