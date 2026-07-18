import { NextRequest, NextResponse } from "next/server";

import { revokeSessionByToken } from "@/lib/auth/postgres-auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";
import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { expireSessionCookie } from "@/lib/http/session-cookie";
import { safeErrorMetadata } from "@/lib/security/safe-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestSecurityContext(request);
  const authEnv = getAuthEnv();
  const originValidation = validateWriteRequestOrigin(
    request,
    authEnv.TRUSTED_ORIGIN_SET,
  );

  if (!originValidation.allowed) {
    return createResponse(false, 403, context.requestId, "تم رفض مصدر الطلب.");
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  try {
    if (token) {
      await revokeSessionByToken(
        getDatabaseClient(),
        token,
        authEnv.AUTH_SECRET,
        context,
      );
    }
  } catch (error) {
    console.error("auth.logout.failed", {
      requestId: context.requestId,
      ...safeErrorMetadata(error),
    });
  }

  const response = createResponse(true, 200, context.requestId);
  response.cookies.set(expireSessionCookie());
  return response;
}

function createResponse(
  success: boolean,
  status: number,
  requestId: string,
  message?: string,
): NextResponse {
  return NextResponse.json(
    success
      ? { success: true, requestId }
      : { success: false, error: { message }, requestId },
    {
      status,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
