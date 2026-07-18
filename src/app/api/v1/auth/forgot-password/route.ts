import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  PasswordResetError,
  requestPasswordResetPostgres,
} from "@/lib/auth/postgres-password-reset-service";
import { getPasswordRecoveryEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";
import { ResendPasswordResetEmailSender } from "@/lib/email/password-reset-email";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { safeErrorMetadata } from "@/lib/security/safe-error";

export const runtime = "nodejs";

const inputSchema = z.object({
  email: z.string().trim().email().max(254),
});

const genericMessage =
  "إذا كان البريد مسجلًا، فستصل رسالة التفعيل أو الاستعادة خلال دقائق.";

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
      return response(false, 400, context.requestId, "أدخل بريدًا إلكترونيًا صحيحًا.");
    }

    const sender = new ResendPasswordResetEmailSender(
      environment.RESEND_API_KEY,
      environment.EMAIL_FROM,
    );

    await requestPasswordResetPostgres(
      getDatabaseClient(),
      parsed.data.email,
      context,
      {
        authSecret: environment.AUTH_SECRET,
        appBaseUrl: environment.APP_BASE_URL,
        tokenTtlMinutes: environment.PASSWORD_RESET_TTL_MINUTES,
        maxEmailRequestsPerHour: environment.PASSWORD_RESET_EMAIL_MAX_PER_HOUR,
        maxIpRequestsPerHour: environment.PASSWORD_RESET_IP_MAX_PER_HOUR,
        allowInitialManagerBootstrap:
          environment.ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP,
        ...(environment.INITIAL_MANAGER_EMAIL
          ? { initialManagerEmail: environment.INITIAL_MANAGER_EMAIL }
          : {}),
        ...(environment.INITIAL_MANAGER_NAME
          ? { initialManagerName: environment.INITIAL_MANAGER_NAME }
          : {}),
      },
      sender,
    );

    return response(true, 200, context.requestId, genericMessage);
  } catch (error) {
    if (error instanceof PasswordResetError) {
      console.warn("auth.password_reset.request_rejected", {
        requestId: context.requestId,
        code: error.code,
      });
      return response(true, 200, context.requestId, genericMessage);
    }

    console.error("auth.password_reset.request_failed", {
      requestId: context.requestId,
      ...safeErrorMetadata(error),
    });
    return response(
      false,
      500,
      context.requestId,
      "تعذر بدء الاستعادة الآن. حاول مرة أخرى لاحقًا.",
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
