import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSessionByToken } from "@/lib/auth/postgres-auth-service";
import { changeOwnPasswordPostgres } from "@/lib/auth/postgres-password-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";
import { AuthenticationError } from "@/lib/auth/types";
import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { createSessionCookie } from "@/lib/http/session-cookie";
import { safeErrorMetadata } from "@/lib/security/safe-error";

export const runtime = "nodejs";

const inputSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
    confirmation: z.string().min(12).max(128),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    message: "كلمتا المرور غير متطابقتين.",
    path: ["confirmation"],
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "يجب أن تختلف كلمة المرور الجديدة عن الحالية.",
    path: ["newPassword"],
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
      return createResponse(false, 403, context.requestId, "تم رفض مصدر الطلب.");
    }

    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) {
      return createResponse(false, 401, context.requestId, "يجب تسجيل الدخول أولًا.");
    }

    const rawBody: unknown = await request.json().catch(() => null);
    const parsed = inputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return createResponse(
        false,
        400,
        context.requestId,
        parsed.error.issues[0]?.message ?? "البيانات غير صحيحة.",
      );
    }

    const sql = getDatabaseClient();
    const session = await getAuthenticatedSessionByToken(
      sql,
      token,
      authEnv.AUTH_SECRET,
      authEnv.SESSION_IDLE_TIMEOUT_MINUTES,
    );
    if (!session) {
      return createResponse(false, 401, context.requestId, "انتهت الجلسة. سجل الدخول مجددًا.");
    }

    const rotated = await changeOwnPasswordPostgres(
      sql,
      session,
      {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
      context,
      authEnv.AUTH_SECRET,
    );

    const response = createResponse(true, 200, context.requestId);
    response.cookies.set(createSessionCookie(rotated.token, rotated.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return createResponse(false, 400, context.requestId, "كلمة المرور الحالية غير صحيحة.");
    }

    console.error("auth.credential_update.failed", {
      requestId: context.requestId,
      ...safeErrorMetadata(error),
    });
    return createResponse(false, 500, context.requestId, "تعذر تحديث بيانات الدخول الآن.");
  }
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
