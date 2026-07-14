import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { loginPostgres } from "@/lib/auth/postgres-auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";
import { AuthenticationError } from "@/lib/auth/types";
import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestSecurityContext(request);

  try {
    const payload: unknown = await request.json();
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

    const authEnv = getAuthEnv();
    const result = await loginPostgres(
      getDatabaseClient(),
      parsed.data,
      context,
      {
        authSecret: authEnv.AUTH_SECRET,
        sessionTtlHours: authEnv.SESSION_TTL_HOURS,
      },
    );

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

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: result.session.expiresAt,
      priority: "high",
    });

    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return json(
        {
          success: false,
          error: {
            code: "AUTHENTICATION_FAILED",
            message: error.message,
          },
          requestId: context.requestId,
        },
        401,
        context.requestId,
      );
    }

    console.error("auth.login.failed", {
      requestId: context.requestId,
      error: error instanceof Error ? error.message : "unknown",
    });

    return json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "تعذر إكمال تسجيل الدخول الآن.",
        },
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
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
