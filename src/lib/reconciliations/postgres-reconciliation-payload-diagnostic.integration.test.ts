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
  it("prints exact PostgreSQL jsonb differences", async () => {
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
    const expectedJson = JSON.stringify(expected);
    const summaries = await sql.unsafe<{
      stored_text: string;
      expected_text: string;
      matches: boolean;
      stored_md5: string;
      expected_md5: string;
    }[]>(
      `
        SELECT
          create_payload::text AS stored_text,
          $2::jsonb::text AS expected_text,
          create_payload = $2::jsonb AS matches,
          md5(create_payload::text) AS stored_md5,
          md5($2::jsonb::text) AS expected_md5
        FROM reconciliation_cases
        WHERE id = $1::uuid
      `,
      [created.reconciliation.id, expectedJson],
    );
    const differences = await sql.unsafe<{
      key: string;
      stored_value: unknown;
      expected_value: unknown;
      stored_type: string | null;
      expected_type: string | null;
      value_matches: boolean;
      stored_hex: string | null;
      expected_hex: string | null;
    }[]>(
      `
        SELECT
          keys.key,
          reconciliation.create_payload -> keys.key AS stored_value,
          $2::jsonb -> keys.key AS expected_value,
          jsonb_typeof(reconciliation.create_payload -> keys.key) AS stored_type,
          jsonb_typeof($2::jsonb -> keys.key) AS expected_type,
          (reconciliation.create_payload -> keys.key) = ($2::jsonb -> keys.key) AS value_matches,
          encode(convert_to((reconciliation.create_payload -> keys.key)::text, 'UTF8'), 'hex') AS stored_hex,
          encode(convert_to(($2::jsonb -> keys.key)::text, 'UTF8'), 'hex') AS expected_hex
        FROM reconciliation_cases AS reconciliation
        CROSS JOIN LATERAL jsonb_object_keys(reconciliation.create_payload || $2::jsonb) AS keys(key)
        WHERE reconciliation.id = $1::uuid
        ORDER BY keys.key
      `,
      [created.reconciliation.id, expectedJson],
    );

    console.log("RECONCILIATION_PAYLOAD_SUMMARY", JSON.stringify(summaries[0]));
    console.log("RECONCILIATION_PAYLOAD_DIFFERENCES", JSON.stringify(differences.filter((row) => !row.value_matches)));
    throw new Error("intentional canonical payload diagnostic; remove after root-cause repair");
  });
});
