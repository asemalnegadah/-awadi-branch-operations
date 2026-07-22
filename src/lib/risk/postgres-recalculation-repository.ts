import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

type SqlExecutor = Sql | TransactionSql;

import {
  CreditRiskIdempotencyConflictError,
  CreditRiskNotFoundError,
} from "./errors";
import { deriveCreditRiskInputPostgres } from "./postgres-assessment-repository";
import { calculateCreditRisk } from "./scoring";
import type {
  CreditRiskAssessment,
  CreditRiskCommandContext,
  CreditRiskInput,
} from "./types";

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

export async function recalculateCreditRiskIdempotentPostgres(
  sql: Sql,
  customerAccountId: string,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly assessment: CreditRiskAssessment; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const replay = await findByIdempotencyKey(transaction, context.idempotencyKey, true);
    if (replay) {
      assertSameOperation(replay, customerAccountId);
      return Object.freeze({ assessment: mapAssessmentRow(replay), replayed: true });
    }

    const accountLock = await transaction.unsafe<{ id: string }[]>(
      `SELECT id FROM customer_accounts WHERE id = $1::uuid FOR UPDATE`,
      [customerAccountId],
    );
    if (!accountLock[0]) throw new CreditRiskNotFoundError("لم يتم العثور على حساب العميل.");

    const replayAfterLock = await findByIdempotencyKey(
      transaction,
      context.idempotencyKey,
      true,
    );
    if (replayAfterLock) {
      assertSameOperation(replayAfterLock, customerAccountId);
      return Object.freeze({ assessment: mapAssessmentRow(replayAfterLock), replayed: true });
    }

    const derived = await deriveCreditRiskInputPostgres(
      transaction,
      customerAccountId,
      representativeScopeId,
    );
    const result = calculateCreditRisk(derived.input);
    const fingerprint = fingerprintInput(derived.input, derived.sourceSnapshot);
    const previousRows = await transaction.unsafe<{ id: string }[]>(
      `
        SELECT id
        FROM credit_risk_assessments
        WHERE customer_account_id = $1::uuid
        ORDER BY cutoff_at DESC, assessed_at DESC, id DESC
        LIMIT 1
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
      const raced = await findByIdempotencyKey(transaction, context.idempotencyKey, true);
      if (!raced) throw new CreditRiskIdempotencyConflictError();
      assertSameOperation(raced, customerAccountId);
      return Object.freeze({ assessment: mapAssessmentRow(raced), replayed: true });
    }

    const assessment = await requireById(transaction, inserted[0].id);
    await insertAudit(transaction, context, assessment);
    return Object.freeze({ assessment, replayed: false });
  });
}

async function findByIdempotencyKey(
  sql: SqlExecutor,
  idempotencyKey: string,
  lock: boolean,
): Promise<AssessmentRow | null> {
  const rows = await sql.unsafe<AssessmentRow[]>(
    `${assessmentSelect}
     WHERE assessment.idempotency_key = $1
     ${lock ? "FOR UPDATE OF assessment" : ""}`,
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

async function requireById(sql: SqlExecutor, assessmentId: string): Promise<CreditRiskAssessment> {
  const rows = await sql.unsafe<AssessmentRow[]>(
    `${assessmentSelect} WHERE assessment.id = $1::uuid`,
    [assessmentId],
  );
  const row = rows[0];
  if (!row) throw new CreditRiskNotFoundError();
  return mapAssessmentRow(row);
}

function assertSameOperation(row: AssessmentRow, customerAccountId: string): void {
  if (row.customer_account_id !== customerAccountId) {
    throw new CreditRiskIdempotencyConflictError();
  }
}

async function insertAudit(
  transaction: SqlExecutor,
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
        jsonb_build_object(
          'ruleset_version', $8::text,
          'currency_code', $9::text,
          'operating_mode', $10::text
        )
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
        inputFingerprint: assessment.inputFingerprint,
      } as never),
      assessment.rulesetVersion,
      assessment.currencyCode,
      context.actor.operatingMode,
    ],
  );
}

function fingerprintInput(
  input: CreditRiskInput,
  sourceSnapshot: Readonly<Record<string, unknown>>,
): string {
  const stableInput = { ...input, cutoffAt: undefined };
  return createHash("sha256")
    .update(JSON.stringify({ input: stableInput, sourceSnapshot }))
    .digest("hex");
}

function mapAssessmentRow(row: AssessmentRow): CreditRiskAssessment {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    cutoffAt: new Date(row.cutoff_at).toISOString(),
    assessedAt: new Date(row.assessed_at).toISOString(),
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

function safeInteger(value: string | number, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} is outside the safe integer range.`);
  }
  return number;
}
