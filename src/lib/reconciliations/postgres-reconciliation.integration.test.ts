import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import { closeDatabaseClient, getDatabaseClient } from "@/lib/db/client";

import { ReconciliationIdempotencyConflictError } from "./errors";
import {
  approveReconciliationPostgres,
  createReconciliationPostgres,
  getReconciliationDetailsPostgres,
  listReconciliationsPostgres,
  requestReconciliationApprovalPostgres,
  reviewReconciliationPostgres,
  settleReconciliationPostgres,
  submitReconciliationPostgres,
} from "./postgres-repository";
import type { ReconciliationCommandContext } from "./types";

const sql = getDatabaseClient();
const secondSql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const runKey = randomUUID();
const actorId = randomUUID();
const customerId = randomUUID();
const srAccountId = randomUUID();
const rgAccountId = randomUUID();

const actor: AuthenticatedUser = {
  id: actorId,
  email: `reconciliation.actor.${runKey}@example.test`,
  fullName: "مدير اختبار المطابقات",
  roles: ["BRANCH_MANAGER"],
  permissions: new Set([
    "reconciliations.read",
    "reconciliations.create",
    "reconciliations.review",
    "reconciliations.approve",
    "reconciliations.settle",
    "reconciliations.view_history",
  ]),
  operatingMode: "SINGLE_MANAGER",
  mustChangePassword: false,
};

function commandContext(key: string, requestId = randomUUID()): ReconciliationCommandContext {
  const request: RequestSecurityContext = {
    requestId,
    ipAddress: "127.0.0.1",
    userAgent: "vitest-reconciliation-postgres",
  };
  return {
    actor,
    request,
    idempotencyKey: `${runKey}-${key}`,
    sessionId: `reconciliation-session-${runKey}`,
  };
}

beforeAll(async () => {
  await sql`UPDATE organization_settings SET operating_mode = 'SINGLE_MANAGER' WHERE singleton_id = 1`;
  await sql`INSERT INTO users (id, email, full_name, status) VALUES (${actorId}, ${actor.email}, ${actor.fullName}, 'ACTIVE')`;
  await sql`
    INSERT INTO user_roles (user_id, role_id, granted_by)
    SELECT ${actorId}, id, ${actorId} FROM roles WHERE code = 'BRANCH_MANAGER'
  `;
  await sql`
    INSERT INTO customers (id, customer_number, trade_name_ar, created_by, updated_by)
    VALUES (${customerId}, ${`RECON-${runKey}`}, 'عميل اختبار المطابقات', ${actorId}, ${actorId})
  `;
  await sql`
    INSERT INTO customer_accounts (id, customer_id, currency_code, created_by)
    VALUES
      (${srAccountId}, ${customerId}, 'SR', ${actorId}),
      (${rgAccountId}, ${customerId}, 'RG', ${actorId})
  `;
});

afterAll(async () => {
  await secondSql.end({ timeout: 5 });
  await closeDatabaseClient();
});

describe.sequential("PostgreSQL reconciliation vertical slice", () => {
  it("creates, replays, classifies, approves, and settles exactly once", async () => {
    const createContext = commandContext("create-primary");
    const input = {
      customerAccountId: srAccountId,
      sourceKind: "LEDGER_TO_STATEMENT" as const,
      sourceType: "ONYX_STATEMENT",
      sourceId: `STATEMENT-${runKey}`,
      cutoffDate: "2026-07-22",
      expectedAmountMinor: 100_000,
      observedAmountMinor: 105_000,
    };
    const created = await createReconciliationPostgres(sql, input, createContext);
    expect(created.replayed).toBe(false);
    expect(created.reconciliation.currencyCode).toBe("SR");
    expect(created.reconciliation.differenceAmountMinor).toBe(5_000);

    const replay = await createReconciliationPostgres(sql, input, createContext);
    expect(replay.replayed).toBe(true);
    expect(replay.reconciliation.id).toBe(created.reconciliation.id);

    await expect(createReconciliationPostgres(
      sql,
      { ...input, observedAmountMinor: 106_000 },
      createContext,
    )).rejects.toBeInstanceOf(ReconciliationIdempotencyConflictError);

    const submitted = await submitReconciliationPostgres(
      sql,
      created.reconciliation.id,
      { version: created.reconciliation.version },
      commandContext("submit-primary"),
    );
    expect(submitted.reconciliation.state).toBe("PENDING_REVIEW");

    const reviewed = await reviewReconciliationPostgres(
      sql,
      created.reconciliation.id,
      {
        version: submitted.reconciliation.version,
        reasonCode: "WRONG_AMOUNT",
        reasonText: "كشف المصدر يزيد عن الدفتر بمقدار 50.00 SR.",
      },
      commandContext("review-primary"),
    );
    const pendingApproval = await requestReconciliationApprovalPostgres(
      sql,
      created.reconciliation.id,
      { version: reviewed.reconciliation.version },
      commandContext("request-approval-primary"),
    );
    const approved = await approveReconciliationPostgres(
      sql,
      created.reconciliation.id,
      { version: pendingApproval.reconciliation.version },
      commandContext("approve-primary"),
    );
    expect(approved.reconciliation.state).toBe("APPROVED");

    const settlementContext = commandContext("settle-primary");
    const settled = await settleReconciliationPostgres(
      sql,
      created.reconciliation.id,
      { version: approved.reconciliation.version, reason: "تسوية فرق كشف الحساب المعتمد." },
      settlementContext,
    );
    expect(settled.reconciliation.state).toBe("SETTLED");
    expect(settled.reconciliation.settlementLedgerEntryId).not.toBeNull();

    const settlementReplay = await settleReconciliationPostgres(
      secondSql,
      created.reconciliation.id,
      { version: approved.reconciliation.version, reason: "تسوية فرق كشف الحساب المعتمد." },
      settlementContext,
    );
    expect(settlementReplay.replayed).toBe(true);
    expect(settlementReplay.reconciliation.settlementLedgerEntryId).toBe(
      settled.reconciliation.settlementLedgerEntryId,
    );

    const ledgerRows = await sql<[{ count: number; amount_minor: number; direction: string }]>`
      SELECT COUNT(*)::int AS count, MIN(amount_minor)::int AS amount_minor, MIN(direction) AS direction
      FROM customer_ledger_entries
      WHERE source_type = 'RECONCILIATION' AND source_id = ${created.reconciliation.id}
    `;
    expect(ledgerRows[0]).toMatchObject({ count: 1, amount_minor: 5_000, direction: "DEBIT" });

    const details = await getReconciliationDetailsPostgres(sql, created.reconciliation.id, true);
    expect(details.events.map((event) => event.toState)).toEqual([
      "DRAFT",
      "PENDING_REVIEW",
      "REVIEWED",
      "PENDING_APPROVAL",
      "APPROVED",
      "SETTLED",
    ]);
  });

  it("serializes concurrent identical settlement requests and prevents duplicate ledger entries", async () => {
    const created = await createReconciliationPostgres(
      sql,
      {
        customerAccountId: srAccountId,
        sourceKind: "IMPORT_TO_LEDGER",
        sourceType: "IMPORT_BATCH",
        sourceId: `BATCH-${runKey}`,
        cutoffDate: "2026-07-22",
        expectedAmountMinor: 50_000,
        observedAmountMinor: 47_500,
      },
      commandContext("create-concurrent"),
    );
    const submitted = await submitReconciliationPostgres(
      sql, created.reconciliation.id, { version: created.reconciliation.version }, commandContext("submit-concurrent"),
    );
    const reviewed = await reviewReconciliationPostgres(
      sql,
      created.reconciliation.id,
      { version: submitted.reconciliation.version, reasonCode: "IMPORT_VARIANCE", reasonText: "دفعة الاستيراد أقل من الدفتر بمقدار 25.00 SR." },
      commandContext("review-concurrent"),
    );
    const pending = await requestReconciliationApprovalPostgres(
      sql, created.reconciliation.id, { version: reviewed.reconciliation.version }, commandContext("request-concurrent"),
    );
    const approved = await approveReconciliationPostgres(
      sql, created.reconciliation.id, { version: pending.reconciliation.version }, commandContext("approve-concurrent"),
    );

    const sharedContext = commandContext("settle-concurrent", randomUUID());
    const settlementInput = {
      version: approved.reconciliation.version,
      reason: "تسوية متزامنة لفارق الاستيراد.",
    };
    const [first, second] = await Promise.all([
      settleReconciliationPostgres(sql, created.reconciliation.id, settlementInput, sharedContext),
      settleReconciliationPostgres(secondSql, created.reconciliation.id, settlementInput, sharedContext),
    ]);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.reconciliation.settlementLedgerEntryId).toBe(second.reconciliation.settlementLedgerEntryId);

    const ledgerRows = await sql<[{ count: number; direction: string }]>`
      SELECT COUNT(*)::int AS count, MIN(direction) AS direction
      FROM customer_ledger_entries
      WHERE source_type = 'RECONCILIATION' AND source_id = ${created.reconciliation.id}
    `;
    expect(ledgerRows[0]).toMatchObject({ count: 1, direction: "CREDIT" });
  });

  it("marks zero differences matched and preserves SR/RG filtering", async () => {
    const created = await createReconciliationPostgres(
      sql,
      {
        customerAccountId: rgAccountId,
        sourceKind: "CUSTODY_TO_COLLECTION",
        sourceType: "DAILY_CUSTODY",
        sourceId: `CUSTODY-${runKey}`,
        cutoffDate: "2026-07-22",
        expectedAmountMinor: 25_000,
        observedAmountMinor: 25_000,
      },
      commandContext("create-matched-rg"),
    );
    const matched = await submitReconciliationPostgres(
      sql,
      created.reconciliation.id,
      { version: created.reconciliation.version },
      commandContext("submit-matched-rg"),
    );
    expect(matched.reconciliation.state).toBe("MATCHED");
    expect(matched.reconciliation.currencyCode).toBe("RG");

    const page = await listReconciliationsPostgres(sql, {
      currencyCode: "RG",
      limit: 100,
    });
    expect(page.items.some((item) => item.id === created.reconciliation.id)).toBe(true);
    expect(page.items.every((item) => item.currencyCode === "RG")).toBe(true);
  });
});
