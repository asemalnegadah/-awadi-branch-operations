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
  FieldVisitBusinessRuleError,
  FieldVisitConflictError,
  FieldVisitIdempotencyConflictError,
  FieldVisitInputError,
  FieldVisitNotFoundError,
} from "./errors";
import type { FieldVisitCommandContext, FieldVisitReadContext } from "./types";
import { parseFieldVisitIdempotencyKey } from "./validation";

export type FieldVisitApiAuthorization =
  | {
      readonly ok: true;
      readonly readContext: FieldVisitReadContext;
      readonly requestContext: ReturnType<typeof getRequestSecurityContext>;
      readonly sessionId: string;
    }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeFieldVisitApiRequest(
  request: NextRequest,
  permission: PermissionCode,
  write: boolean,
): Promise<FieldVisitApiAuthorization> {
  const requestContext = getRequestSecurityContext(request);
  try {
    if (write) {
      const origin = validateWriteRequestOrigin(request, getAuthEnv().TRUSTED_ORIGIN_SET);
      if (!origin.allowed) {
        return {
          ok: false,
          response: fieldVisitJson(
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
        response: fieldVisitJson(
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
        response: fieldVisitJson(
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
    return { ok: false, response: fieldVisitApiError(error, requestContext.requestId) };
  }
}

export function buildFieldVisitCommandContext(
  authorization: Extract<FieldVisitApiAuthorization, { readonly ok: true }>,
  request: NextRequest,
): FieldVisitCommandContext {
  return Object.freeze({
    actor: authorization.readContext.actor,
    request: authorization.requestContext,
    idempotencyKey: parseFieldVisitIdempotencyKey(request.headers.get("idempotency-key")),
    sessionId: authorization.sessionId,
  });
}

export async function readFieldVisitJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new FieldVisitInputError("جسم الطلب ليس JSON صالحًا.");
  }
}

export function fieldVisitApiError(error: unknown, requestId: string): NextResponse {
  if (error instanceof ZodError || error instanceof FieldVisitInputError) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "بيانات الطلب غير صالحة."
      : error.message;
    return fieldVisitJson(
      { success: false, error: { code: "INVALID_REQUEST", message }, requestId },
      error instanceof ZodError ? 422 : 400,
      requestId,
    );
  }
  if (error instanceof AuthorizationError) {
    return fieldVisitJson(
      { success: false, error: { code: "FORBIDDEN", message: error.message }, requestId },
      403,
      requestId,
    );
  }
  if (error instanceof FieldVisitNotFoundError) {
    return fieldVisitJson(
      { success: false, error: { code: "NOT_FOUND", message: error.message }, requestId },
      404,
      requestId,
    );
  }
  if (error instanceof FieldVisitConflictError || error instanceof FieldVisitIdempotencyConflictError) {
    return fieldVisitJson(
      { success: false, error: { code: "CONFLICT", message: error.message }, requestId },
      409,
      requestId,
    );
  }
  if (error instanceof FieldVisitBusinessRuleError) {
    return fieldVisitJson(
      { success: false, error: { code: "BUSINESS_RULE", message: error.message }, requestId },
      422,
      requestId,
    );
  }

  const code = postgresCode(error);
  if (code === "23505") {
    return fieldVisitJson(
      { success: false, error: { code: "CONFLICT", message: "توجد زيارة أو نتيجة مسجلة بالبيانات نفسها." }, requestId },
      409,
      requestId,
    );
  }
  if (["23503", "23514", "22P02", "P0001"].includes(code ?? "")) {
    return fieldVisitJson(
      {
        success: false,
        error: { code: "BUSINESS_RULE", message: postgresMessage(error) ?? "تعذر تنفيذ العملية بسبب قيد تشغيلي." },
        requestId,
      },
      422,
      requestId,
    );
  }

  console.error("field-visits.api.failed", { requestId, ...safeErrorMetadata(error) });
  return fieldVisitJson(
    { success: false, error: { code: "INTERNAL_ERROR", message: "تعذر إكمال العملية الآن." }, requestId },
    500,
    requestId,
  );
}

export function fieldVisitJson(body: unknown, status: number, requestId: string): NextResponse {
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
