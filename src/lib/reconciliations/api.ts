import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getCurrentSession } from "@/lib/auth/current-session";
import { hasPermission, type PermissionCode } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";
import { getAuthEnv } from "@/lib/config/server-env";
import { getRequestSecurityContext } from "@/lib/http/request-security-context";
import { validateWriteRequestOrigin } from "@/lib/http/same-origin";
import { safeErrorMetadata } from "@/lib/security/safe-error";

import {
  ReconciliationBusinessRuleError,
  ReconciliationConflictError,
  ReconciliationIdempotencyConflictError,
  ReconciliationInputError,
  ReconciliationNotFoundError,
} from "./errors";
import type { ReconciliationCommandContext, ReconciliationReadContext } from "./types";
import { parseReconciliationIdempotencyKey } from "./validation";

export type ReconciliationApiAuthorization =
  | {
      readonly ok: true;
      readonly readContext: ReconciliationReadContext;
      readonly requestContext: ReturnType<typeof getRequestSecurityContext>;
      readonly sessionId: string;
    }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeReconciliationApiRequest(
  request: NextRequest,
  permission: PermissionCode | readonly PermissionCode[],
  write: boolean,
): Promise<ReconciliationApiAuthorization> {
  const requestContext = getRequestSecurityContext(request);
  try {
    if (write) {
      const origin = validateWriteRequestOrigin(request, getAuthEnv().TRUSTED_ORIGIN_SET);
      if (!origin.allowed) {
        return {
          ok: false,
          response: reconciliationJson(
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
        response: reconciliationJson(
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
    const required = typeof permission === "string" ? [permission] : permission;
    if (!required.some((code) => hasPermission(session.user.permissions, code))) {
      throw new AuthorizationError();
    }
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
        response: reconciliationJson(
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
      response: reconciliationApiError(error, requestContext.requestId),
    };
  }
}

export function buildReconciliationCommandContext(
  authorization: Extract<ReconciliationApiAuthorization, { readonly ok: true }>,
  request: NextRequest,
): ReconciliationCommandContext {
  return Object.freeze({
    actor: authorization.readContext.actor,
    request: authorization.requestContext,
    idempotencyKey: parseReconciliationIdempotencyKey(
      request.headers.get("idempotency-key"),
    ),
    sessionId: authorization.sessionId,
  });
}

export async function readReconciliationJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReconciliationInputError("جسم الطلب ليس JSON صالحًا.");
  }
}

export function reconciliationApiError(error: unknown, requestId: string): NextResponse {
  if (error instanceof ZodError || error instanceof ReconciliationInputError) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "بيانات الطلب غير صالحة."
      : error.message;
    return reconciliationJson(
      { success: false, error: { code: "INVALID_REQUEST", message }, requestId },
      error instanceof ZodError ? 422 : 400,
      requestId,
    );
  }
  if (error instanceof AuthorizationError) {
    return reconciliationJson(
      { success: false, error: { code: "FORBIDDEN", message: error.message }, requestId },
      403,
      requestId,
    );
  }
  if (error instanceof ReconciliationNotFoundError) {
    return reconciliationJson(
      { success: false, error: { code: "NOT_FOUND", message: error.message }, requestId },
      404,
      requestId,
    );
  }
  if (
    error instanceof ReconciliationConflictError
    || error instanceof ReconciliationIdempotencyConflictError
  ) {
    return reconciliationJson(
      { success: false, error: { code: "CONFLICT", message: error.message }, requestId },
      409,
      requestId,
    );
  }
  if (error instanceof ReconciliationBusinessRuleError) {
    return reconciliationJson(
      { success: false, error: { code: "BUSINESS_RULE", message: error.message }, requestId },
      422,
      requestId,
    );
  }

  const code = postgresCode(error);
  if (code === "23505") {
    return reconciliationJson(
      {
        success: false,
        error: { code: "CONFLICT", message: "توجد مطابقة أو تسوية مسجلة للمصدر نفسه." },
        requestId,
      },
      409,
      requestId,
    );
  }
  if (["23503", "23514", "22P02", "P0001", "22003"].includes(code ?? "")) {
    return reconciliationJson(
      {
        success: false,
        error: {
          code: "BUSINESS_RULE",
          message: postgresMessage(error) ?? "تعذر تنفيذ العملية بسبب قيد مالي أو تشغيلي.",
        },
        requestId,
      },
      422,
      requestId,
    );
  }
  console.error("reconciliation.api.failed", {
    requestId,
    ...safeErrorMetadata(error),
  });
  return reconciliationJson(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "تعذر إكمال العملية الآن." },
      requestId,
    },
    500,
    requestId,
  );
}

export function reconciliationJson(
  body: unknown,
  status: number,
  requestId: string,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

function postgresMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : null;
}
