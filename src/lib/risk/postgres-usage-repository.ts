import type { Sql, TransactionSql } from "postgres";

import {
  CreditRiskConflictError,
  CreditRiskIdempotencyConflictError,
  CreditRiskNotFoundError,
} from "./errors";
import {
  listCreditExceptionsPostgres,
  listCreditRestrictionsPostgres,
} from "./postgres-decision-repository";
import type { CreditRiskCommandContext } from "./types";
import type {
  ConsumeCreditExceptionInput,
  CreditExceptionUsageEntry,
  CreditSaleEvaluation,
  ReverseCreditExceptionUsageInput,
} from "./usage-types";

interface UsageRow {
  id: string;
  exception_id: string;
  restriction_id: string;
  customer_id: string;
  customer_account_id: string;
  currency_code: "SR" | "RG";
  direction: "CONSUME" | "REVERSE";
  amount_minor: string | number;
  source_type: string;
  source_id: string;
  reversal_of_usage_id: string | null;
  occurred_at: string | Date;
  actor_user_id: string;
  actor_name: string;
  request_id: string;
  idempotency_key: string;
  reason: string | null;
  metadata: Readonly<Record<string, unknown>>;
}

const usageSelect = `
  SELECT
    entry.*,
    actor.full_name AS actor_name
  FROM credit_exception_usage_entries AS entry
  JOIN users AS actor ON actor.id = entry.actor_user_id
`;

export async function consumeCreditExceptionPostgres(
  sql: Sql,
  input: ConsumeCreditExceptionInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly usage: CreditExceptionUsageEntry; readonly replayed: boolean }> {
  await requireExceptionScope(sql, input.exceptionId, representativeScopeId);

  return sql.begin(async (transaction) => {
    const existing = await findUsageByIdempotencyKey(transaction, context.idempotencyKey);
    if (existing) {
      assertConsumeReplay(existing, input);
      return Object.freeze({ usage: mapUsageRow(existing), replayed: true });
    }

    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO credit_exception_usage_entries (
          exception_id,
          amount_minor,
          source_type,
          source_id,
          actor_user_id,
          request_id,
          idempotency_key,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        input.exceptionId,
        input.amountMinor,
        input.sourceType,
        input.sourceId,
        context.actor.id,
        context.request.requestId,
        context.idempotencyKey,
        transaction.json((input.metadata ?? {}) as never),
      ],
    );

    if (!inserted[0]) {
      const raced = await findUsageByIdempotencyKey(transaction, context.idempotencyKey);
      if (!raced) throw new CreditRiskIdempotencyConflictError();
      assertConsumeReplay(raced, input);
      return Object.freeze({ usage: mapUsageRow(raced), replayed: true });
    }

    const usage = await requireUsageById(transaction, inserted[0].id);
    await insertUsageAudit(
      transaction,
      context,
      "credit_exceptions.consume",
      usage,
      input.metadata ?? {},
    );
    return Object.freeze({ usage, replayed: false });
  });
}

export async function reverseCreditExceptionUsagePostgres(
  sql: Sql,
  input: ReverseCreditExceptionUsageInput,
  context: CreditRiskCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly usage: CreditExceptionUsageEntry; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const existing = await findUsageByIdempotencyKey(transaction, context.idempotencyKey);
    if (existing) {
      if (
        existing.direction !== "REVERSE"
        || existing.reversal_of_usage_id !== input.usageId
        || existing.reason !== input.reason
      ) {
        throw new CreditRiskIdempotencyConflictError();
      }
      return Object.freeze({ usage: mapUsageRow(existing), replayed: true });
    }

    const originalRows = await transaction.unsafe<UsageRow[]>(
      `${usageSelect}
       JOIN credit_exceptions AS exception ON exception.id = entry.exception_id
       WHERE entry.id = $1::uuid
         AND entry.direction = 'CONSUME'
         AND (
           $2::uuid IS NULL
           OR EXISTS (
             SELECT 1
             FROM customer_rep_assignments AS assignment
             WHERE assignment.customer_id = entry.customer_id
               AND assignment.representative_id = $2::uuid
               AND assignment.valid_from <= now()
               AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
           )
         )
       FOR UPDATE OF entry`,
      [input.usageId, representativeScopeId ?? null],
    );
    const original = originalRows[0];
    if (!original) throw new CreditRiskNotFoundError("لم يتم العثور على استهلاك الاستثناء المطلوب.");

    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO credit_exception_usage_entries (
          exception_id,
          restriction_id,
          customer_id,
          customer_account_id,
          currency_code,
          direction,
          amount_minor,
          source_type,
          source_id,
          reversal_of_usage_id,
          actor_user_id,
          request_id,
          idempotency_key,
          reason,
          metadata
        ) VALUES (
          $1, $2, $3, $4, $5, 'REVERSE', $6, $7, $8, $9,
          $10, $11, $12, $13, $14::jsonb
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        original.exception_id,
        original.restriction_id,
        original.customer_id,
        original.customer_account_id,
        original.currency_code,
        safeInteger(original.amount_minor, "original usage amount"),
        original.source_type,
        original.source_id,
        original.id,
        context.actor.id,
        context.request.requestId,
        context.idempotencyKey,
        input.reason,
        transaction.json({ reversedUsageId: original.id } as never),
      ],
    );
    if (!inserted[0]) {
      const raced = await findUsageByIdempotencyKey(transaction, context.idempotencyKey);
      if (!raced) throw new CreditRiskIdempotencyConflictError();
      if (
        raced.direction !== "REVERSE"
        || raced.reversal_of_usage_id !== input.usageId
        || raced.reason !== input.reason
      ) {
        throw new CreditRiskIdempotencyConflictError();
      }
      return Object.freeze({ usage: mapUsageRow(raced), replayed: true });
    }

    const usage = await requireUsageById(transaction, inserted[0].id);
    await insertUsageAudit(
      transaction,
      context,
      "credit_exceptions.reverse_usage",
      usage,
      { reversedUsageId: original.id },
    );
    return Object.freeze({ usage, replayed: false });
  });
}

export async function listCreditExceptionUsagesPostgres(
  sql: TransactionSql,
  customerAccountId: string,
  representativeScopeId?: string,
): Promise<readonly CreditExceptionUsageEntry[]> {
  const rows = await sql.unsafe<UsageRow[]>(
    `${usageSelect}
     WHERE entry.customer_account_id = $1::uuid
       AND (
         $2::uuid IS NULL
         OR EXISTS (
           SELECT 1
           FROM customer_rep_assignments AS assignment
           WHERE assignment.customer_id = entry.customer_id
             AND assignment.representative_id = $2::uuid
             AND assignment.valid_from <= now()
             AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
         )
       )
     ORDER BY entry.occurred_at ASC, entry.id ASC`,
    [customerAccountId, representativeScopeId ?? null],
  );
  return Object.freeze(rows.map(mapUsageRow));
}

export async function evaluateCreditSaleWithUsagePostgres(
  sql: TransactionSql,
  customerAccountId: string,
  amountMinor: number,
  representativeScopeId?: string,
): Promise<CreditSaleEvaluation> {
  const restrictions = await listCreditRestrictionsPostgres(
    sql,
    customerAccountId,
    representativeScopeId,
  );
  const now = Date.now();
  const restriction = restrictions.find((item) =>
    item.state === "ACTIVE"
    && Date.parse(item.effectiveFrom) <= now
    && (item.expiresAt === null || Date.parse(item.expiresAt) > now),
  ) ?? null;

  if (!restriction) {
    return Object.freeze({
      allowed: true,
      reason: "لا يوجد قرار منع ائتماني نافذ.",
      restriction: null,
      exception: null,
      exceptionRemainingMinor: null,
    });
  }

  const exceptions = await listCreditExceptionsPostgres(
    sql,
    customerAccountId,
    representativeScopeId,
  );
  const candidates = exceptions.filter((item) =>
    item.restrictionId === restriction.id
    && item.state === "ACTIVE"
    && Date.parse(item.validFrom) <= now
    && Date.parse(item.validUntil) > now,
  );

  for (const exception of candidates) {
    const rows = await sql.unsafe<{ consumed_minor: string | number }[]>(
      `
        SELECT COALESCE(SUM(
          CASE WHEN direction = 'CONSUME' THEN amount_minor ELSE -amount_minor END
        ), 0)::bigint AS consumed_minor
        FROM credit_exception_usage_entries
        WHERE exception_id = $1::uuid
      `,
      [exception.id],
    );
    const consumed = safeInteger(rows[0]?.consumed_minor ?? 0, "exception consumed amount");
    const remaining = Math.max(0, exception.maxAmountMinor - consumed);
    const usable = exception.scope === "SINGLE_TRANSACTION"
      ? consumed === 0 && amountMinor <= exception.maxAmountMinor
      : amountMinor <= remaining;
    if (usable) {
      return Object.freeze({
        allowed: true,
        reason: "يوجد استثناء ائتماني نافذ وغير مستهلك يغطي قيمة العملية.",
        restriction,
        exception,
        exceptionRemainingMinor: remaining,
      });
    }
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
      exceptionRemainingMinor: null,
    });
  }

  return Object.freeze({
    allowed: false,
    reason: "البيع الآجل ممنوع أو يتجاوز الحد المعتمد، ويلزم استثناء موثق وغير مستهلك.",
    restriction,
    exception: null,
    exceptionRemainingMinor: null,
  });
}

async function requireExceptionScope(
  sql: TransactionSql,
  exceptionId: string,
  representativeScopeId?: string,
): Promise<void> {
  const rows = await sql.unsafe<{ id: string }[]>(
    `
      SELECT exception.id
      FROM credit_exceptions AS exception
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
    `,
    [exceptionId, representativeScopeId ?? null],
  );
  if (!rows[0]) throw new CreditRiskNotFoundError("لم يتم العثور على الاستثناء ضمن نطاقك.");
}

async function findUsageByIdempotencyKey(
  sql: TransactionSql,
  key: string,
): Promise<UsageRow | null> {
  const rows = await sql.unsafe<UsageRow[]>(
    `${usageSelect}
     WHERE entry.idempotency_key = $1
     FOR UPDATE OF entry`,
    [key],
  );
  return rows[0] ?? null;
}

async function requireUsageById(sql: TransactionSql, usageId: string): Promise<CreditExceptionUsageEntry> {
  const rows = await sql.unsafe<UsageRow[]>(
    `${usageSelect} WHERE entry.id = $1::uuid`,
    [usageId],
  );
  const row = rows[0];
  if (!row) throw new CreditRiskNotFoundError("لم يتم العثور على حركة استهلاك الاستثناء.");
  return mapUsageRow(row);
}

function assertConsumeReplay(row: UsageRow, input: ConsumeCreditExceptionInput): void {
  if (
    row.direction !== "CONSUME"
    || row.exception_id !== input.exceptionId
    || safeInteger(row.amount_minor, "usage amount") !== input.amountMinor
    || row.source_type !== input.sourceType
    || row.source_id !== input.sourceId
    || JSON.stringify(row.metadata) !== JSON.stringify(input.metadata ?? {})
  ) {
    throw new CreditRiskIdempotencyConflictError();
  }
}

async function insertUsageAudit(
  transaction: TransactionSql,
  context: CreditRiskCommandContext,
  action: string,
  usage: CreditExceptionUsageEntry,
  metadata: Readonly<Record<string, unknown>>,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO audit_logs (
        actor_user_id, actor_type, action, resource_type, resource_id,
        request_id, session_id, ip_address, user_agent, reason,
        new_values, result, metadata
      ) VALUES (
        $1, 'USER', $2, 'CREDIT_EXCEPTION_USAGE', $3, $4, $5,
        $6::inet, $7, $8, $9::jsonb, 'SUCCESS', $10::jsonb
      )
    `,
    [
      context.actor.id,
      action,
      usage.id,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      usage.reason,
      transaction.json({
        exceptionId: usage.exceptionId,
        direction: usage.direction,
        amountMinor: usage.amountMinor,
        currencyCode: usage.currencyCode,
        sourceType: usage.sourceType,
        sourceId: usage.sourceId,
      } as never),
      transaction.json(metadata as never),
    ],
  );
}

function mapUsageRow(row: UsageRow): CreditExceptionUsageEntry {
  return Object.freeze({
    id: row.id,
    exceptionId: row.exception_id,
    restrictionId: row.restriction_id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    currencyCode: row.currency_code,
    direction: row.direction,
    amountMinor: safeInteger(row.amount_minor, "usage amount"),
    sourceType: row.source_type,
    sourceId: row.source_id,
    reversalOfUsageId: row.reversal_of_usage_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    requestId: row.request_id,
    reason: row.reason,
    metadata: Object.freeze({ ...row.metadata }),
  });
}

function safeInteger(value: string | number, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new CreditRiskConflictError(`${label} is outside the safe integer range.`);
  }
  return number;
}
