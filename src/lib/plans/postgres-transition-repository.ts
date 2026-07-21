import type { Sql } from "postgres";

import {
  DailyPlanBusinessRuleError,
  DailyPlanConflictError,
  DailyPlanIdempotencyConflictError,
} from "./errors";
import {
  getDailyPlanPostgres,
  requireDailyPlanPostgres,
} from "./postgres-read-repository";
import type {
  DailyPlan,
  DailyPlanCommandContext,
  DailyPlanTransitionInput,
} from "./types";

export type DailyPlanTransitionEvent =
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "STARTED"
  | "COMPLETED"
  | "CANCELLED";

export async function submitDailyPlanPostgres(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId?: string,
) {
  return transitionDailyPlan(
    sql,
    planId,
    input,
    context,
    representativeScopeId,
    "SUBMITTED",
  );
}

export async function approveDailyPlanPostgres(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId?: string,
) {
  return transitionDailyPlan(
    sql,
    planId,
    input,
    context,
    representativeScopeId,
    "APPROVED",
  );
}

export async function rejectDailyPlanPostgres(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new DailyPlanBusinessRuleError("سبب رفض الخطة مطلوب.");
  return transitionDailyPlan(
    sql,
    planId,
    input,
    context,
    representativeScopeId,
    "REJECTED",
  );
}

export async function startDailyPlanPostgres(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId?: string,
) {
  return transitionDailyPlan(
    sql,
    planId,
    input,
    context,
    representativeScopeId,
    "STARTED",
  );
}

export async function completeDailyPlanPostgres(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId?: string,
) {
  return transitionDailyPlan(
    sql,
    planId,
    input,
    context,
    representativeScopeId,
    "COMPLETED",
  );
}

export async function cancelDailyPlanPostgres(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new DailyPlanBusinessRuleError("سبب إلغاء الخطة مطلوب.");
  return transitionDailyPlan(
    sql,
    planId,
    input,
    context,
    representativeScopeId,
    "CANCELLED",
  );
}

async function transitionDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
  representativeScopeId: string | undefined,
  eventType: DailyPlanTransitionEvent,
): Promise<{ readonly plan: DailyPlan; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const current = await requireDailyPlanPostgres(
      transaction,
      planId,
      representativeScopeId,
      true,
    );
    const operationPayload = Object.freeze({
      version: input.version,
      reason: input.reason ?? null,
    });

    const replay = await findTransitionReplay(
      transaction,
      context.idempotencyKey,
      planId,
      eventType,
      operationPayload,
    );
    if (replay) {
      return Object.freeze({ plan: current, replayed: true });
    }

    if (current.version !== input.version) {
      throw new DailyPlanConflictError("تم تعديل الخطة من عملية أخرى.");
    }

    const oldSnapshot = planSnapshot(current);
    const transition = transitionValues(eventType, context, input);
    const rows = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE daily_plans
        SET state = $1,
            submitted_by = COALESCE($2::uuid, submitted_by),
            submitted_at = COALESCE($3::timestamptz, submitted_at),
            approved_by = COALESCE($4::uuid, approved_by),
            approved_at = COALESCE($5::timestamptz, approved_at),
            rejected_by = COALESCE($6::uuid, rejected_by),
            rejected_at = COALESCE($7::timestamptz, rejected_at),
            rejection_reason = COALESCE($8, rejection_reason),
            started_by = COALESCE($9::uuid, started_by),
            started_at = COALESCE($10::timestamptz, started_at),
            completed_by = COALESCE($11::uuid, completed_by),
            completed_at = COALESCE($12::timestamptz, completed_at),
            cancelled_by = COALESCE($13::uuid, cancelled_by),
            cancelled_at = COALESCE($14::timestamptz, cancelled_at),
            cancellation_reason = COALESCE($15, cancellation_reason)
        WHERE id = $16::uuid
          AND version = $17
        RETURNING id
      `,
      [
        transition.state,
        transition.submittedBy,
        transition.submittedAt,
        transition.approvedBy,
        transition.approvedAt,
        transition.rejectedBy,
        transition.rejectedAt,
        transition.rejectionReason,
        transition.startedBy,
        transition.startedAt,
        transition.completedBy,
        transition.completedAt,
        transition.cancelledBy,
        transition.cancelledAt,
        transition.cancellationReason,
        planId,
        input.version,
      ],
    );
    if (!rows[0]) throw new DailyPlanConflictError("تم تعديل الخطة من عملية أخرى.");

    const plan = await getDailyPlanPostgres(
      transaction,
      planId,
      representativeScopeId,
    );
    if (!plan) throw new DailyPlanConflictError();
    const newSnapshot = planSnapshot(plan);
    await insertTransitionEvent(
      transaction,
      planId,
      eventType,
      context,
      oldSnapshot,
      newSnapshot,
      operationPayload,
      input.reason ?? null,
    );
    await insertTransitionAudit(
      transaction,
      plan,
      eventType,
      context,
      oldSnapshot,
      newSnapshot,
      input.reason,
    );

    return Object.freeze({ plan, replayed: false });
  });
}

async function findTransitionReplay(
  transaction: Sql,
  idempotencyKey: string,
  planId: string,
  eventType: DailyPlanTransitionEvent,
  operationPayload: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const rows = await transaction.unsafe<{
    plan_id: string;
    event_type: string;
    payload_matches: boolean;
  }[]>(
    `
      SELECT
        plan_id,
        event_type,
        operation_payload = $2::jsonb AS payload_matches
      FROM daily_plan_events
      WHERE idempotency_key = $1
      FOR UPDATE
    `,
    [idempotencyKey, transaction.json(operationPayload as never)],
  );
  const row = rows[0];
  if (!row) return false;
  if (
    row.plan_id !== planId
    || row.event_type !== eventType
    || !row.payload_matches
  ) {
    throw new DailyPlanIdempotencyConflictError();
  }
  return true;
}

async function insertTransitionEvent(
  transaction: Sql,
  planId: string,
  eventType: DailyPlanTransitionEvent,
  context: DailyPlanCommandContext,
  oldValues: Readonly<Record<string, unknown>>,
  newValues: Readonly<Record<string, unknown>>,
  operationPayload: Readonly<Record<string, unknown>>,
  reason: string | null,
): Promise<void> {
  try {
    await transaction.unsafe(
      `
        INSERT INTO daily_plan_events (
          plan_id,
          event_type,
          actor_user_id,
          request_id,
          old_values,
          new_values,
          operation_payload,
          reason,
          idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9
        )
      `,
      [
        planId,
        eventType,
        context.actor.id,
        context.request.requestId,
        transaction.json(oldValues as never),
        transaction.json(newValues as never),
        transaction.json(operationPayload as never),
        reason,
        context.idempotencyKey,
      ],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") {
      throw new DailyPlanIdempotencyConflictError();
    }
    throw error;
  }
}

async function insertTransitionAudit(
  transaction: Sql,
  plan: DailyPlan,
  eventType: DailyPlanTransitionEvent,
  context: DailyPlanCommandContext,
  oldValues: Readonly<Record<string, unknown>>,
  newValues: Readonly<Record<string, unknown>>,
  reason?: string,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id,
        session_id,
        ip_address,
        user_agent,
        reason,
        previous_values,
        new_values,
        result,
        metadata
      ) VALUES (
        $1, 'USER', $2, 'DAILY_PLAN', $3, $4, $5,
        $6::inet, $7, $8, $9::jsonb, $10::jsonb, 'SUCCESS', $11::jsonb
      )
    `,
    [
      context.actor.id,
      `plans.${eventType.toLowerCase()}`,
      plan.id,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      reason ?? null,
      transaction.json(oldValues as never),
      transaction.json(newValues as never),
      transaction.json({
        operatingMode: context.actor.operatingMode,
        representativeId: plan.representativeId,
        planDate: plan.planDate,
      } as never),
    ],
  );
}

function transitionValues(
  eventType: DailyPlanTransitionEvent,
  context: DailyPlanCommandContext,
  input: DailyPlanTransitionInput,
) {
  const now = new Date().toISOString();
  return Object.freeze({
    state: eventType === "SUBMITTED"
      ? "PENDING_APPROVAL"
      : eventType === "APPROVED"
        ? "APPROVED"
        : eventType === "REJECTED"
          ? "REJECTED"
          : eventType === "STARTED"
            ? "IN_PROGRESS"
            : eventType === "COMPLETED"
              ? "COMPLETED"
              : "CANCELLED",
    submittedBy: eventType === "SUBMITTED" ? context.actor.id : null,
    submittedAt: eventType === "SUBMITTED" ? now : null,
    approvedBy: eventType === "APPROVED" ? context.actor.id : null,
    approvedAt: eventType === "APPROVED" ? now : null,
    rejectedBy: eventType === "REJECTED" ? context.actor.id : null,
    rejectedAt: eventType === "REJECTED" ? now : null,
    rejectionReason: eventType === "REJECTED" ? input.reason ?? null : null,
    startedBy: eventType === "STARTED" ? context.actor.id : null,
    startedAt: eventType === "STARTED" ? now : null,
    completedBy: eventType === "COMPLETED" ? context.actor.id : null,
    completedAt: eventType === "COMPLETED" ? now : null,
    cancelledBy: eventType === "CANCELLED" ? context.actor.id : null,
    cancelledAt: eventType === "CANCELLED" ? now : null,
    cancellationReason: eventType === "CANCELLED" ? input.reason ?? null : null,
  } as const);
}

function planSnapshot(plan: DailyPlan): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: plan.id,
    representativeId: plan.representativeId,
    planDate: plan.planDate,
    state: plan.state,
    targetCollectionSrMinor: plan.targetCollectionSrMinor,
    targetCollectionRgMinor: plan.targetCollectionRgMinor,
    targetSalesSrMinor: plan.targetSalesSrMinor,
    targetSalesRgMinor: plan.targetSalesRgMinor,
    estimatedWorkMinutes: plan.estimatedWorkMinutes,
    version: plan.version,
  });
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
