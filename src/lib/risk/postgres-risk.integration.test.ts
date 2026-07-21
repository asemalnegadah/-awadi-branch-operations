import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import { closeDatabaseClient, getDatabaseClient } from "@/lib/db/client";

import { getAssessmentHistoryPostgres } from "./postgres-assessment-repository";
import {
  approveCreditExceptionPostgres,
  approveCreditRestrictionPostgres,
  createCreditExceptionPostgres,
  createCreditRestrictionPostgres,
  submitCreditExceptionPostgres,
  submitCreditRestrictionPostgres,
} from "./postgres-decision-repository";
import { recalculateCreditRiskIdempotentPostgres } from "./postgres-recalculation-repository";
import {
  consumeCreditExceptionPostgres,
  evaluateCreditSaleWithUsagePostgres,
  listCreditExceptionUsagesPostgres,
  reverseCreditExceptionUsagePostgres,
} from "./postgres-usage-repository";
import type { CreditRiskCommandContext } from "./types";

const sql = getDatabaseClient();
const secondSql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
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

function commandContext(key: string): CreditRiskCommandContext {
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

const fromNow = (milliseconds: number) => new Date(Date.now() + milliseconds).toISOString();

beforeAll(async () => {
  await sql`UPDATE organization_settings SET operating_mode = 'SINGLE_MANAGER' WHERE singleton_id = 1`;
  await sql`INSERT INTO users (id, email, full_name, status) VALUES (${actorId}, ${actor.email}, ${actor.fullName}, 'ACTIVE')`;
  await sql`
    INSERT INTO user_roles (user_id, role_id, granted_by)
    SELECT ${actorId}, id, ${actorId} FROM roles WHERE code = 'BRANCH_MANAGER'
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
    INSERT INTO customers (id, customer_number, trade_name_ar, created_by, updated_by)
    VALUES (${customerId}, ${`RISK-CUSTOMER-${runKey}`}, 'عميل اختبار المخاطر', ${actorId}, ${actorId})
  `;
  await sql`
    INSERT INTO customer_contacts (
      customer_id, contact_type, contact_value, is_primary, is_verified, created_by
    ) VALUES (${customerId}, 'PHONE', '777000111', true, true, ${actorId})
  `;
  await sql`
    INSERT INTO customer_accounts (id, customer_id, currency_code, credit_limit_minor, created_by)
    VALUES
      (${srAccountId}, ${customerId}, 'SR', 5000, ${actorId}),
      (${rgAccountId}, ${customerId}, 'RG', 100000, ${actorId})
  `;
  await sql`
    INSERT INTO customer_rep_assignments (
      customer_id, representative_id, reason, approved_by, created_by
    ) VALUES (${customerId}, ${representativeId}, 'اختبار نطاق المخاطر', ${actorId}, ${actorId})
  `;
  await sql`
    INSERT INTO customer_ledger_entries (
      customer_id, customer_account_id, currency_code, direction, entry_type,
      amount_minor, accounting_date, description, source_type, source_id,
      idempotency_key, posted_at, posted_by, request_id
    ) VALUES
      (${customerId}, ${srAccountId}, 'SR', 'DEBIT', 'INVOICE', 20000,
       current_date - 220, 'فاتورة قديمة', 'INVOICE', ${`SR-D-${runKey}`},
       ${`sr-d-${runKey}`}, now() - interval '220 days', ${actorId}, ${randomUUID()}),
      (${customerId}, ${srAccountId}, 'SR', 'CREDIT', 'COLLECTION', 2000,
       current_date - 10, 'تحصيل جزئي', 'COLLECTION', ${`SR-C-${runKey}`},
       ${`sr-c-${runKey}`}, now() - interval '10 days', ${actorId}, ${randomUUID()}),
      (${customerId}, ${rgAccountId}, 'RG', 'DEBIT', 'INVOICE', 3000,
       current_date, 'فاتورة RG حديثة', 'INVOICE', ${`RG-D-${runKey}`},
       ${`rg-d-${runKey}`}, now(), ${actorId}, ${randomUUID()})
  `;
  await sql`
    INSERT INTO payment_promises (
      customer_id, customer_account_id, representative_id, currency_code,
      promised_amount_minor, promise_date, due_date, debt_reason,
      created_by, updated_by, idempotency_key
    ) VALUES (
      ${customerId}, ${srAccountId}, ${representativeId}, 'SR', 10000,
      current_date - 10, current_date - 5, 'وعد مكسور',
      ${actorId}, ${actorId}, ${`broken-${runKey}`}
    )
  `;
});

afterAll(async () => {
  await secondSql.end({ timeout: 5 });
  await closeDatabaseClient();
});

describe.sequential("PostgreSQL credit risk vertical slice", () => {
  it("يفصل العملات ويطبق المنع والاستثناء والاستهلاك والعكس ذريًا", async () => {
    const sr = await recalculateCreditRiskIdempotentPostgres(
      sql,
      srAccountId,
      commandContext("recalc-sr"),
    );
    expect(sr.assessment.sourceSnapshot).toMatchObject({
      totalOutstandingMinor: 18000,
      overdueOver180Minor: 18000,
      brokenPromisesCount: 1,
    });
    expect(sr.assessment.factors.map((factor) => factor.code)).toEqual(
      expect.arrayContaining(["AGING_OVER_180", "BROKEN_PROMISES", "OVER_CREDIT_LIMIT"]),
    );

    const replay = await recalculateCreditRiskIdempotentPostgres(
      sql,
      srAccountId,
      commandContext("recalc-sr"),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.assessment.id).toBe(sr.assessment.id);

    const rg = await recalculateCreditRiskIdempotentPostgres(
      sql,
      rgAccountId,
      commandContext("recalc-rg"),
    );
    expect(rg.assessment.currencyCode).toBe("RG");
    expect(rg.assessment.score).toBe(0);
    expect(rg.assessment.sourceSnapshot).toMatchObject({
      totalOutstandingMinor: 3000,
      overdueOver180Minor: 0,
      brokenPromisesCount: 0,
    });
    expect(await getAssessmentHistoryPostgres(sql, srAccountId)).toHaveLength(1);

    const restrictionDraft = await createCreditRestrictionPostgres(
      sql,
      {
        customerAccountId: srAccountId,
        decisionType: "BLOCK",
        reasonCode: "OLD_DEBT",
        reasonText: "دين قديم ووعد مكسور.",
        sourceAssessmentId: sr.assessment.id,
        effectiveFrom: fromNow(-60_000),
        reviewDueAt: fromNow(7 * 86_400_000),
        expiresAt: fromNow(30 * 86_400_000),
        restorationConditions: "سداد الدين ومراجعة مدير الفرع.",
      },
      commandContext("restriction-create"),
    );
    const submittedRestriction = await submitCreditRestrictionPostgres(
      sql,
      restrictionDraft.restriction.id,
      { version: restrictionDraft.restriction.version },
      commandContext("restriction-submit"),
    );
    const activeRestriction = await approveCreditRestrictionPostgres(
      sql,
      restrictionDraft.restriction.id,
      { version: submittedRestriction.restriction.version },
      commandContext("restriction-approve"),
    );
    expect(activeRestriction.restriction.state).toBe("ACTIVE");
    expect((await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 5000)).allowed).toBe(false);
    expect((await evaluateCreditSaleWithUsagePostgres(sql, rgAccountId, 5000)).allowed).toBe(true);

    const exceptionDraft = await createCreditExceptionPostgres(
      sql,
      {
        restrictionId: activeRestriction.restriction.id,
        scope: "SINGLE_TRANSACTION",
        maxAmountMinor: 10000,
        validFrom: fromNow(-60_000),
        validUntil: fromNow(86_400_000),
        reason: "عملية استثنائية موثقة.",
        conditions: "عملية واحدة فقط.",
      },
      commandContext("exception-create"),
    );
    const submittedException = await submitCreditExceptionPostgres(
      sql,
      exceptionDraft.exception.id,
      { version: exceptionDraft.exception.version },
      commandContext("exception-submit"),
    );
    const activeException = await approveCreditExceptionPostgres(
      sql,
      exceptionDraft.exception.id,
      { version: submittedException.exception.version },
      commandContext("exception-approve"),
    );
    expect(activeException.exception.state).toBe("ACTIVE");
    expect((await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 7500)).allowed).toBe(true);

    const consumed = await consumeCreditExceptionPostgres(
      sql,
      {
        exceptionId: activeException.exception.id,
        amountMinor: 7500,
        sourceType: "CREDIT_SALE",
        sourceId: `SALE-${runKey}-1`,
        metadata: { integration: true },
      },
      commandContext("consume"),
    );
    expect(consumed.usage.direction).toBe("CONSUME");
    expect((await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 1000)).allowed).toBe(false);

    await expect(
      consumeCreditExceptionPostgres(
        secondSql,
        {
          exceptionId: activeException.exception.id,
          amountMinor: 1000,
          sourceType: "CREDIT_SALE",
          sourceId: `SALE-${runKey}-2`,
        },
        commandContext("consume-second"),
      ),
    ).rejects.toThrow(/already been consumed/u);

    await reverseCreditExceptionUsagePostgres(
      sql,
      { usageId: consumed.usage.id, reason: "إلغاء عملية البيع الأصلية." },
      commandContext("reverse"),
    );
    expect((await evaluateCreditSaleWithUsagePostgres(sql, srAccountId, 5000)).allowed).toBe(true);

    const usages = await listCreditExceptionUsagesPostgres(sql, srAccountId);
    expect(usages.map((usage) => usage.direction)).toEqual(["CONSUME", "REVERSE"]);
  });
});
