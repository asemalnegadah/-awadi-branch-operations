import type { Sql } from "postgres";

import { deriveCreditRiskInputPostgres } from "./postgres-assessment-repository";
import {
  listCreditExceptionsPostgres,
  listCreditRestrictionsPostgres,
} from "./postgres-decision-repository";
import type { CreditSaleEvaluation } from "./usage-types";

export async function authorizeCreditSalePostgres(
  sql: Sql,
  customerAccountId: string,
  amountMinor: number,
  representativeScopeId?: string,
): Promise<CreditSaleEvaluation> {
  const derived = await deriveCreditRiskInputPostgres(
    sql,
    customerAccountId,
    representativeScopeId,
  );
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
    const consumed = await getNetExceptionUsage(sql, exception.id);
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

  if (restriction.decisionType === "LIMIT" && restriction.limitAmountMinor !== null) {
    const projectedOutstanding = derived.input.totalOutstandingMinor + amountMinor;
    if (projectedOutstanding <= restriction.limitAmountMinor) {
      return Object.freeze({
        allowed: true,
        reason: "الرصيد المتوقع بعد العملية ضمن الحد الائتماني المقيد.",
        restriction,
        exception: null,
        exceptionRemainingMinor: null,
      });
    }
    return Object.freeze({
      allowed: false,
      reason: "الرصيد المتوقع بعد العملية يتجاوز الحد الائتماني المقيد.",
      restriction,
      exception: null,
      exceptionRemainingMinor: null,
    });
  }

  return Object.freeze({
    allowed: false,
    reason: "البيع الآجل ممنوع، ويلزم استثناء موثق وغير مستهلك.",
    restriction,
    exception: null,
    exceptionRemainingMinor: null,
  });
}

async function getNetExceptionUsage(sql: Sql, exceptionId: string): Promise<number> {
  const rows = await sql.unsafe<{ consumed_minor: string | number }[]>(
    `
      SELECT COALESCE(SUM(
        CASE WHEN direction = 'CONSUME' THEN amount_minor ELSE -amount_minor END
      ), 0)::bigint AS consumed_minor
      FROM credit_exception_usage_entries
      WHERE exception_id = $1::uuid
    `,
    [exceptionId],
  );
  const value = Number(rows[0]?.consumed_minor ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("credit exception usage total is outside the safe integer range");
  }
  return value;
}
