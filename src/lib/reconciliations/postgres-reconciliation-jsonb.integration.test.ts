import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";

import { ReconciliationIdempotencyConflictError } from "./errors";
import {
  createReconciliationPostgres,
  submitReconciliationPostgres,
} from "./postgres-repository";
import type { ReconciliationCommandContext } from "./types";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const runKey = randomUUID();
const actorId = randomUUID();
const customerId = randomUUID();
const accountId = randomUUID();

const actor: AuthenticatedUser = {
  id: actorId,
  email: `reconciliation.jsonb.${runKey}@example.test`,
  fullName: "مدقق JSONB للمطابقات",
  roles: ["BRANCH_MANAGER"],
  permissions: new Set(),
  operatingMode: "SINGLE_MANAGER",
  mustChangePassword: false,
};

function commandContext(key: string): ReconciliationCommandContext {
  const request: RequestSecurityContext = {
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "vitest-reconciliation-jsonb",
  };
  return {
    actor,
    request,
    idempotencyKey: `${runKey}-${key}`,
    sessionId: `reconciliation-jsonb-${runKey}`,
  };
}

beforeAll(async () => {
  await sql`INSERT INTO users (id, email, full_name, status) VALUES (${actorId}, ${actor.email}, ${actor.fullName}, 'ACTIVE')`;
  await sql`
    INSERT INTO customers (id, customer_number, trade_name_ar, created_by, updated_by)
    VALUES (${customerId}, ${`RECON-JSONB-${runKey}`}, 'عميل اختبار JSONB', ${actorId}, ${actorId})
  `;
  await sql`
    INSERT INTO customer_accounts (id, customer_id, currency_code, created_by)
    VALUES (${accountId}, ${customerId}, 'SR', ${actorId})
  `;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("PostgreSQL reconciliation canonical JSONB regression", () => {
  it("stores canonical payloads as objects and preserves strict replay semantics", async () => {
    const createContext = commandContext("create");
    const input = {
      customerAccountId: accountId,
      sourceKind: "LEDGER_TO_STATEMENT" as const,
      sourceType: "JSONB_REGRESSION",
      sourceId: `JSONB-${runKey}`,
      cutoffDate: "2026-07-24",
      expectedAmountMinor: 20_000,
      observedAmountMinor: 21_000,
    };

    const created = await createReconciliationPostgres(sql, input, createContext);
    const replay = await createReconciliationPostgres(sql, input, createContext);
    expect(replay.replayed).toBe(true);
    expect(replay.reconciliation.id).toBe(created.reconciliation.id);
    await expect(createReconciliationPostgres(
      sql,
      { ...input, observedAmountMinor: 21_001 },
      createContext,
    )).rejects.toBeInstanceOf(ReconciliationIdempotencyConflictError);

    const submitted = await submitReconciliationPostgres(
      sql,
      created.reconciliation.id,
      { version: created.reconciliation.version },
      commandContext("submit"),
    );
    expect(submitted.reconciliation.state).toBe("PENDING_REVIEW");

    const caseRows = await sql<{ payload_type: string | null }[]>`
      SELECT jsonb_typeof(create_payload) AS payload_type
      FROM reconciliation_cases
      WHERE id = ${created.reconciliation.id}
    `;
    expect(caseRows[0]?.payload_type).toBe("object");

    const commandRows = await sql<{ payload_type: string | null }[]>`
      SELECT jsonb_typeof(canonical_payload) AS payload_type
      FROM reconciliation_commands
      WHERE reconciliation_id = ${created.reconciliation.id}
        AND operation = 'SUBMIT'
    `;
    expect(commandRows[0]?.payload_type).toBe("object");

    const auditRows = await sql<{
      previous_type: string | null;
      new_type: string | null;
      metadata_type: string | null;
    }[]>`
      SELECT
        jsonb_typeof(previous_values) AS previous_type,
        jsonb_typeof(new_values) AS new_type,
        jsonb_typeof(metadata) AS metadata_type
      FROM audit_logs
      WHERE resource_type = 'RECONCILIATION'
        AND resource_id = ${created.reconciliation.id}
        AND action = 'reconciliations.submit'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(auditRows[0]).toEqual({
      previous_type: "object",
      new_type: "object",
      metadata_type: "object",
    });
  });
});
