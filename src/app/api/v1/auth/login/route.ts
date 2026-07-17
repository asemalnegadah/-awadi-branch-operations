import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  loginPostgres,
  revokeSessionByToken,
} from "@/lib/auth/postgres-auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";
import { AuthenticationError } from "@/lib/auth/types";
import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { createSessionCookie } from "@/lib/http/session-cookie";
import { safeErrorMetadata } from "@/lib/security/safe-error";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestSecurityContext(request);

  try {
    const authEnv = getAuthEnv();
    const originValidation = validateWriteRequestOrigin(
      request,
      authEnv.TRUSTED_ORIGIN_SET,
    );
    if (!originValidation.allowed) {
      return json(
        {
          success: false,
          error: { code: "ORIGIN_REJECTED", message: "تم رفض مصدر الطلب." },
          requestId: context.requestId,
        },
        403,
        context.requestId,
      );
    }

    const payload: unknown = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(payload);
    if (!parsed.success) {
      return json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "أدخل البريد الإلكتروني وكلمة المرور بصورة صحيحة.",
          },
          requestId: context.requestId,
        },
        400,
        context.requestId,
      );
    }

    const sql = getDatabaseClient();
    const previousToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const result = await loginPostgres(sql, parsed.data, context, {
      authSecret: authEnv.AUTH_SECRET,
      sessionTtlHours: authEnv.SESSION_TTL_HOURS,
      sessionIdleTimeoutMinutes: authEnv.SESSION_IDLE_TIMEOUT_MINUTES,
      maxEmailAttemptsPer15Minutes:
        authEnv.LOGIN_EMAIL_MAX_PER_15_MINUTES,
      maxIpAttemptsPer15Minutes: authEnv.LOGIN_IP_MAX_PER_15_MINUTES,
    });

    if (previousToken && previousToken !== result.token) {
      await revokeSessionByToken(
        sql,
        previousToken,
        authEnv.AUTH_SECRET,
        context,
        "SESSION_ROTATED_ON_LOGIN",
      ).catch((error: unknown) => {
        console.warn("auth.login.previous_session_revoke_failed", {
          requestId: context.requestId,
          ...safeErrorMetadata(error),
        });
      });
    }

    const response = json(
      {
        success: true,
        user: {
          id: result.session.user.id,
          email: result.session.user.email,
          fullName: result.session.user.fullName,
          roles: result.session.user.roles,
          permissions: [...result.session.user.permissions],
          operatingMode: result.session.user.operatingMode,
          mustChangePassword: result.session.user.mustChangePassword,
        },
        expiresAt: result.session.expiresAt.toISOString(),
        requestId: context.requestId,
      },
      200,
      context.requestId,
    );
    response.cookies.set(createSessionCookie(result.token, result.session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      const rateLimited = error.code === "RATE_LIMITED";
      return json(
        {
          success: false,
          error: {
            code: rateLimited ? "TOO_MANY_ATTEMPTS" : "AUTHENTICATION_FAILED",
            message: "تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.",
          },
          requestId: context.requestId,
        },
        rateLimited ? 429 : 401,
        context.requestId,
        rateLimited ? { "retry-after": "900" } : undefined,
      );
    }

    console.error("auth.login.failed", {
      requestId: context.requestId,
      ...safeErrorMetadata(error),
    });

    return json(
      {
        success: false,
        error: { code: "INTERNAL_ERROR", message: "تعذر إكمال تسجيل الدخول الآن." },
        requestId: context.requestId,
      },
      500,
      context.requestId,
    );
  }
}

function json(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders?: Readonly<Record<string, string>>,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...extraHeaders,
    },
  });
}
