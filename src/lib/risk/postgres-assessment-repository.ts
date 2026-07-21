import { createHash } from "node:crypto";

import type { Sql } from "postgres";

import { calculateCreditRisk } from "./scoring";
import {
  CreditRiskIdempotencyConflictError,
  CreditRiskNotFoundError,
} from "./errors";
import type {
  CreditException,
  CreditRestriction,
  CreditRiskAccountItem,
  CreditRiskAssessment,
  CreditRiskCommandContext,
  CreditRiskInput,
  CreditRiskListFilters,
  CreditRiskPage,
  CustomerOperationalStatus,
} from "./types";

interface AccountRow {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_number: string | null;
  lifecycle_status: string;
  account_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  currency_code: "SR" | "RG";
  credit_limit_minor: string | number | null;
  has_usable_phone: boolean;
  total_outstanding_minor: string | number;
  overdue_31_60_minor: string | number;
  overdue_61_90_minor: string | number;
  overdue_91_180_minor: string | number;
  overdue_over_180_minor: string | number;
  broken_promises_count: string | number;
  overdue_promise_amount_minor: string | number;
  unhanded_collection_amount_minor: string | number;
}

interface AssessmentRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  customer_number: string | null;
  currency_code: "SR" | "RG";
  cutoff_at: string | Date;
  assessed_at: string | Date;
  ruleset_version: string;
  score: string | number;
  risk_level: CreditRiskAssessment["riskLevel"];
  recommended_action: CreditRiskAssessment["recommendedAction"];
  automatic_block_recommended: boolean;
  data_quality_score: string | number;
  factors: CreditRiskAssessment["factors"];
  missing_inputs: string[];
  source_snapshot: Readonly<Record<string, unknown>>;
  input_fingerprint: string;
  supersedes_assessment_id: string | null;
  assessed_by: string;
  assessed_by_name: string;
}

interface AccountListRow {
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  customer_number: string | null;
  currency_code: "SR" | "RG";
  account_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  credit_limit_minor: string | number | null;
  assessment: AssessmentJson | null;
  active_restriction: RestrictionJson | null;
  active_exception: ExceptionJson | null;
}

interface AssessmentJson {
  id: string;
  cutoffAt: string;
  assessedAt: string;
  rulesetVersion: string;
  score: number;
  riskLevel: CreditRiskAssessment["riskLevel"];
  recommendedAction: CreditRiskAssessment["recommendedAction"];
  automaticBlockRecommended: boolean;
  dataQualityScore: number;
  factors: CreditRiskAssessment["factors"];
  missingInputs: string[];
  sourceSnapshot: Readonly<Record<string, unknown>>;
  inputFingerprint: string;
  supersedesAssessmentId: string | null;
  assessedBy: string;
  assessedByName: string;
}

interface RestrictionJson {
  id: string;
  decisionType: CreditRestriction["decisionType"];
  limitAmountMinor: number | null;
  state: CreditRestriction["state"];
  reasonCode: CreditRestriction["reasonCode"];
  reasonText: string;
  sourceAssessmentId: string | null;
  effectiveFrom: string;
  reviewDueAt: string | null;
  expiresAt: string | null;
  restorationConditions: string;
  proposedBy: string;
  proposedByName: string;
  proposedAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ExceptionJson {
  id: string;
  restrictionId: string;
  scope: CreditException["scope"];
  maxAmountMinor: number;
  validFrom: string;
  validUntil: string;
  state: CreditException["state"];
  reason: string;
  conditions: string;
  proposedBy: string;
  proposedByName: string;
  proposedAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DerivedCreditRiskInput {
  readonly account: Readonly<{
    id: string;
    customerId: string;
    customerName: string;
    customerNumber: string | null;
    currencyCode: "SR" | "RG";
    accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
    creditLimitMinor: number | null;
  }>;
  readonly input: CreditRiskInput;
  readonly sourceSnapshot: Readonly<Record<string, unknown>>;
}

const assessmentSelect = `
  SELECT
    assessment.id,
    assessment.customer_id,
    assessment.customer_account_id,
    customer.trade_name_ar AS customer_name,
    customer.customer_number,
    assessment.currency_code,
    assessment.cutoff_at,
    assessment.assessed_at,
    assessment.ruleset_version,
    assessment.score,
    assessment.risk_level,
    assessment.recommended_action,
    assessment.automatic_block_recommended,
    assessment.data_quality_score,
    assessment.factors,
    assessment.missing_inputs,
    assessment.source_snapshot,
    assessment.input_fingerprint,
    assessment.supersedes_assessment_id,
    assessment.assessed_by,
    actor.full_name AS assessed_by_name
  FROM credit_risk_assessments AS assessment
  JOIN customers AS customer ON customer.id = assessment.customer_id
  JOIN users AS actor ON actor.id = assessment.assessed_by
`;

export async function deriveCreditRiskInputPostgres(
  sql: Sql,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<DerivedCreditRiskInput> {
  const rows = await sql.unsafe<AccountRow[]>(
    `
      WITH selected_account AS (
        SELECT
          account.id,
          account.customer_id,
          customer.trade_name_ar AS customer_name,
          customer.customer_number,
          customer.lifecycle_status,
          account.status AS account_status,
          account.currency_code,
          account.credit_limit_minor
        FROM customer_accounts AS account
        JOIN customers AS customer ON customer.id = account.customer_id
        WHERE account.id = $1::uuid
          AND customer.deleted_at IS NULL
          AND customer.merged_into_customer_id IS NULL
          AND (
            $2::uuid IS NULL
            OR EXISTS (
              SELECT 1
              FROM customer_rep_assignments AS assignment
              WHERE assignment.customer_id = account.customer_id
                AND assignment.representative_id = $2::uuid
                AND assignment.valid_from <= now()
                AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
            )
          )
      ),
      ledger_totals AS (
        SELECT
          COALESCE(SUM(CASE WHEN entry.direction = 'DEBIT' THEN entry.amount_minor ELSE 0 END), 0)::bigint AS total_debits,
          COALESCE(SUM(CASE WHEN entry.direction = 'CREDIT' THEN entry.amount_minor ELSE 0 END), 0)::bigint AS total_credits
        FROM customer_ledger_entries AS entry
        WHERE entry.customer_account_id = $1::uuid
      ),
      debit_rows AS (
        SELECT
          entry.id,
          entry.accounting_date,
          entry.amount_minor,
          COALESCE(
            SUM(entry.amount_minor) OVER (
              ORDER BY entry.accounting_date ASC, entry.posted_at ASC, entry.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          )::bigint AS older_debit_total
        FROM customer_ledger_entries AS entry
        WHERE entry.customer_account_id = $1::uuid
          AND entry.direction = 'DEBIT'
      ),
      remaining_debits AS (
        SELECT
          debit.accounting_date,
          GREATEST(
            LEAST(
              debit.amount_minor,
              GREATEST(ledger.total_debits - ledger.total_credits, 0) - debit.older_debit_total
            ),
            0
          )::bigint AS remaining_minor
        FROM debit_rows AS debit
        CROSS JOIN ledger_totals AS ledger
      ),
      aging AS (
        SELECT
          COALESCE(SUM(remaining_minor), 0)::bigint AS total_outstanding_minor,
          COALESCE(SUM(remaining_minor) FILTER (
            WHERE ((now() AT TIME ZONE 'Asia/Aden')::date - accounting_date) BETWEEN 31 AND 60
          ), 0)::bigint AS overdue_31_60_minor,
          COALESCE(SUM(remaining_minor) FILTER (
            WHERE ((now() AT TIME ZONE 'Asia/Aden')::date - accounting_date) BETWEEN 61 AND 90
          ), 0)::bigint AS overdue_61_90_minor,
          COALESCE(SUM(remaining_minor) FILTER (
            WHERE ((now() AT TIME ZONE 'Asia/Aden')::date - accounting_date) BETWEEN 91 AND 180
          ), 0)::bigint AS overdue_91_180_minor,
          COALESCE(SUM(remaining_minor) FILTER (
            WHERE ((now() AT TIME ZONE 'Asia/Aden')::date - accounting_date) > 180
          ), 0)::bigint AS overdue_over_180_minor
        FROM remaining_debits
      ),
      promise_metrics AS (
        SELECT
          COUNT(*)::bigint AS broken_promises_count,
          COALESCE(SUM(promise.remaining_amount_minor), 0)::bigint AS overdue_promise_amount_minor
        FROM payment_promises AS promise
        WHERE promise.customer_account_id = $1::uuid
          AND promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED')
          AND promise.due_date < (now() AT TIME ZONE 'Asia/Aden')::date
      ),
      collection_metrics AS (
        SELECT COALESCE(SUM(collection.amount_minor), 0)::bigint AS unhanded_collection_amount_minor
        FROM collections AS collection
        WHERE collection.customer_account_id = $1::uuid
          AND collection.state = 'APPROVED'
          AND collection.reversed_at IS NULL
      )
      SELECT
        account.id,
        account.customer_id,
        account.customer_name,
        account.customer_number,
        account.lifecycle_status,
        account.account_status,
        account.currency_code,
        account.credit_limit_minor,
        EXISTS (
          SELECT 1
          FROM customer_contacts AS contact
          WHERE contact.customer_id = account.customer_id
            AND contact.deleted_at IS NULL
            AND contact.contact_type IN ('PHONE', 'WHATSAPP')
            AND NULLIF(btrim(contact.contact_value), '') IS NOT NULL
        ) AS has_usable_phone,
        aging.total_outstanding_minor,
        aging.overdue_31_60_minor,
        aging.overdue_61_90_minor,
        aging.overdue_91_180_minor,
        aging.overdue_over_180_minor,
        promise_metrics.broken_promises_count,
        promise_metrics.overdue_promise_amount_minor,
        collection_metrics.unhanded_collection_amount_minor
      FROM selected_account AS account
      CROSS JOIN aging
      CROSS JOIN promise_metrics
      CROSS JOIN collection_metrics
    `,
    [customerAccountId, representativeScopeId ?? null],
  );
  const row = rows[0];
  if (!row) throw new CreditRiskNotFoundError("لم يتم العثور على حساب العميل ضمن نطاقك.");

  const cutoffAt = new Date().toISOString();
  const totalOutstandingMinor = safeInteger(row.total_outstanding_minor, "total outstanding");
  const overdue31To60Minor = safeInteger(row.overdue_31_60_minor, "aging 31-60");
  const overdue61To90Minor = safeInteger(row.overdue_61_90_minor, "aging 61-90");
  const overdue91To180Minor = safeInteger(row.overdue_91_180_minor, "aging 91-180");
  const overdueOver180Minor = safeInteger(row.overdue_over_180_minor, "aging over 180");
  const brokenPromisesCount = safeInteger(row.broken_promises_count, "broken promises");
  const overduePromiseAmountMinor = safeInteger(
    row.overdue_promise_amount_minor,
    "overdue promise amount",
  );
  const unhandedCollectionAmountMinor = safeInteger(
    row.unhanded_collection_amount_minor,
    "unhanded collection amount",
  );
  const creditLimitMinor = nullableSafeInteger(row.credit_limit_minor, "credit limit");
  const customerOperationalStatus = mapOperationalStatus(row.lifecycle_status);
  const missingInputs = Object.freeze([
    "daysSinceLastVisit",
    "unresolvedReconciliationCount",
  ]);

  const input: CreditRiskInput = Object.freeze({
    currencyCode: row.currency_code,
    cutoffAt,
    totalOutstandingMinor,
    overdue31To60Minor,
    overdue61To90Minor,
    overdue91To180Minor,
    overdueOver180Minor,
    creditLimitMinor,
    brokenPromisesCount,
    overduePromiseAmountMinor,
    unresolvedReconciliationCount: 0,
    customerOperationalStatus,
    hasUsablePhone: row.has_usable_phone,
    daysSinceLastVisit: null,
    unhandedCollectionAmountMinor,
    missingInputs,
  });
  const sourceSnapshot = Object.freeze({
    derivationPolicy: "ledger-oldest-debit-first-v1",
    currencyCode: row.currency_code,
    totalOutstandingMinor,
    overdue31To60Minor,
    overdue61To90Minor,
    overdue91To180Minor,
    overdueOver180Minor,
    creditLimitMinor,
    brokenPromisesCount,
    overduePromiseAmountMinor,
    unresolvedReconciliationCount: 0,
    customerOperationalStatus,
    hasUsablePhone: row.has_usable_phone,
    daysSinceLastVisit: null,
    unhandedCollectionAmountMinor,
    missingInputs,
  });

  return Object.freeze({
    account: Object.freeze({
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerNumber: row.customer_number,
      currencyCode: row.currency_code,
      accountStatus: row.account_status,
      creditLimitMinor,
    }),
    input,
    sourceSnapshot,
  });
}

export async function recalculateCreditRiskPostgres(
  sql: Sql,
  customerAccountId: string,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly assessment: CreditRiskAssessment; readonly replayed: boolean }> {
  const derived = await deriveCreditRiskInputPostgres(
    sql,
    customerAccountId,
    representativeScopeId,
  );
  const result = calculateCreditRisk(derived.input);
  const fingerprint = fingerprintInput(derived.input, derived.sourceSnapshot);

  return sql.begin(async (transaction) => {
    const existing = await findAssessmentByIdempotencyKey(
      transaction,
      context.idempotencyKey,
    );
    if (existing) {
      assertAssessmentReplay(existing, customerAccountId, fingerprint);
      return Object.freeze({ assessment: mapAssessmentRow(existing), replayed: true });
    }

    const previousRows = await transaction.unsafe<{ id: string }[]>(
      `
        SELECT id
        FROM credit_risk_assessments
        WHERE customer_account_id = $1::uuid
        ORDER BY cutoff_at DESC, assessed_at DESC, id DESC
        LIMIT 1
        FOR SHARE
      `,
      [customerAccountId],
    );

    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO credit_risk_assessments (
          customer_id,
          customer_account_id,
          currency_code,
          cutoff_at,
          ruleset_version,
          score,
          risk_level,
          recommended_action,
          automatic_block_recommended,
          data_quality_score,
          factors,
          missing_inputs,
          source_snapshot,
          input_fingerprint,
          supersedes_assessment_id,
          assessed_by,
          request_id,
          idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11::jsonb, $12::text[], $13::jsonb, $14, $15, $16, $17, $18
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        derived.account.customerId,
        customerAccountId,
        derived.account.currencyCode,
        result.cutoffAt,
        result.rulesetVersion,
        result.score,
        result.riskLevel,
        result.recommendedAction,
        result.automaticBlockRecommended,
        result.dataQualityScore,
        transaction.json(result.factors as never),
        [...result.missingInputs],
        transaction.json(derived.sourceSnapshot as never),
        fingerprint,
        previousRows[0]?.id ?? null,
        context.actor.id,
        context.request.requestId,
        context.idempotencyKey,
      ],
    );

    if (!inserted[0]) {
      const raced = await findAssessmentByIdempotencyKey(
        transaction,
        context.idempotencyKey,
      );
      if (!raced) throw new CreditRiskIdempotencyConflictError();
      assertAssessmentReplay(raced, customerAccountId, fingerprint);
      return Object.freeze({ assessment: mapAssessmentRow(raced), replayed: true });
    }

    const assessment = await requireAssessmentById(transaction, inserted[0].id);
    await insertAssessmentAudit(transaction, context, assessment);
    return Object.freeze({ assessment, replayed: false });
  });
}

export async function listCreditRiskAccountsPostgres(
  sql: Sql,
  filters: CreditRiskListFilters,
  representativeScopeId?: string,
): Promise<CreditRiskPage> {
  const rows = await sql.unsafe<AccountListRow[]>(
    `
      SELECT
        customer.id AS customer_id,
        account.id AS customer_account_id,
        customer.trade_name_ar AS customer_name,
        customer.customer_number,
        account.currency_code,
        account.status AS account_status,
        account.credit_limit_minor,
        CASE WHEN assessment.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', assessment.id,
          'cutoffAt', assessment.cutoff_at,
          'assessedAt', assessment.assessed_at,
          'rulesetVersion', assessment.ruleset_version,
          'score', assessment.score,
          'riskLevel', assessment.risk_level,
          'recommendedAction', assessment.recommended_action,
          'automaticBlockRecommended', assessment.automatic_block_recommended,
          'dataQualityScore', assessment.data_quality_score,
          'factors', assessment.factors,
          'missingInputs', assessment.missing_inputs,
          'sourceSnapshot', assessment.source_snapshot,
          'inputFingerprint', assessment.input_fingerprint,
          'supersedesAssessmentId', assessment.supersedes_assessment_id,
          'assessedBy', assessment.assessed_by,
          'assessedByName', assessed_actor.full_name
        ) END AS assessment,
        CASE WHEN restriction.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', restriction.id,
          'decisionType', restriction.decision_type,
          'limitAmountMinor', restriction.limit_amount_minor,
          'state', restriction.state,
          'reasonCode', restriction.reason_code,
          'reasonText', restriction.reason_text,
          'sourceAssessmentId', restriction.source_assessment_id,
          'effectiveFrom', restriction.effective_from,
          'reviewDueAt', restriction.review_due_at,
          'expiresAt', restriction.expires_at,
          'restorationConditions', restriction.restoration_conditions,
          'proposedBy', restriction.proposed_by,
          'proposedByName', restriction_actor.full_name,
          'proposedAt', restriction.proposed_at,
          'submittedBy', restriction.submitted_by,
          'submittedAt', restriction.submitted_at,
          'approvedBy', restriction.approved_by,
          'approvedAt', restriction.approved_at,
          'rejectedBy', restriction.rejected_by,
          'rejectedAt', restriction.rejected_at,
          'rejectionReason', restriction.rejection_reason,
          'revokedBy', restriction.revoked_by,
          'revokedAt', restriction.revoked_at,
          'revocationReason', restriction.revocation_reason,
          'version', restriction.version,
          'createdAt', restriction.created_at,
          'updatedAt', restriction.updated_at
        ) END AS active_restriction,
        CASE WHEN exception.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', exception.id,
          'restrictionId', exception.restriction_id,
          'scope', exception.scope,
          'maxAmountMinor', exception.max_amount_minor,
          'validFrom', exception.valid_from,
          'validUntil', exception.valid_until,
          'state', exception.state,
          'reason', exception.reason,
          'conditions', exception.conditions,
          'proposedBy', exception.proposed_by,
          'proposedByName', exception_actor.full_name,
          'proposedAt', exception.proposed_at,
          'submittedBy', exception.submitted_by,
          'submittedAt', exception.submitted_at,
          'approvedBy', exception.approved_by,
          'approvedAt', exception.approved_at,
          'rejectedBy', exception.rejected_by,
          'rejectedAt', exception.rejected_at,
          'rejectionReason', exception.rejection_reason,
          'revokedBy', exception.revoked_by,
          'revokedAt', exception.revoked_at,
          'revocationReason', exception.revocation_reason,
          'version', exception.version,
          'createdAt', exception.created_at,
          'updatedAt', exception.updated_at
        ) END AS active_exception
      FROM customer_accounts AS account
      JOIN customers AS customer ON customer.id = account.customer_id
      LEFT JOIN current_credit_risk_assessments AS assessment
        ON assessment.customer_account_id = account.id
      LEFT JOIN users AS assessed_actor ON assessed_actor.id = assessment.assessed_by
      LEFT JOIN LATERAL (
        SELECT item.*
        FROM credit_restrictions AS item
        WHERE item.customer_account_id = account.id
          AND item.state = 'ACTIVE'
        ORDER BY item.effective_from DESC, item.id DESC
        LIMIT 1
      ) AS restriction ON true
      LEFT JOIN users AS restriction_actor ON restriction_actor.id = restriction.proposed_by
      LEFT JOIN LATERAL (
        SELECT item.*
        FROM credit_exceptions AS item
        WHERE item.customer_account_id = account.id
          AND item.state = 'ACTIVE'
          AND item.valid_from <= now()
          AND item.valid_until > now()
        ORDER BY item.valid_until DESC, item.id DESC
        LIMIT 1
      ) AS exception ON true
      LEFT JOIN users AS exception_actor ON exception_actor.id = exception.proposed_by
      WHERE customer.deleted_at IS NULL
        AND customer.merged_into_customer_id IS NULL
        AND ($1::text IS NULL OR account.currency_code = $1)
        AND ($2::text IS NULL OR assessment.risk_level = $2)
        AND ($3::text IS NULL OR restriction.state = $3 OR exception.state = $3)
        AND (
          $4::text IS NULL
          OR customer.trade_name_ar ILIKE '%' || $4 || '%'
          OR customer.customer_number ILIKE '%' || $4 || '%'
        )
        AND ($5::uuid IS NULL OR account.id > $5::uuid)
        AND (
          $6::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM customer_rep_assignments AS assignment
            WHERE assignment.customer_id = customer.id
              AND assignment.representative_id = $6::uuid
              AND assignment.valid_from <= now()
              AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
          )
        )
      ORDER BY account.id ASC
      LIMIT $7
    `,
    [
      filters.currencyCode ?? null,
      filters.riskLevel ?? null,
      filters.decisionState ?? null,
      filters.query ?? null,
      filters.cursor ?? null,
      representativeScopeId ?? null,
      filters.limit + 1,
    ],
  );
  const hasMore = rows.length > filters.limit;
  const selected = hasMore ? rows.slice(0, filters.limit) : rows;
  return Object.freeze({
    items: Object.freeze(selected.map(mapAccountListRow)),
    nextCursor: hasMore ? selected.at(-1)?.customer_account_id ?? null : null,
  });
}

export async function getAssessmentHistoryPostgres(
  sql: Sql,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<readonly CreditRiskAssessment[]> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const rows = await sql.unsafe<AssessmentRow[]>(
    `${assessmentSelect}
     WHERE assessment.customer_account_id = $1::uuid
     ORDER BY assessment.cutoff_at DESC, assessment.assessed_at DESC, assessment.id DESC`,
    [customerAccountId],
  );
  return Object.freeze(rows.map(mapAssessmentRow));
}

export async function getCurrentAssessmentPostgres(
  sql: Sql,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<CreditRiskAssessment | null> {
  await deriveCreditRiskInputPostgres(sql, customerAccountId, representativeScopeId);
  const rows = await sql.unsafe<AssessmentRow[]>(
    `${assessmentSelect}
     WHERE assessment.id = (
       SELECT current.id
       FROM current_credit_risk_assessments AS current
       WHERE current.customer_account_id = $1::uuid
     )`,
    [customerAccountId],
  );
  return rows[0] ? mapAssessmentRow(rows[0]) : null;
}

async function requireAssessmentById(sql: Sql, assessmentId: string): Promise<CreditRiskAssessment> {
  const rows = await sql.unsafe<AssessmentRow[]>(
    `${assessmentSelect} WHERE assessment.id = $1::uuid`,
    [assessmentId],
  );
  const row = rows[0];
  if (!row) throw new CreditRiskNotFoundError();
  return mapAssessmentRow(row);
}

async function findAssessmentByIdempotencyKey(
  sql: Sql,
  idempotencyKey: string,
): Promise<AssessmentRow | null> {
  const rows = await sql.unsafe<AssessmentRow[]>(
    `${assessmentSelect}
     WHERE assessment.idempotency_key = $1
     FOR UPDATE OF assessment`,
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

function assertAssessmentReplay(
  row: AssessmentRow,
  customerAccountId: string,
  fingerprint: string,
): void {
  if (
    row.customer_account_id !== customerAccountId
    || row.input_fingerprint !== fingerprint
  ) {
    throw new CreditRiskIdempotencyConflictError();
  }
}

async function insertAssessmentAudit(
  transaction: Sql,
  context: CreditRiskCommandContext,
  assessment: CreditRiskAssessment,
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
        new_values,
        result,
        metadata
      ) VALUES (
        $1, 'USER', 'risk.recalculate', 'CREDIT_RISK_ASSESSMENT', $2,
        $3, $4, $5::inet, $6, $7::jsonb, 'SUCCESS',
        jsonb_build_object('ruleset_version', $8::text, 'currency_code', $9::text)
      )
    `,
    [
      context.actor.id,
      assessment.id,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      transaction.json({
        customerAccountId: assessment.customerAccountId,
        score: assessment.score,
        riskLevel: assessment.riskLevel,
        recommendedAction: assessment.recommendedAction,
      } as never),
      assessment.rulesetVersion,
      assessment.currencyCode,
    ],
  );
}

function mapAssessmentRow(row: AssessmentRow): CreditRiskAssessment {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    cutoffAt: iso(row.cutoff_at),
    assessedAt: iso(row.assessed_at),
    rulesetVersion: row.ruleset_version,
    score: safeInteger(row.score, "assessment score"),
    riskLevel: row.risk_level,
    recommendedAction: row.recommended_action,
    automaticBlockRecommended: row.automatic_block_recommended,
    dataQualityScore: safeInteger(row.data_quality_score, "data quality score"),
    factors: Object.freeze(row.factors),
    missingInputs: Object.freeze([...row.missing_inputs]),
    sourceSnapshot: Object.freeze({ ...row.source_snapshot }),
    inputFingerprint: row.input_fingerprint,
    supersedesAssessmentId: row.supersedes_assessment_id,
    assessedBy: row.assessed_by,
    assessedByName: row.assessed_by_name,
  });
}

function mapAccountListRow(row: AccountListRow): CreditRiskAccountItem {
  return Object.freeze({
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    accountStatus: row.account_status,
    creditLimitMinor: nullableSafeInteger(row.credit_limit_minor, "credit limit"),
    assessment: row.assessment ? mapAssessmentJson(row, row.assessment) : null,
    activeRestriction: row.active_restriction
      ? mapRestrictionJson(row, row.active_restriction)
      : null,
    activeException: row.active_exception ? mapExceptionJson(row, row.active_exception) : null,
  });
}

function mapAssessmentJson(row: AccountListRow, value: AssessmentJson): CreditRiskAssessment {
  return Object.freeze({
    id: value.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    cutoffAt: iso(value.cutoffAt),
    assessedAt: iso(value.assessedAt),
    rulesetVersion: value.rulesetVersion,
    score: safeInteger(value.score, "assessment score"),
    riskLevel: value.riskLevel,
    recommendedAction: value.recommendedAction,
    automaticBlockRecommended: value.automaticBlockRecommended,
    dataQualityScore: safeInteger(value.dataQualityScore, "data quality score"),
    factors: Object.freeze(value.factors),
    missingInputs: Object.freeze([...value.missingInputs]),
    sourceSnapshot: Object.freeze({ ...value.sourceSnapshot }),
    inputFingerprint: value.inputFingerprint,
    supersedesAssessmentId: value.supersedesAssessmentId,
    assessedBy: value.assessedBy,
    assessedByName: value.assessedByName,
  });
}

function mapRestrictionJson(row: AccountListRow, value: RestrictionJson): CreditRestriction {
  return Object.freeze({
    id: value.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    decisionType: value.decisionType,
    limitAmountMinor: nullableSafeInteger(value.limitAmountMinor, "restriction limit"),
    state: value.state,
    reasonCode: value.reasonCode,
    reasonText: value.reasonText,
    sourceAssessmentId: value.sourceAssessmentId,
    effectiveFrom: iso(value.effectiveFrom),
    reviewDueAt: nullableIso(value.reviewDueAt),
    expiresAt: nullableIso(value.expiresAt),
    restorationConditions: value.restorationConditions,
    proposedBy: value.proposedBy,
    proposedByName: value.proposedByName,
    proposedAt: iso(value.proposedAt),
    submittedBy: value.submittedBy,
    submittedAt: nullableIso(value.submittedAt),
    approvedBy: value.approvedBy,
    approvedAt: nullableIso(value.approvedAt),
    rejectedBy: value.rejectedBy,
    rejectedAt: nullableIso(value.rejectedAt),
    rejectionReason: value.rejectionReason,
    revokedBy: value.revokedBy,
    revokedAt: nullableIso(value.revokedAt),
    revocationReason: value.revocationReason,
    version: safeInteger(value.version, "restriction version"),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  });
}

function mapExceptionJson(row: AccountListRow, value: ExceptionJson): CreditException {
  return Object.freeze({
    id: value.id,
    restrictionId: value.restrictionId,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    currencyCode: row.currency_code,
    scope: value.scope,
    maxAmountMinor: safeInteger(value.maxAmountMinor, "exception amount"),
    validFrom: iso(value.validFrom),
    validUntil: iso(value.validUntil),
    state: value.state,
    reason: value.reason,
    conditions: value.conditions,
    proposedBy: value.proposedBy,
    proposedByName: value.proposedByName,
    proposedAt: iso(value.proposedAt),
    submittedBy: value.submittedBy,
    submittedAt: nullableIso(value.submittedAt),
    approvedBy: value.approvedBy,
    approvedAt: nullableIso(value.approvedAt),
    rejectedBy: value.rejectedBy,
    rejectedAt: nullableIso(value.rejectedAt),
    rejectionReason: value.rejectionReason,
    revokedBy: value.revokedBy,
    revokedAt: nullableIso(value.revokedAt),
    revocationReason: value.revocationReason,
    version: safeInteger(value.version, "exception version"),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  });
}

function fingerprintInput(
  input: CreditRiskInput,
  sourceSnapshot: Readonly<Record<string, unknown>>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ input, sourceSnapshot }))
    .digest("hex");
}

function mapOperationalStatus(value: string): CustomerOperationalStatus {
  if (value === "BANKRUPT") return "BANKRUPT";
  if (value === "TEMPORARILY_CLOSED") return "STOPPED";
  if (value === "PERMANENTLY_CLOSED") return "CLOSED";
  if (value === "SUSPENDED") return "STOPPED";
  if (value === "UNDER_REVIEW") return "DISPUTED";
  return "ACTIVE";
}

function safeInteger(value: string | number, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} is outside the safe integer range.`);
  }
  return number;
}

function nullableSafeInteger(
  value: string | number | null,
  label: string,
): number | null {
  return value === null ? null : safeInteger(value, label);
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}
