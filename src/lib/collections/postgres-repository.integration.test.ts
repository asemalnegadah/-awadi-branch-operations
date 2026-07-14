import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDatabaseClient,
  getDatabaseClient,
} from "@/lib/db/client";

import {
  createCollectionDraftPostgres,
  findCollectionByIdPostgres,
  IdempotencyConflictError,
} from "./postgres-repository";

const creatorId = "10000000-0000-4000-8000-000000000001";
const representativeId = "10000000-0000-4000-8000-000000000002";
const customerId = "10000000-0000-4000-8000-000000000003";
const accountId = "10000000-0000-4000-8000-000000000004";
const collectionId = "10000000-0000-4000-8000-000000000005";
const requestId = "10000000-0000-4000-8000-000000000006";

const sql = getDatabaseClient();

beforeAll(async () => {
  await sql`
    INSERT INTO users (id, email, full_name, status)
    VALUES (
      ${creatorId},
      'collection.integration@example.test',
      'مستخدم اختبار التكامل',
      'ACTIVE'
    )
  `;

  await sql`
    INSERT INTO sales_representatives (
      id,
      full_name_ar,
      user_id,
      representative_type,
      status
    ) VALUES (
      ${representativeId},
      'مندوب اختبار التكامل',
      ${creatorId},
      'RETAIL',
      'ACTIVE'
    )
  `;

  await sql`
    INSERT INTO customers (
      id,
      customer_number,
      trade_name_ar,
      created_by,
      updated_by
    ) VALUES (
      ${customerId},
      'INTEGRATION-001',
      'عميل اختبار التكامل',
      ${creatorId},
      ${creatorId}
    )
  `;

  await sql`
    INSERT INTO customer_accounts (
      id,
      customer_id,
      currency_code,
      created_by
    ) VALUES (
      ${accountId},
      ${customerId},
      'SR',
      ${creatorId}
    )
  `;
});

afterAll(async () => {
  await closeDatabaseClient();
});

function draftInput(amountMinor = 25_000) {
  return {
    id: collectionId,
    customerId,
    customerAccountId: accountId,
    representativeId,
    currency: "SR" as const,
    amountMinor,
    paymentMethod: "CASH" as const,
    collectedAt: "2026-07-14T12:00:00.000Z",
    evidence: { receiptNumber: "INTEGRATION-RCPT-001" },
    createdAt: "2026-07-14T12:05:00.000Z",
    createdBy: creatorId,
  };
}

describe("PostgreSQL collection repository", () => {
  it("ينشئ مسودة التحصيل ويسجل حالتها الأولى", async () => {
    const result = await createCollectionDraftPostgres(sql, draftInput(), {
      idempotencyKey: "integration-collection-create-001",
      requestId,
    });

    expect(result.replayed).toBe(false);
    expect(result.collection).toMatchObject({
      id: collectionId,
      customerId,
      customerAccountId: accountId,
      representativeId,
      state: "DRAFT",
      paymentMethod: "CASH",
    });
    expect(result.collection.amount).toEqual({
      currency: "SR",
      minorUnits: 25_000,
    });

    const historyRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM collection_state_history
      WHERE collection_id = ${collectionId}
    `;

    expect(historyRows[0]?.count).toBe("1");
  });

  it("يعيد السجل نفسه عند تكرار الطلب المطابق", async () => {
    const result = await createCollectionDraftPostgres(sql, draftInput(), {
      idempotencyKey: "integration-collection-create-001",
      requestId,
    });

    expect(result.replayed).toBe(true);
    expect(result.collection.id).toBe(collectionId);
  });

  it("يرفض إعادة استخدام مفتاح منع التكرار لبيانات مختلفة", async () => {
    await expect(
      createCollectionDraftPostgres(sql, draftInput(30_000), {
        idempotencyKey: "integration-collection-create-001",
        requestId,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("يسترجع التحصيل حسب المعرف", async () => {
    const collection = await findCollectionByIdPostgres(sql, collectionId);

    expect(collection?.id).toBe(collectionId);
    expect(collection?.amount.minorUnits).toBe(25_000);
  });
});
