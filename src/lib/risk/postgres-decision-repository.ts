import type { Sql, TransactionSql } from "postgres";

type SqlExecutor = Sql | TransactionSql;

import {
  CreditRiskBusinessRuleError,
  CreditRiskConflictError,
  CreditRiskIdempotencyConflictError,
  CreditRiskNotFoundError,
} from "./errors";
import { deriveCreditRiskInputPostgres } from "./postgres-assessment-repository";
import type {
  CreateCreditExceptionInput,
  CreateCreditRestrictionInput,
  CreditDecisionEvent,
  CreditException,
  CreditRestriction,
  CreditRiskCommandContext,
  DecisionTransitionInput,
} from "./types";

interface RestrictionRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  customer_number: string | null;
  currency_code: "SR" | "RG";
  decision_type: CreditRestriction["decisionType"];
  limit_amount_minor: string | number | null;
  state: CreditRestriction["state"];
  reason_code: CreditRestriction["reasonCode"];
  reason_text: string;
  source_assessment_id: string | null;
  effective_from: string | Date;
  review_due_at: string | Date | null;
  expires_at: string | Date | null;
  restoration_conditions: string;
  proposed_by: string;
  proposed_by_name: string;
  proposed_at: string | Date;
  submitted_by: string | null;
  submitted_at: string | Date | null;
  approved_by: string | null;
  approved_at: string | Date | null;
  rejected_by: string | null;
  rejected_at: string | Date | null;
  rejection_reason: string | null;
  revoked_by: string | null;
  revoked_at: string | Date | null;
  revocation_reason: string | null;
  version: string | number;
  idempotency_key: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ExceptionRow {
  id: string;
  restriction_id: string;
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  currency_code: "SR" | "RG";
  scope: CreditException["scope"];
  max_amount_minor: string | number;
  valid_from: string | Date;
  valid_until: string | Date;
  state: CreditException["state"];
  reason: string;
  conditions: string;
  proposed_by: string;
  proposed_by_name: string;
  proposed_at: string | Date;
  submitted_by: string | null;
  submitted_at: string | Date | null;
  approved_by: string | null;
  approved_at: string | Date | null;
  rejected_by: string | null;
  rejected_at: string | Date | null;
  rejection_reason: string | null;
  revoked_by: string | null;
  revoked_at: string | Date | null;
  revocation_reason: string | null;
  version: string | number;
  idempotency_key: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface EventRow {
  id: string;
  parent_id: string;
  event_type: CreditDecisionEvent["eventType"];
  actor_user_id: string;
  actor_name: string;
  occurred_at: string | Date;
  old_values: Readonly<Record<string, unknown>>;
  new_values: Readonly<Record<string, unknown>>;
  reason: string | null;
  idempotency_key: string;
}

const restrictionSelect = `
  SELECT
    restriction.*,
    customer.trade_name_ar AS customer_name,
    customer.customer_number,
    proposer.full_name AS proposed_by_name
  FROM credit_restrictions AS restriction
  JOIN customers AS customer ON customer.id = restriction.customer_id
  JOIN users AS proposer ON proposer.id = restriction.proposed_by
`;

const exceptionSelect = `
  SELECT
    exception.*,
    customer.trade_name_ar AS customer_name,
    proposer.full_name AS proposed_by_name
  FROM credit_exceptions AS exception
  JOIN customers AS customer ON customer.id = exception.customer_id
  JOIN users AS proposer ON proposer.id = exception.proposed_by
`;

export async function createCreditRestrictionPostgres(
  sql: Sql,
  input: CreateCreditRestrictionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly restriction: CreditRestriction; readonly replayed: boolean }> {
  const derived = await deriveCreditRiskInputPostgres(
    sql,
    input.customerAccountId,
    representativeScopeId,
  );

  return sql.begin(async (transaction) => {
    const existing = await findRestrictionByIdempotencyKey(
      transaction,
      context.idempotencyKey,
    );
    if (existing) {
      assertSameRestrictionCreate(existing, input);
      return Object.freeze({ restriction: mapRestrictionRow(existing), replayed: true });
    }

    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO credit_restrictions (
          customer_id,
          customer_account_id,
          currency_code,
          decision_type,
          limit_amount_minor,
          reason_code,
          reason_text,
          source_assessment_id,
          effective_from,
          review_due_at,
          expires_at,
          restoration_conditions,
          proposed_by,
          idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        derived.account.customerId,
        input.customerAccountId,
        derived.account.currencyCode,
        input.decisionType,
        input.limitAmountMinor ?? null,
        input.reasonCode,
        input.reasonText,
        input.sourceAssessmentId ?? null,
        input.effectiveFrom,
        input.reviewDueAt ?? null,
        input.expiresAt ?? null,
        input.restorationConditions,
        context.actor.id,
        context.idempotencyKey,
      ],
    );

    if (!inserted[0]) {
      const raced = await findRestrictionByIdempotencyKey(
        transaction,
        context.idempotencyKey,
      );
      if (!raced) throw new CreditRiskIdempotencyConflictError();
      assertSameRestrictionCreate(raced, input);
      return Object.freeze({ restriction: mapRestrictionRow(raced), replayed: true });
    }

    const restriction = await requireRestrictionById(
      transaction,
      inserted[0].id,
      representativeScopeId,
    );
    await insertRestrictionEvent(transaction, restriction.id, "CREATED", context, null, {
      restriction: restrictionSnapshot(restriction),
    }, input.reasonText, context.idempotencyKey);
    await insertDecisionAudit(
      transaction,
      context,
      "credit_restrictions.create",
      "CREDIT_RESTRICTION",
      restriction.id,
      null,
      restrictionSnapshot(restriction),
      input.reasonText,
    );
    return Object.freeze({ restriction, replayed: false });
  });
}

export async function submitCreditRestrictionPostgres(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  return transitionRestriction(
    sql,
    restrictionId,
    input,
    context,
    representativeScopeId,
    "SUBMITTED",
  );
}

export async function approveCreditRestrictionPostgres(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  return transitionRestriction(
    sql,
    restrictionId,
    input,
    context,
    representativeScopeId,
    "APPROVED",
  );
}

export async function rejectCreditRestrictionPostgres(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new CreditRiskBusinessRuleError("سبب الرفض مطلوب.");
  return transitionRestriction(
    sql,
    restrictionId,
    input,
    context,
    representativeScopeId,
    "REJECTED",
  );
}

export async function revokeCreditRestrictionPostgres(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new CreditRiskBusinessRuleError("سبب الإلغاء مطلوب.");
  return transitionRestriction(
    sql,
    restrictionId,
    input,
    context,
    representativeScopeId,
    "REVOKED",
  );
}

export async function createCreditExceptionPostgres(
  sql: Sql,
  input: CreateCreditExceptionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly exception: CreditException; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const restriction = await requireRestrictionById(
      transaction,
      input.restrictionId,
      representativeScopeId,
      true,
    );
    if (restriction.state !== "ACTIVE") {
      throw new CreditRiskBusinessRuleError("لا يمكن إنشاء استثناء إلا لقرار ائتماني نافذ.");
    }
    if (restriction.expiresAt && input.validUntil > restriction.expiresAt) {
      throw new CreditRiskBusinessRuleError("لا يمكن أن يتجاوز الاستثناء نهاية قرار المنع.");
    }

    const existing = await findExceptionByIdempotencyKey(
      transaction,
      context.idempotencyKey,
    );
    if (existing) {
      assertSameExceptionCreate(existing, input);
      return Object.freeze({ exception: mapExceptionRow(existing), replayed: true });
    }

    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO credit_exceptions (
          restriction_id,
          customer_id,
          customer_account_id,
          currency_code,
          scope,
          max_amount_minor,
          valid_from,
          valid_until,
          reason,
          conditions,
          proposed_by,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        restriction.id,
        restriction.customerId,
        restriction.customerAccountId,
        restriction.currencyCode,
        input.scope,
        input.maxAmountMinor,
        input.validFrom,
        input.validUntil,
        input.reason,
        input.conditions,
        context.actor.id,
        context.idempotencyKey,
      ],
    );

    if (!inserted[0]) {
      const raced = await findExceptionByIdempotencyKey(
        transaction,
        context.idempotencyKey,
      );
      if (!raced) throw new CreditRiskIdempotencyConflictError();
      assertSameExceptionCreate(raced, input);
      return Object.freeze({ exception: mapExceptionRow(raced), replayed: true });
    }

    const exception = await requireExceptionById(
      transaction,
      inserted[0].id,
      representativeScopeId,
    );
    await insertExceptionEvent(transaction, exception.id, "CREATED", context, null, {
      exception: exceptionSnapshot(exception),
    }, input.reason, context.idempotencyKey);
    await insertDecisionAudit(
      transaction,
      context,
      "credit_exceptions.create",
      "CREDIT_EXCEPTION",
      exception.id,
      null,
      exceptionSnapshot(exception),
      input.reason,
    );
    return Object.freeze({ exception, replayed: false });
  });
}

export async function submitCreditExceptionPostgres(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  return transitionException(
    sql,
    exceptionId,
    input,
    context,
    representativeScopeId,
    "SUBMITTED",
  );
}

export async function approveCreditExceptionPostgres(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  return transitionException(
    sql,
    exceptionId,
    input,
    context,
    representativeScopeId,
    "APPROVED",
  );
}

export async function rejectCreditExceptionPostgres(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new CreditRiskBusinessRuleError("سبب الرفض مطلوب.");
  return transitionException(
    sql,
    exceptionId,
    input,
    context,
    representativeScopeId,
    "REJECTED",
  );
}

export async function revokeCreditExceptionPostgres(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new CreditRiskBusinessRuleError("سبب الإلغاء مطلوب.");
  return transitionException(
    sql,
    exceptionId,
    input,
    context,
    representativeScopeId,
    "REVOKED",
  );
}

export async function listCreditRestrictionsPostgres(
  sql: SqlExecutor,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<readonly CreditRestriction[]> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const rows = await sql.unsafe<RestrictionRow[]>(
    `${restrictionSelect}
     WHERE restriction.customer_account_id = $1::uuid
     ORDER BY restriction.created_at DESC, restriction.id DESC`,
    [customerAccountId],
  );
  return Object.freeze(rows.map(mapRestrictionRow));
}

export async function listCreditExceptionsPostgres(
  sql: SqlExecutor,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<readonly CreditException[]> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const rows = await sql.unsafe<ExceptionRow[]>(
    `${exceptionSelect}
     WHERE exception.customer_account_id = $1::uuid
     ORDER BY exception.created_at DESC, exception.id DESC`,
    [customerAccountId],
  );
  return Object.freeze(rows.map(mapExceptionRow));
}

export async function listCreditRestrictionEventsPostgres(
  sql: SqlExecutor,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<readonly CreditDecisionEvent[]> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const rows = await sql.unsafe<EventRow[]>(
    `
      SELECT
        event.id,
        event.restriction_id AS parent_id,
        event.event_type,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.occurred_at,
        event.old_values,
        event.new_values,
        event.reason,
        event.idempotency_key
      FROM credit_restriction_events AS event
      JOIN credit_restrictions AS restriction ON restriction.id = event.restriction_id
      JOIN users AS actor ON actor.id = event.actor_user_id
      WHERE restriction.customer_account_id = $1::uuid
      ORDER BY event.occurred_at ASC, event.id ASC
    `,
    [customerAccountId],
  );
  return Object.freeze(rows.map(mapEventRow));
}

export async function listCreditExceptionEventsPostgres(
  sql: SqlExecutor,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<readonly CreditDecisionEvent[]> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const rows = await sql.unsafe<EventRow[]>(
    `
      SELECT
        event.id,
        event.exception_id AS parent_id,
        event.event_type,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.occurred_at,
        event.old_values,
        event.new_values,
        event.reason,
        event.idempotency_key
      FROM credit_exception_events AS event
      JOIN credit_exceptions AS exception ON exception.id = event.exception_id
      JOIN users AS actor ON actor.id = event.actor_user_id
      WHERE exception.customer_account_id = $1::uuid
      ORDER BY event.occurred_at ASC, event.id ASC
    `,
    [customerAccountId],
  );
  return Object.freeze(rows.map(mapEventRow));
}

export async function evaluateCreditSalePostgres(
  sql: SqlExecutor,
  customerAccountId: string,
  amountMinor: number,
  representativeScopeId?: string,
): Promise<Readonly<{
  allowed: boolean;
  reason: string;
  restriction: CreditRestriction | null;
  exception: CreditException | null;
}>> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const restrictionRows = await sql.unsafe<RestrictionRow[]>(
    `${restrictionSelect}
     WHERE restriction.customer_account_id = $1::uuid
       AND restriction.state = 'ACTIVE'
       AND restriction.effective_from <= now()
       AND (restriction.expires_at IS NULL OR restriction.expires_at > now())
     ORDER BY restriction.effective_from DESC, restriction.id DESC
     LIMIT 1`,
    [customerAccountId],
  );
  const restriction = restrictionRows[0]
    ? mapRestrictionRow(restrictionRows[0])
    : null;
  if (!restriction) {
    return Object.freeze({ allowed: true, reason: "لا يوجد قرار منع ائتماني نافذ.", restriction: null, exception: null });
  }

  const exceptionRows = await sql.unsafe<ExceptionRow[]>(
    `${exceptionSelect}
     WHERE exception.restriction_id = $1::uuid
       AND exception.state = 'ACTIVE'
       AND exception.valid_from <= now()
       AND exception.valid_until > now()
       AND exception.max_amount_minor >= $2
     ORDER BY exception.valid_until ASC, exception.id ASC
     LIMIT 1`,
    [restriction.id, amountMinor],
  );
  const exception = exceptionRows[0] ? mapExceptionRow(exceptionRows[0]) : null;
  if (exception) {
    return Object.freeze({
      allowed: true,
      reason: "يوجد استثناء ائتماني نافذ يغطي قيمة العملية.",
      restriction,
      exception,
    });
  }

  if (
    restriction.decisionType === "LIMIT"
    && restriction.limitAmountMinor !== null
    && amountMinor <= restriction.limitAmountMinor
  ) {
    return Object.freeze({
      allowed: true,
      reason: "قيمة العملية ضمن الحد الائتماني المقيد.",
      restriction,
      exception: null,
    });
  }

  return Object.freeze({
    allowed: false,
    reason: "البيع الآجل ممنوع أو يتجاوز الحد المعتمد، ويلزم استثناء موثق.",
    restriction,
    exception: null,
  });
}

async function transitionRestriction(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId: string | undefined,
  eventType: "SUBMITTED" | "APPROVED" | "REJECTED" | "REVOKED",
): Promise<{ readonly restriction: CreditRestriction; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const replay = await findRestrictionEventReplay(
      transaction,
      context.idempotencyKey,
      restrictionId,
      eventType,
      input.reason ?? null,
    );
    if (replay) {
      return Object.freeze({
        restriction: await requireRestrictionById(
          transaction,
          restrictionId,
          representativeScopeId,
        ),
        replayed: true,
      });
    }

    const current = await requireRestrictionById(
      transaction,
      restrictionId,
      representativeScopeId,
      true,
    );
    assertVersion(current.version, input.version);
    const oldSnapshot = restrictionSnapshot(current);
    const update = restrictionTransitionUpdate(eventType, context, input);
    const rows = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE credit_restrictions
        SET state = $1,
            submitted_by = COALESCE($2::uuid, submitted_by),
            submitted_at = COALESCE($3::timestamptz, submitted_at),
            approved_by = COALESCE($4::uuid, approved_by),
            approved_at = COALESCE($5::timestamptz, approved_at),
            rejected_by = COALESCE($6::uuid, rejected_by),
            rejected_at = COALESCE($7::timestamptz, rejected_at),
            rejection_reason = COALESCE($8, rejection_reason),
            revoked_by = COALESCE($9::uuid, revoked_by),
            revoked_at = COALESCE($10::timestamptz, revoked_at),
            revocation_reason = COALESCE($11, revocation_reason)
        WHERE id = $12::uuid AND version = $13
        RETURNING id
      `,
      [
        update.state,
        update.submittedBy,
        update.submittedAt,
        update.approvedBy,
        update.approvedAt,
        update.rejectedBy,
        update.rejectedAt,
        update.rejectionReason,
        update.revokedBy,
        update.revokedAt,
        update.revocationReason,
        restrictionId,
        input.version,
      ],
    );
    if (!rows[0]) throw new CreditRiskConflictError();
    const restriction = await requireRestrictionById(
      transaction,
      restrictionId,
      representativeScopeId,
    );
    const newSnapshot = restrictionSnapshot(restriction);
    await insertRestrictionEvent(
      transaction,
      restrictionId,
      eventType,
      context,
      oldSnapshot,
      newSnapshot,
      input.reason ?? null,
      context.idempotencyKey,
    );
    await insertDecisionAudit(
      transaction,
      context,
      `credit_restrictions.${eventType.toLowerCase()}`,
      "CREDIT_RESTRICTION",
      restrictionId,
      oldSnapshot,
      newSnapshot,
      input.reason,
    );
    return Object.freeze({ restriction, replayed: false });
  });
}

async function transitionException(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
  representativeScopeId: string | undefined,
  eventType: "SUBMITTED" | "APPROVED" | "REJECTED" | "REVOKED",
): Promise<{ readonly exception: CreditException; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const replay = await findExceptionEventReplay(
      transaction,
      context.idempotencyKey,
      exceptionId,
      eventType,
      input.reason ?? null,
    );
    if (replay) {
      return Object.freeze({
        exception: await requireExceptionById(
          transaction,
          exceptionId,
          representativeScopeId,
        ),
        replayed: true,
      });
    }

    const current = await requireExceptionById(
      transaction,
      exceptionId,
      representativeScopeId,
      true,
    );
    assertVersion(current.version, input.version);
    const oldSnapshot = exceptionSnapshot(current);
    const update = exceptionTransitionUpdate(eventType, context, input);
    const rows = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE credit_exceptions
        SET state = $1,
            submitted_by = COALESCE($2::uuid, submitted_by),
            submitted_at = COALESCE($3::timestamptz, submitted_at),
            approved_by = COALESCE($4::uuid, approved_by),
            approved_at = COALESCE($5::timestamptz, approved_at),
            rejected_by = COALESCE($6::uuid, rejected_by),
            rejected_at = COALESCE($7::timestamptz, rejected_at),
            rejection_reason = COALESCE($8, rejection_reason),
            revoked_by = COALESCE($9::uuid, revoked_by),
            revoked_at = COALESCE($10::timestamptz, revoked_at),
            revocation_reason = COALESCE($11, revocation_reason)
        WHERE id = $12::uuid AND version = $13
        RETURNING id
      `,
      [
        update.state,
        update.submittedBy,
        update.submittedAt,
        update.approvedBy,
        update.approvedAt,
        update.rejectedBy,
        update.rejectedAt,
        update.rejectionReason,
        update.revokedBy,
        update.revokedAt,
        update.revocationReason,
        exceptionId,
        input.version,
      ],
    );
    if (!rows[0]) throw new CreditRiskConflictError();
    const exception = await requireExceptionById(
      transaction,
      exceptionId,
      representativeScopeId,
    );
    const newSnapshot = exceptionSnapshot(exception);
    await insertExceptionEvent(
      transaction,
      exceptionId,
      eventType,
      context,
      oldSnapshot,
      newSnapshot,
      input.reason ?? null,
      context.idempotencyKey,
    );
    await insertDecisionAudit(
      transaction,
      context,
      `credit_exceptions.${eventType.toLowerCase()}`,
      "CREDIT_EXCEPTION",
      exceptionId,
      oldSnapshot,
      newSnapshot,
      input.reason,
    );
    return Object.freeze({ exception, replayed: false });
  });
}

async function requireRestrictionById(
  sql: SqlExecutor,
  restrictionId: string,
  representativeScopeId?: string,
  lock = false,
): Promise<CreditRestriction> {
  const rows = await sql.unsafe<RestrictionRow[]>(
    `${restrictionSelect}
     WHERE restriction.id = $1::uuid
       AND (
         $2::uuid IS NULL
         OR EXISTS (
           SELECT 1
           FROM customer_rep_assignments AS assignment
           WHERE assignment.customer_id = restriction.customer_id
             AND assignment.representative_id = $2::uuid
             AND assignment.valid_from <= now()
             AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
         )
       )
     ${lock ? "FOR UPDATE OF restriction" : ""}`,
    [restrictionId, representativeScopeId ?? null],
  );
  const row = rows[0];
  if (!row) throw new CreditRiskNotFoundError("لم يتم العثور على قرار المنع المطلوب.");
  return mapRestrictionRow(row);
}

async function requireExceptionById(
  sql: SqlExecutor,
  exceptionId: string,
  representativeScopeId?: string,
  lock = false,
): Promise<CreditException> {
  const rows = await sql.unsafe<ExceptionRow[]>(
    `${exceptionSelect}
     WHERE exception.id = $1::uuid
       AND (
         $2::uuid IS NULL
         OR EXISTS (
           SELECT 1
           FROM customer_rep_assignments AS assignment
           WHERE assignment.customer_id = exception.customer_id
             AND assignment.representative_id = $2::uuid
             AND assignment.valid_from <= now()
             AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
         )
       )
     ${lock ? "FOR UPDATE OF exception" : ""}`,
    [exceptionId, representativeScopeId ?? null],
  );
  const row = rows[0];
  if (!row) throw new CreditRiskNotFoundError("لم يتم العثور على الاستثناء المطلوب.");
  return mapExceptionRow(row);
}

async function findRestrictionByIdempotencyKey(
  sql: SqlExecutor,
  key: string,
): Promise<RestrictionRow | null> {
  const rows = await sql.unsafe<RestrictionRow[]>(
    `${restrictionSelect}
     WHERE restriction.idempotency_key = $1
     FOR UPDATE OF restriction`,
    [key],
  );
  return rows[0] ?? null;
}

async function findExceptionByIdempotencyKey(
  sql: SqlExecutor,
  key: string,
): Promise<ExceptionRow | null> {
  const rows = await sql.unsafe<ExceptionRow[]>(
    `${exceptionSelect}
     WHERE exception.idempotency_key = $1
     FOR UPDATE OF exception`,
    [key],
  );
  return rows[0] ?? null;
}

async function findRestrictionEventReplay(
  sql: SqlExecutor,
  key: string,
  restrictionId: string,
  eventType: string,
  reason: string | null,
): Promise<boolean> {
  const rows = await sql.unsafe<{ restriction_id: string; event_type: string; reason: string | null }[]>(
    `SELECT restriction_id, event_type, reason
     FROM credit_restriction_events
     WHERE idempotency_key = $1
     FOR UPDATE`,
    [key],
  );
  const row = rows[0];
  if (!row) return false;
  if (
    row.restriction_id !== restrictionId
    || row.event_type !== eventType
    || row.reason !== reason
  ) {
    throw new CreditRiskIdempotencyConflictError();
  }
  return true;
}

async function findExceptionEventReplay(
  sql: SqlExecutor,
  key: string,
  exceptionId: string,
  eventType: string,
  reason: string | null,
): Promise<boolean> {
  const rows = await sql.unsafe<{ exception_id: string; event_type: string; reason: string | null }[]>(
    `SELECT exception_id, event_type, reason
     FROM credit_exception_events
     WHERE idempotency_key = $1
     FOR UPDATE`,
    [key],
  );
  const row = rows[0];
  if (!row) return false;
  if (
    row.exception_id !== exceptionId
    || row.event_type !== eventType
    || row.reason !== reason
  ) {
    throw new CreditRiskIdempotencyConflictError();
  }
  return true;
}

async function insertRestrictionEvent(
  transaction: SqlExecutor,
  restrictionId: string,
  eventType: CreditDecisionEvent["eventType"],
  context: CreditRiskCommandContext,
  oldValues: Readonly<Record<string, unknown>> | null,
  newValues: Readonly<Record<string, unknown>>,
  reason: string | null,
  idempotencyKey: string,
): Promise<void> {
  try {
    await transaction.unsafe(
      `INSERT INTO credit_restriction_events (
        restriction_id, event_type, actor_user_id, request_id,
        old_values, new_values, reason, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        restrictionId,
        eventType,
        context.actor.id,
        context.request.requestId,
        transaction.json((oldValues ?? {}) as never),
        transaction.json(newValues as never),
        reason,
        idempotencyKey,
      ],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") throw new CreditRiskIdempotencyConflictError();
    throw error;
  }
}

async function insertExceptionEvent(
  transaction: SqlExecutor,
  exceptionId: string,
  eventType: CreditDecisionEvent["eventType"],
  context: CreditRiskCommandContext,
  oldValues: Readonly<Record<string, unknown>> | null,
  newValues: Readonly<Record<string, unknown>>,
  reason: string | null,
  idempotencyKey: string,
): Promise<void> {
  try {
    await transaction.unsafe(
      `INSERT INTO credit_exception_events (
        exception_id, event_type, actor_user_id, request_id,
        old_values, new_values, reason, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        exceptionId,
        eventType,
        context.actor.id,
        context.request.requestId,
        transaction.json((oldValues ?? {}) as never),
        transaction.json(newValues as never),
        reason,
        idempotencyKey,
      ],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") throw new CreditRiskIdempotencyConflictError();
    throw error;
  }
}

async function insertDecisionAudit(
  transaction: SqlExecutor,
  context: CreditRiskCommandContext,
  action: string,
  resourceType: string,
  resourceId: string,
  previousValues: Readonly<Record<string, unknown>> | null,
  newValues: Readonly<Record<string, unknown>> | null,
  reason?: string,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO audit_logs (
        actor_user_id, actor_type, action, resource_type, resource_id,
        request_id, session_id, ip_address, user_agent, reason,
        previous_values, new_values, result, metadata
      ) VALUES (
        $1, 'USER', $2, $3, $4, $5, $6, $7::inet, $8, $9,
        $10::jsonb, $11::jsonb, 'SUCCESS',
        jsonb_build_object('operating_mode', $12::text)
      )
    `,
    [
      context.actor.id,
      action,
      resourceType,
      resourceId,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      reason ?? null,
      previousValues ? transaction.json(previousValues as never) : null,
      newValues ? transaction.json(newValues as never) : null,
      context.actor.operatingMode,
    ],
  );
}

function restrictionTransitionUpdate(
  eventType: "SUBMITTED" | "APPROVED" | "REJECTED" | "REVOKED",
  context: CreditRiskCommandContext,
  input: DecisionTransitionInput,
) {
  const now = new Date().toISOString();
  return {
    state: eventType === "SUBMITTED" ? "PENDING_APPROVAL"
      : eventType === "APPROVED" ? "ACTIVE"
        : eventType,
    submittedBy: eventType === "SUBMITTED" ? context.actor.id : null,
    submittedAt: eventType === "SUBMITTED" ? now : null,
    approvedBy: eventType === "APPROVED" ? context.actor.id : null,
    approvedAt: eventType === "APPROVED" ? now : null,
    rejectedBy: eventType === "REJECTED" ? context.actor.id : null,
    rejectedAt: eventType === "REJECTED" ? now : null,
    rejectionReason: eventType === "REJECTED" ? input.reason ?? null : null,
    revokedBy: eventType === "REVOKED" ? context.actor.id : null,
    revokedAt: eventType === "REVOKED" ? now : null,
    revocationReason: eventType === "REVOKED" ? input.reason ?? null : null,
  } as const;
}

function exceptionTransitionUpdate(
  eventType: "SUBMITTED" | "APPROVED" | "REJECTED" | "REVOKED",
  context: CreditRiskCommandContext,
  input: DecisionTransitionInput,
) {
  return restrictionTransitionUpdate(eventType, context, input);
}

function assertSameRestrictionCreate(
  row: RestrictionRow,
  input: CreateCreditRestrictionInput,
): void {
  if (
    row.customer_account_id !== input.customerAccountId
    || row.decision_type !== input.decisionType
    || nullableNumber(row.limit_amount_minor) !== (input.limitAmountMinor ?? null)
    || row.reason_code !== input.reasonCode
    || row.reason_text !== input.reasonText
    || row.source_assessment_id !== (input.sourceAssessmentId ?? null)
    || iso(row.effective_from) !== iso(input.effectiveFrom)
    || nullableIso(row.review_due_at) !== nullableIso(input.reviewDueAt ?? null)
    || nullableIso(row.expires_at) !== nullableIso(input.expiresAt ?? null)
    || row.restoration_conditions !== input.restorationConditions
  ) {
    throw new CreditRiskIdempotencyConflictError();
  }
}

function assertSameExceptionCreate(row: ExceptionRow, input: CreateCreditExceptionInput): void {
  if (
    row.restriction_id !== input.restrictionId
    || row.scope !== input.scope
    || safeInteger(row.max_amount_minor, "exception amount") !== input.maxAmountMinor
    || iso(row.valid_from) !== iso(input.validFrom)
    || iso(row.valid_until) !== iso(input.validUntil)
    || row.reason !== input.reason
    || row.conditions !== input.conditions
  ) {
    throw new CreditRiskIdempotencyConflictError();
  }
}

function restrictionSnapshot(value: CreditRestriction): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: value.id,
    customerAccountId: value.customerAccountId,
    currencyCode: value.currencyCode,
    decisionType: value.decisionType,
    limitAmountMinor: value.limitAmountMinor,
    state: value.state,
    reasonCode: value.reasonCode,
    reasonText: value.reasonText,
    effectiveFrom: value.effectiveFrom,
    expiresAt: value.expiresAt,
    version: value.version,
  });
}

function exceptionSnapshot(value: CreditException): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: value.id,
    restrictionId: value.restrictionId,
    customerAccountId: value.customerAccountId,
    currencyCode: value.currencyCode,
    scope: value.scope,
    maxAmountMinor: value.maxAmountMinor,
    validFrom: value.validFrom,
    validUntil: value.validUntil,
    state: value.state,
    version: value.version,
  });
}

function mapRestrictionRow(row: RestrictionRow): CreditRestriction {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    decisionType: row.decision_type,
    limitAmountMinor: nullableNumber(row.limit_amount_minor),
    state: row.state,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    sourceAssessmentId: row.source_assessment_id,
    effectiveFrom: iso(row.effective_from),
    reviewDueAt: nullableIso(row.review_due_at),
    expiresAt: nullableIso(row.expires_at),
    restorationConditions: row.restoration_conditions,
    proposedBy: row.proposed_by,
    proposedByName: row.proposed_by_name,
    proposedAt: iso(row.proposed_at),
    submittedBy: row.submitted_by,
    submittedAt: nullableIso(row.submitted_at),
    approvedBy: row.approved_by,
    approvedAt: nullableIso(row.approved_at),
    rejectedBy: row.rejected_by,
    rejectedAt: nullableIso(row.rejected_at),
    rejectionReason: row.rejection_reason,
    revokedBy: row.revoked_by,
    revokedAt: nullableIso(row.revoked_at),
    revocationReason: row.revocation_reason,
    version: safeInteger(row.version, "restriction version"),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapExceptionRow(row: ExceptionRow): CreditException {
  return Object.freeze({
    id: row.id,
    restrictionId: row.restriction_id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    currencyCode: row.currency_code,
    scope: row.scope,
    maxAmountMinor: safeInteger(row.max_amount_minor, "exception amount"),
    validFrom: iso(row.valid_from),
    validUntil: iso(row.valid_until),
    state: row.state,
    reason: row.reason,
    conditions: row.conditions,
    proposedBy: row.proposed_by,
    proposedByName: row.proposed_by_name,
    proposedAt: iso(row.proposed_at),
    submittedBy: row.submitted_by,
    submittedAt: nullableIso(row.submitted_at),
    approvedBy: row.approved_by,
    approvedAt: nullableIso(row.approved_at),
    rejectedBy: row.rejected_by,
    rejectedAt: nullableIso(row.rejected_at),
    rejectionReason: row.rejection_reason,
    revokedBy: row.revoked_by,
    revokedAt: nullableIso(row.revoked_at),
    revocationReason: row.revocation_reason,
    version: safeInteger(row.version, "exception version"),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapEventRow(row: EventRow): CreditDecisionEvent {
  return Object.freeze({
    id: row.id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    occurredAt: iso(row.occurred_at),
    oldValues: Object.freeze({ ...row.old_values }),
    newValues: Object.freeze({ ...row.new_values }),
    reason: row.reason,
  });
}

function assertVersion(current: number, expected: number): void {
  if (current !== expected) throw new CreditRiskConflictError("تم تعديل السجل من عملية أخرى.");
}

function safeInteger(value: string | number, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} is outside the safe integer range.`);
  }
  return number;
}

function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : safeInteger(value, "nullable amount");
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
