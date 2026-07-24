import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, it } from "vitest";

import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";

import { createReconciliationPostgres } from "./postgres-repository";
import type { ReconciliationCommandContext } from "./types";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const runKey = randomUUID();
const actorId = randomUUID();
const customerId = randomUUID();
const accountId = randomUUID();

const actor: AuthenticatedUser = {
  id: actorId,
  email: `reconciliation.payload.${runKey}@example.test`,
  fullName: "مدقق حمولة المطابقة",
  roles: ["BRANCH_MANAGER"],
  permissions: new Set(),
  operatingMode: "SINGLE_MANAGER",
  mustChangePassword: false,
};

beforeAll(async () => {
  await sql`INSERT INTO users (id, email, full_name, status) VALUES (${actorId}, ${actor.email}, ${actor.fullName}, 'ACTIVE')`;
  await sql`
    INSERT INTO customers (id, customer_number, trade_name_ar, created_by, updated_by)
    VALUES (${customerId}, ${`RECON-PAYLOAD-${runKey}`}, 'عميل تدقيق الحمولة', ${actorId}, ${actorId})
  `;
  await sql`
    INSERT INTO customer_accounts (id, customer_id, currency_code, created_by)
    VALUES (${accountId}, ${customerId}, 'SR', ${actorId})
  `;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("reconciliation create payload diagnostic", () => {
  it("prints the stored and requested canonical payloads", async () => {
    const request: RequestSecurityContext = {
      requestId: randomUUID(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest-reconciliation-payload-diagnostic",
    };
    const context: ReconciliationCommandContext = {
      actor,
      request,
      idempotencyKey: `${runKey}-create`,
      sessionId: `${runKey}-session`,
    };
    const input = {
      customerAccountId: accountId,
      sourceKind: "LEDGER_TO_STATEMENT" as const,
      sourceType: "ONYX_STATEMENT",
      sourceId: `STATEMENT-${runKey}`,
      cutoffDate: "2026-07-22",
      expectedAmountMinor: 100_000,
      observedAmountMinor: 105_000,
    };

    const created = await createReconciliationPostgres(sql, input, context);
    const expected = {
      customerAccountId: input.customerAccountId,
      sourceKind: input.sourceKind,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      cutoffDate: input.cutoffDate,
      expectedAmountMinor: input.expectedAmountMinor,
      observedAmountMinor: input.observedAmountMinor,
      reasonCode: null,
      reasonText: null,
      createdBy: actorId,
    };
    const rows = await sql<{ create_payload: unknown; matches: boolean }[]>`
      SELECT create_payload, create_payload = ${JSON.stringify(expected)}::jsonb AS matches
      FROM reconciliation_cases
      WHERE id = ${created.reconciliation.id}
    `;
    console.log("RECONCILIATION_STORED_PAYLOAD", JSON.stringify(rows[0]?.create_payload));
    console.log("RECONCILIATION_EXPECTED_PAYLOAD", JSON.stringify(expected));
    console.log("RECONCILIATION_PAYLOAD_MATCHES", rows[0]?.matches);
    throw new Error("intentional canonical payload diagnostic; remove after root-cause repair");
  });
});
