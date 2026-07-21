import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { requirePermission } from "@/lib/auth/authorization";
import { getCurrentSession } from "@/lib/auth/current-session";
import type { PermissionCode } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";
import { getAuthEnv } from "@/lib/config/server-env";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { safeErrorMetadata } from "@/lib/security/safe-error";

import {
  DailyPlanBusinessRuleError,
  DailyPlanConflictError,
  DailyPlanIdempotencyConflictError,
  DailyPlanInputError,
  DailyPlanNotFoundError,
} from "./errors";
import type { DailyPlanCommandContext, DailyPlanReadContext } from "./types";
import { parseDailyPlanIdempotencyKey } from "./validation";

export type DailyPlanApiAuthorization =
  | {
      readonly ok: true;
      readonly readContext: DailyPlanReadContext;
      readonly requestContext: ReturnType<typeof getRequestSecurityContext>;
      readonly sessionId: string;
    }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeDailyPlanApiRequest(
  request: NextRequest,
  permission: PermissionCode,
  write: boolean,
): Promise<DailyPlanApiAuthorization> {
  const requestContext = getRequestSecurityContext(request);
  try {
    if (write) {
      const origin = validateWriteRequestOrigin(request, getAuthEnv().TRUSTED_ORIGIN_SET);
      if (!origin.allowed) {
        return {
          ok: false,
          response: dailyPlanJson(
            {
              success: false,
              error: { code: "ORIGIN_REJECTED", message: "تم رفض مصدر الطلب." },
              requestId: requestContext.requestId,
            },
            403,
            requestContext.requestId,
          ),
        };
      }
    }

    const session = await getCurrentSession();
    if (!session) {
      return {
        ok: false,
        response: dailyPlanJson(
          {
            success: false,
            error: { code: "UNAUTHENTICATED", message: "يلزم تسجيل الدخول." },
            requestId: requestContext.requestId,
          },
          401,
          requestContext.requestId,
        ),
      };
    }
    requirePermission(session.user, permission);
    return {
      ok: true,
      readContext: Object.freeze({ actor: session.user }),
      requestContext,
      sessionId: session.id,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        ok: false,
        response: dailyPlanJson(
          {
            success: false,
            error: { code: "FORBIDDEN", message: error.message },
            requestId: requestContext.requestId,
          },
          403,
          requestContext.requestId,
        ),
      };
    }
    return {
      ok: false,
      response: dailyPlanApiError(error, requestContext.requestId),
    };
  }
}

export function buildDailyPlanCommandContext(
  authorization: Extract<DailyPlanApiAuthorization, { readonly ok: true }>,
  request: NextRequest,
): DailyPlanCommandContext {
  return Object.freeze({
    actor: authorization.readContext.actor,
    request: authorization.requestContext,
    idempotencyKey: parseDailyPlanIdempotencyKey(request.headers.get("idempotency-key")),
    sessionId: authorization.sessionId,
  });
}

export async function readDailyPlanJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DailyPlanInputError("جسم الطلب ليس JSON صالحًا.");
  }
}

export function dailyPlanApiError(error: unknown, requestId: string): NextResponse {
  if (error instanceof ZodError || error instanceof DailyPlanInputError) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "بيانات الطلب غير صالحة."
      : error.message;
    return dailyPlanJson(
      { success: false, error: { code: "INVALID_REQUEST", message }, requestId },
      error instanceof ZodError ? 422 : 400,
      requestId,
    );
  }
  if (error instanceof AuthorizationError) {
    return dailyPlanJson(
      { success: false, error: { code: "FORBIDDEN", message: error.message }, requestId },
      403,
      requestId,
    );
  }
  if (error instanceof DailyPlanNotFoundError) {
    return dailyPlanJson(
      { success: false, error: { code: "NOT_FOUND", message: error.message }, requestId },
      404,
      requestId,
    );
  }
  if (error instanceof DailyPlanConflictError || error instanceof DailyPlanIdempotencyConflictError) {
    return dailyPlanJson(
      { success: false, error: { code: "CONFLICT", message: error.message }, requestId },
      409,
      requestId,
    );
  }
  if (error instanceof DailyPlanBusinessRuleError) {
    return dailyPlanJson(
      { success: false, error: { code: "BUSINESS_RULE", message: error.message }, requestId },
      422,
      requestId,
    );
  }

  const code = postgresCode(error);
  if (code === "23505") {
    return dailyPlanJson(
      {
        success: false,
        error: { code: "CONFLICT", message: "توجد خطة أو عملية مسجلة بالبيانات نفسها." },
        requestId,
      },
      409,
      requestId,
    );
  }
  if (["23503", "23514", "22P02", "P0001"].includes(code ?? "")) {
    return dailyPlanJson(
      {
        success: false,
        error: {
          code: "BUSINESS_RULE",
          message: postgresMessage(error) ?? "تعذر تنفيذ العملية بسبب قيد تشغيلي.",
        },
        requestId,
      },
      422,
      requestId,
    );
  }

  console.error("daily-plans.api.failed", { requestId, ...safeErrorMetadata(error) });
  return dailyPlanJson(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "تعذر إكمال العملية الآن." },
      requestId,
    },
    500,
    requestId,
  );
}

export function dailyPlanJson(body: unknown, status: number, requestId: string): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function postgresMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
