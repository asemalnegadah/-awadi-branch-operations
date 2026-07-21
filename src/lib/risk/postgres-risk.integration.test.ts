import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import { closeDatabaseClient, getDatabaseClient } from "@/lib/db/client";

import {
  getAssessmentHistoryPostgres,
  recalculateCreditRiskPostgres,
} from "./postgres-assessment-repository";
import {
  approveCreditExceptionPostgres,
  approveCreditRestrictionPostgres,
  createCreditExceptionPostgres,
  createCreditRestrictionPostgres,
  submitCreditExceptionPostgres,
  submitCreditRestrictionPostgres,
} from "./postgres-decision-repository";
import {
  consumeCreditExceptionPostgres,
  evaluateCreditSaleWithUsagePostgres,
  listCreditExceptionUsagesPostgres,
  reverseCreditExceptionUsagePostgres,
} from "./postgres-usage-repository";
import type { CreditRiskCommandContext } from "./types";

const sql = getDatabaseClient();
const concurrentSql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const runKey = randomUUID();
const actorId = randomUUID();
const representativeId = randomUUID();
const customerId = randomUUID();
const srAccountId = randomUUID();
const rgAccountId = randomUUID();

const actor: AuthenticatedUser = {
  id: actorId,
  email: `risk.actor.${runKey}@example.test`,
  fullName: "مدير اختبار المخاطر الائتمانية",
  roles: ["BRANCH_MANAGER"],
  permissions: new Set([
    "risk.read",
    "risk.recalculate",
    "risk.view_history",
    "credit_restrictions.propose",
    "credit_restrictions.approve",
    "credit_restrictions.revoke",
    "credit_exceptions.propose",
    "credit_exceptions.approve",
    "credit_exceptions.revoke",
    "credit_exceptions.consume",
  ]),
  operatingMode: "SINGLE_MANAGER",
  mustChangePassword: false,
};

function context(key: string): CreditRiskCommandContext {
  const request: RequestSecurityContext = {
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "vitest-credit-risk-postgres",
  };
  return {
    actor,
    request,
    idempotencyKey: `${runKey}-${key}`,
    sessionId: `risk-session-${runKey}`,
  };
}

function isoOffset(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

beforeAll(async () => {
  await sql`
    UPDATE organization_settings
    SET operating_mode = 'SINGLE_MANAGER'
    WHERE singleton_id = 1
  `;
  await sql`
    INSERT INTO users (id, email, full_name, status)
    VALUES (${actorId}, ${actor.email}, ${actor.fullName}, 'ACTIVE')
  `;
  await sql`
    INSERT INTO user_roles (user_id, role_id, granted_by)
    SELECT ${actorId}, role.id, ${actorId}
    FROM roles AS role
    WHERE role.code = 'BRANCH_MANAGER'
  `;
  await sql`
    INSERT INTO sales_representatives (
      id, employee_code, full_name_ar, user_id, representative_type,
      status, created_by, updated_by
    ) VALUES (
      ${representativeId}, ${`RISK-${runKey}`}, 'مندوب اختبار المخاطر',
      ${actorId}, 'RETAIL', 'ACTIVE', ${actorId}, ${actorId}
    )
  `;
  await sql`
    INSERT INTO customers (
      id, customer_number, trade_name_ar, created_by, updated_by
    ) VALUES (
      ${customerId}, ${`RISK-CUSTOMER-${runKey}`},
      'عميل اختبار المخاطر الائتمانية', ${actorId}, ${actorId}
    )
  `;
  await sql`
    INSERT INTO customer_contacts (
      customer_id, contact_type, contact_value, is_primary, is_verified, created_by
    ) VALUES (
      ${customerId}, 'PHONE', '777000111', true, true, ${actorId}
    )
  `;
  await sql`
    INSERT INTO customer_accounts (
      id, customer_id, currency_code, credit_limit_minor, created_by
    ) VALUES
      (${srAccountId}, ${customerId}, 'SR', 5000, ${actorId}),
      (${rgAccountId}, ${customerId}, 'RG', 100000, ${actorId})
  `;
  await sql`
    INSERT INTO customer_rep_assignments (
      customer_id, representative_id, reason, approved_by, created_by
    ) VALUES (
      ${customerId}, ${representativeId}, 'اختبار نطاق المخاطر', ${actorId}, ${actorId}
    )
  `;
  await sql`
    INSERT INTO customer_ledger_entries (
      customer_id, customer_account_id, currency_code, direction, entry_type,
      amount_minor, accounting_date, description, source_type, source_id,
      idempotency_key, posted_at, posted_by, request_id
    ) VALUES
      (
        ${customerId}, ${srAccountId}, 'SR', 'DEBIT', 'INVOICE',
        20000, current_date - 220, 'فاتورة قديمة للاختبار',
        'INVOICE', ${`SR-DEBIT-${runKey}`}, ${`sr-debit-${runKey}`},
        now() - interval '220 days', ${actorId}, ${randomUUID()}
      ),
      (
        ${customerId}, ${srAccountId}, 'SR', 'CREDIT', 'COLLECTION',
        2000, current_date - 10, 'تحصيل جزئي للاختبار',
        'COLLECTION', ${`SR-CREDIT-${runKey}`}, ${`sr-credit-${runKey}`},
        now() - interval '10 days', ${actorId}, ${randomUUID()}
      ),
      (
        ${customerId}, ${rgAccountId}, 'RG', 'DEBIT', 'INVOICE',
        3000, current_date, 'فاتورة RG حديثة ومستقلة',
        'INVOICE', ${`RG-DEBIT-${runKey}`}, ${`rg-debit-${runKey}`},
        now(), ${actorId}, ${randomUUID()}
      )
  `;
  await sql`
    INSERT INTO payment_promises (
      customer_id, customer_account_id, representative_id, currency_code,
      promised_amount_minor, promise_date, due_date, debt_reason,
      created_by, updated_by, idempotency_key
    ) VALUES (
      ${customerId}, ${srAccountId}, ${representativeId}, 'SR',
      10000, current_date - 10, current_date - 5, 'وعد مكسور للاختبار',
      ${actorId}, ${actorId}, ${`broken-promise-${runKey}`}
    )
  `;
});

afterAll(async () => {
  await concurrentSql.end({ timeout: 5 });
  await closeDatabaseClient();
});

describe.sequential("PostgreSQL credit risk vertical slice", () => {
  let srAssessmentId = "";
  let restrictionId = "";
  let restrictionVersion = 0;
  let exceptionId = "";
  let exceptionVersion = 0;
  let usageId = "";

  it("يحسب SR من دفتر الحركات والوعود ويحافظ على RG مستقلًا", async () => {
    const sr = await recalculateCreditRiskPostgres(
      sql,
      srAccountId,
      context("recalculate-sr"),
    );
    expect(sr.replayed).toBe(false);
    expect(sr.assessment.currencyCode).toBe("SR");
    expect(sr.assessment.sourceSnapshot).toMatchObject({
      totalOutstandingMinor: 18000,
      overdueOver180Minor: 18000,
      brokenPromisesCount: 1,
    });
    expect(sr.assessment.factors.map((factor) => factor.code)).toEqual(
      expect.arrayContaining(["AGING_OVER_180", "BROKEN_PROMISES", "OVER_CREDIT_LIMIT"]),
    );
    srAssessmentId = sr.assessment.id;

    const replay = await recalculateCreditRiskPostgres(
      sql,
      srAccountId,
      context("recalculate-sr"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.assessment.id).toBe(srAssessmentId);

    const rg = await recalculateCreditRiskPostgres(
      sql,
      rgAccountId,
      context("recalculate-rg"),
    );
    expect(rg.assessment.currencyCode).toBe("RG");
    expect(rg.assessment.sourceSnapshot).toMatchObject({
      totalOutstandingMinor: 3000,
      overdueOver180Minor: 0,
      brokenPromisesCount: 0,
    });
    expect(rg.assessment.score).toBe(0);

    const history = await getAssessmentHistoryPostgres(sql, srAccountId);
    expect(history).toHaveLength(1);
  });

  it("ينشئ قرار منع معتمدًا ولا يسمح بالبيع الآجل قبل الاستثناء", async () => {
    const created = await createCreditRestrictionPostgres(
      sql,
      {
        customerAccountId: srAccountId,
        decisionType: "BLOCK",
        reasonCode: "OLD_DEBT",
        reasonText: "دين قديم ووعد مكسور.",
        sourceAssessmentId: srAssessmentId,
        effectiveFrom: isoOffset(-60_000),
        reviewDueAt: isoOffset(7 * 86_400_000),
        expiresAt: isoOffset(30 * 86_400_000),
        restorationConditions: "سداد الدين ومراجعة مدير الفرع.",
      },
      context("restriction-create"),
    );
    restrictionId = created.restriction.id;
    restrictionVersion = created.restriction.version;

    const submitted = await submitCreditRestrictionPostgres(
      sql,
      restrictionId,
      { version: restrictionVersion },
      context("restriction-submit"),
    );
    restrictionVersion = submitted.restriction.version;
    expect(submitted.restriction.state).toBe("PENDING_APPROVAL");

    const approved = await approveCreditRestrictionPostgres(
      sql,
      restrictionId,
      { version: restrictionVersion },
      context("restriction-approve"),
    );
    restrictionVersion = approved.restriction.version;
    expect(approved.restriction.state).toBe("ACTIVE");

    const evaluation = await evaluateCreditSaleWithUsagePostgres(
      sql,
      srAccountId,
      5000,
    );
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.restriction?.id).toBe(restrictionId);

    const rgEvaluation = await evaluateCreditSaleWithUsagePostgres(
      sql,
      rgAccountId,
      5000,
    );
    expect(rgEvaluation.allowed).toBe(true);
    expect(rgEvaluation.restriction).toBeNull();
  });

  it("يعتمد استثناء عملية واحدة ويمنع إعادة استخدامه بعد الاستهلاك", async () => {
    const created = await createCreditExceptionPostgres(
      sql,
      {
        restrictionId,
        scope: "SINGLE_TRANSACTION",
        maxAmountMinor: 10000,
        validFrom: isoOffset(-60_000),
        validUntil: isoOffset(86_400_000),
        reason: "عملية بيع استثنائية موثقة.",
        conditions: "عملية واحدة فقط وبحد أقصى 100.00 SR.",
      },
      context("exception-create"),
    );
    exceptionId = created.exception.id;
    exceptionVersion = created.exception.version;

    const submitted = await submitCreditExceptionPostgres(
      sql,
      exceptionId,
      { version: exceptionVersion },
      context("exception-submit"),
    );
    exceptionVersion = submitted.exception.version;

    const approved = await approveCreditExceptionPostgres(
      sql,
      exceptionId,
      { version: exceptionVersion },
      context("exception-approve"),
    );
    exceptionVersion = approved.exception.version;
    expect(approved.exception.state).toBe("ACTIVE");

    const before = await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 7500);
    expect(before.allowed).toBe(true);
    expect(before.exception?.id).toBe(exceptionId);
    expect(before.exceptionRemainingMinor).toBe(10000);

    const consumed = await consumeCreditExceptionPostgres(
      sql,
      {
        exceptionId,
        amountMinor: 7500,
        sourceType: "CREDIT_SALE",
        sourceId: `SALE-${runKey}-1`,
        metadata: { test: true },
      },
      context("exception-consume"),
    );
    usageId = consumed.usage.id;
    expect(consumed.replayed).toBe(false);
    expect(consumed.usage).toMatchObject({
      currencyCode: "SR",
      amountMinor: 7500,
      direction: "CONSUME",
    });

    const replay = await consumeCreditExceptionPostgres(
      sql,
      {
        exceptionId,
        amountMinor: 7500,
        sourceType: "CREDIT_SALE",
        sourceId: `SALE-${runKey}-1`,
        metadata: { test: true },
      },
      context("exception-consume"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.usage.id).toBe(usageId);

    const after = await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 1000);
    expect(after.allowed).toBe(false);

    await expect(
      consumeCreditExceptionPostgres(
        sql,
        {
          exceptionId,
          amountMinor: 1000,
          sourceType: "CREDIT_SALE",
          sourceId: `SALE-${runKey}-2`,
        },
        context("exception-consume-second"),
      ),
    ).rejects.toThrow(/already been consumed/u);
  });

  it("يعكس الاستهلاك بحركة مقابلة ثم يمنع استهلاكًا متزامنًا مزدوجًا", async () => {
    const reversed = await reverseCreditExceptionUsagePostgres(
      sql,
      { usageId, reason: "إلغاء عملية البيع الأصلية." },
      context("exception-reverse"),
    );
    expect(reversed.usage.direction).toBe("REVERSE");
    expect(reversed.usage.reversalOfUsageId).toBe(usageId);

    const afterReverse = await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 5000);
    expect(afterReverse.allowed).toBe(true);

    const firstContext = context("concurrent-consume-a");
    const secondContext = context("concurrent-consume-b");
    const results = await Promise.allSettled([
      consumeCreditExceptionPostgres(
        sql,
        {
          exceptionId,
          amountMinor: 4000,
          sourceType: "CREDIT_SALE",
          sourceId: `SALE-${runKey}-CONCURRENT-A`,
        },
        firstContext,
      ),
      consumeCreditExceptionPostgres(
        concurrentSql,
        {
          exceptionId,
          amountMinor: 4000,
          sourceType: "CREDIT_SALE",
          sourceId: `SALE-${runKey}-CONCURRENT-B`,
        },
        secondContext,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const usages = await listCreditExceptionUsagesPostgres(sql, srAccountId);
    const effective = usages.reduce(
      (sum, usage) => sum + (usage.direction === "CONSUME" ? usage.amountMinor : -usage.amountMinor),
      0,
    );
    expect(effective).toBe(4000);
  });
});
