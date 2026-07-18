import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PasswordPolicyError } from "@/lib/auth/password";
import {
  PasswordResetError,
  resetPasswordPostgres,
} from "@/lib/auth/postgres-password-reset-service";
import { getPasswordRecoveryEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { safeErrorMetadata } from "@/lib/security/safe-error";

export const runtime = "nodejs";

const inputSchema = z
  .object({
    token: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
    newPassword: z.string().min(12).max(128),
    confirmation: z.string().min(12).max(128),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    message: "كلمتا المرور غير متطابقتين.",
    path: ["confirmation"],
  });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = getRequestSecurityContext(request);

  try {
    const environment = getPasswordRecoveryEnv();
    const originValidation = validateWriteRequestOrigin(
      request,
      environment.TRUSTED_ORIGIN_SET,
    );
    if (!originValidation.allowed) {
      return response(false, 403, context.requestId, "تم رفض مصدر الطلب.");
    }

    const rawBody: unknown = await request.json().catch(() => null);
    const parsed = inputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return response(
        false,
        400,
        context.requestId,
        parsed.error.issues[0]?.message ?? "بيانات الاستعادة غير صحيحة.",
      );
    }

    await resetPasswordPostgres(
      getDatabaseClient(),
      parsed.data.token,
      parsed.data.newPassword,
      context,
      { authSecret: environment.AUTH_SECRET },
    );

    return response(
      true,
      200,
      context.requestId,
      "تم تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.",
    );
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return response(
        false,
        400,
        context.requestId,
        "رابط الاستعادة غير صالح أو انتهت صلاحيته.",
      );
    }

    if (error instanceof PasswordPolicyError) {
      return response(false, 400, context.requestId, error.message);
    }

    console.error("auth.password_reset.complete_failed", {
      requestId: context.requestId,
      ...safeErrorMetadata(error),
    });
    return response(
      false,
      500,
      context.requestId,
      "تعذر إكمال الاستعادة الآن. حاول مرة أخرى لاحقًا.",
    );
  }
}

function response(
  success: boolean,
  status: number,
  requestId: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    success
      ? { success: true, message, requestId }
      : { success: false, error: { message }, requestId },
    {
      status,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
