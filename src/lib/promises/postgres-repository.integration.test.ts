import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabaseClient, getDatabaseClient } from "@/lib/db/client";
import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";

import {
  PromiseBusinessRuleError,
  PromiseConflictError,
  PromiseIdempotencyConflictError,
  PromiseNotFoundError,
} from "./errors";
import {
  addFollowUpPostgres,
  allocateConfirmedCollectionPostgres,
  createPromisePostgres,
  escalatePromisePostgres,
  getCustomerPromiseSummaryPostgres,
  getPromiseDetailsPostgres,
  getPromiseHistoryPostgres,
  getPromisePostgres,
  getSalespersonPromiseSummaryPostgres,
  listPromisesPostgres,
  rejectPromisePostgres,
  reverseCollectionAllocationPostgres,
  updatePromisePostgres,
} from "./postgres-repository";
import type { CreatePromiseInput, PromiseCommandContext } from "./types";

const sql = getDatabaseClient();
const actorId = randomUUID();
const reviewerId = randomUUID();
const approverId = randomUUID();
const representativeId = randomUUID();
const customerId = randomUUID();
const srAccountId = randomUUID();
const rgAccountId = randomUUID();
const secondUserId = randomUUID();
const secondRepresentativeId = randomUUID();
const secondCustomerId = randomUUID();
const secondAccountId = randomUUID();
const runKey = randomUUID();

const actor: AuthenticatedUser = {
  id: actorId,
  email: `promise.actor.${runKey}@example.test`,
  fullName: "مدير اختبار وعود السداد",
  roles: ["BRANCH_MANAGER"],
  permissions: new Set([
    "promises.read",
    "promises.create",
    "promises.update",
    "promises.follow_up",
    "promises.reject",
    "promises.cancel",
    "promises.allocate_collection",
    "promises.reverse_allocation",
    "promises.escalate",
    "promises.view_history",
  ]),
  operatingMode: "SINGLE_MANAGER",
  mustChangePassword: false,
};

function context(key: string): PromiseCommandContext {
  const request: RequestSecurityContext = {
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "vitest-postgres",
  };
  return { actor, request, idempotencyKey: `${runKey}-${key}` };
}

function promiseInput(
  overrides: Partial<CreatePromiseInput> = {},
): CreatePromiseInput {
  return {
    customerId,
    customerAccountId: srAccountId,
    representativeId,
    currencyCode: "SR",
    promisedAmountMinor: 10_000,
    promiseDate: "2026-07-18",
    dueDate: "2026-07-20",
    debtReason: "رصيد فاتورة آجلة",
    ...overrides,
  };
}

async function createConfirmedCollection(
  db: Sql,
  options: {
    readonly amountMinor: number;
    readonly currency?: "SR" | "RG";
    readonly confirmed?: boolean;
  },
): Promise<string> {
  const collectionId = randomUUID();
  const currency = options.currency ?? "SR";
  const accountId = currency === "SR" ? srAccountId : rgAccountId;
  const idKey = `${runKey}-collection-${collectionId}`;
  await db`
    INSERT INTO collections (
      id,
      customer_id,
      customer_account_id,
      representative_id,
      currency_code,
      amount_minor,
      payment_method,
      collected_at,
      receipt_number,
      state,
      created_by,
      updated_by,
      idempotency_key
    ) VALUES (
      ${collectionId},
      ${customerId},
      ${accountId},
      ${representativeId},
      ${currency},
      ${options.amountMinor},
      'CASH',
      now(),
      ${`RCPT-${collectionId}`},
      'DRAFT',
      ${actorId},
      ${actorId},
      ${idKey}
    )
  `;
  if (options.confirmed === false) return collectionId;

  await db.begin(async (transaction) => {
    await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
    await transaction`
      UPDATE collections
      SET state = 'SUBMITTED', updated_by = ${actorId}
      WHERE id = ${collectionId}
    `;
  });
  await db.begin(async (transaction) => {
    await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
    await transaction`
      UPDATE collections
      SET state = 'REVIEWED',
          reviewed_at = now(),
          reviewed_by = ${reviewerId},
          updated_by = ${reviewerId}
      WHERE id = ${collectionId}
    `;
  });
  await db.begin(async (transaction) => {
    await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
    await transaction`
      UPDATE collections
      SET state = 'APPROVED',
          approved_at = now(),
          approved_by = ${approverId},
          updated_by = ${approverId}
      WHERE id = ${collectionId}
    `;
  });
  await db.begin(async (transaction) => {
    await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
    await transaction`
      UPDATE collections
      SET state = 'CASH_RECEIVED',
          cash_received_at = now(),
          cash_received_by = ${reviewerId},
          updated_by = ${reviewerId}
      WHERE id = ${collectionId}
    `;
  });

  const ledgerRows = await db<{ id: string }[]>`
    INSERT INTO customer_ledger_entries (
      customer_id,
      customer_account_id,
      currency_code,
      direction,
      entry_type,
      amount_minor,
      accounting_date,
      source_type,
      source_id,
      idempotency_key,
      posted_at,
      posted_by,
      request_id
    ) VALUES (
      ${customerId},
      ${accountId},
      ${currency},
      'CREDIT',
      'COLLECTION',
      ${options.amountMinor},
      current_date,
      'COLLECTION',
      ${collectionId},
      ${`${idKey}-ledger`},
      now(),
      ${reviewerId},
      ${randomUUID()}
    )
    RETURNING id
  `;
  const ledgerId = ledgerRows[0]?.id;
  if (!ledgerId) throw new Error("failed to create integration ledger entry");

  await db.begin(async (transaction) => {
    await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
    await transaction`
      UPDATE collections
      SET state = 'RECONCILED',
          ledger_entry_id = ${ledgerId},
          reconciled_at = now(),
          reconciled_by = ${reviewerId},
          updated_by = ${reviewerId}
      WHERE id = ${collectionId}
    `;
  });
  return collectionId;
}

beforeAll(async () => {
  await sql`
    INSERT INTO users (id, email, full_name, status)
    VALUES
      (${actorId}, ${actor.email}, ${actor.fullName}, 'ACTIVE'),
      (${reviewerId}, ${`promise.reviewer.${runKey}@example.test`}, 'مراجع وعود', 'ACTIVE'),
      (${approverId}, ${`promise.approver.${runKey}@example.test`}, 'معتمد وعود', 'ACTIVE'),
      (${secondUserId}, ${`promise.rep2.${runKey}@example.test`}, 'مندوب ثانٍ', 'ACTIVE')
  `;
  await sql`
    INSERT INTO sales_representatives (
      id, full_name_ar, user_id, representative_type, status
    ) VALUES
      (${representativeId}, 'مندوب وعود التكامل', ${actorId}, 'RETAIL', 'ACTIVE'),
      (${secondRepresentativeId}, 'مندوب وعود ثانٍ', ${secondUserId}, 'RETAIL', 'ACTIVE')
  `;
  await sql`
    INSERT INTO customers (
      id, customer_number, trade_name_ar, created_by, updated_by
    ) VALUES
      (${customerId}, ${`PROMISE-${runKey}`}, 'عميل وعود التكامل', ${actorId}, ${actorId}),
      (${secondCustomerId}, ${`PROMISE-SECOND-${runKey}`}, 'عميل مندوب ثانٍ', ${actorId}, ${actorId})
  `;
  await sql`
    INSERT INTO customer_accounts (id, customer_id, currency_code, created_by)
    VALUES
      (${srAccountId}, ${customerId}, 'SR', ${actorId}),
      (${rgAccountId}, ${customerId}, 'RG', ${actorId}),
      (${secondAccountId}, ${secondCustomerId}, 'SR', ${actorId})
  `;
  await sql`
    INSERT INTO customer_rep_assignments (
      customer_id,
      representative_id,
      reason,
      approved_by,
      created_by
    ) VALUES
      (${customerId}, ${representativeId}, 'اختبار نطاق المندوب', ${actorId}, ${actorId}),
      (${secondCustomerId}, ${secondRepresentativeId}, 'اختبار نطاق مندوب ثانٍ', ${actorId}, ${actorId})
  `;
});

afterAll(async () => {
  await closeDatabaseClient();
});

describe.sequential("PostgreSQL payment promises repository", () => {
  it("ينشئ وعدًا صحيحًا ويسجل CREATED ويدعم idempotency", async () => {
    const key = "create-idempotent";
    const first = await createPromisePostgres(sql, promiseInput(), context(key));
    expect(first.replayed).toBe(false);
    expect(first.promise).toMatchObject({
      currencyCode: "SR",
      promisedAmountMinor: 10_000,
      fulfilledAmountMinor: 0,
      remainingAmountMinor: 10_000,
    });

    const replay = await createPromisePostgres(sql, promiseInput(), context(key));
    expect(replay.replayed).toBe(true);
    expect(replay.promise.id).toBe(first.promise.id);
    await expect(
      createPromisePostgres(
        sql,
        promiseInput({ promisedAmountMinor: 11_000 }),
        context(key),
      ),
    ).rejects.toBeInstanceOf(PromiseIdempotencyConflictError);

    const events = await getPromiseHistoryPostgres(sql, first.promise.id);
    expect(events.map((event) => event.eventType)).toContain("CREATED");
  });

  it("تفرض قاعدة البيانات العملات والمبالغ المحسوبة", async () => {
    await expect(
      sql`
        INSERT INTO payment_promises (
          customer_id, customer_account_id, representative_id, currency_code,
          promised_amount_minor, promise_date, due_date, debt_reason,
          created_by, updated_by, idempotency_key
        ) VALUES (
          ${customerId}, ${srAccountId}, ${representativeId}, 'USD',
          100, current_date, current_date, 'عملة مرفوضة',
          ${actorId}, ${actorId}, ${`${runKey}-invalid-currency`}
        )
      `,
    ).rejects.toBeDefined();
    await expect(
      sql`
        INSERT INTO payment_promises (
          customer_id, customer_account_id, representative_id, currency_code,
          promised_amount_minor, promise_date, due_date, debt_reason,
          created_by, updated_by, idempotency_key
        ) VALUES (
          ${customerId}, ${srAccountId}, ${representativeId}, 'SR',
          -1, current_date, current_date, 'مبلغ مرفوض',
          ${actorId}, ${actorId}, ${`${runKey}-negative`}
        )
      `,
    ).rejects.toBeDefined();

    const created = await createPromisePostgres(sql, promiseInput(), context("manual-fulfilled"));
    await expect(
      sql`
        UPDATE payment_promises
        SET fulfilled_amount_minor = 1, updated_by = ${actorId}
        WHERE id = ${created.promise.id}
      `,
    ).rejects.toBeDefined();
  });

  it("ينشئ متابعة دون فقدها ويحدّث next_follow_up_at ويسجل الحدث", async () => {
    const created = await createPromisePostgres(sql, promiseInput(), context("followup-promise"));
    const followUp = await addFollowUpPostgres(
      sql,
      created.promise.id,
      {
        scheduledAt: "2026-07-22T09:00:00+03:00",
        notes: "اتصال هاتفي",
      },
      context("followup-create"),
    );
    expect(followUp.replayed).toBe(false);
    expect(followUp.promise.nextFollowUpAt).toBe("2026-07-22T06:00:00.000Z");
    const details = await getPromiseDetailsPostgres(sql, created.promise.id);
    expect(details?.followUps).toHaveLength(1);
    expect(details?.events.map((event) => event.eventType)).toContain("FOLLOW_UP_ADDED");
  });

  it("ينفذ تخصيصًا جزئيًا وعدة تخصيصات ويمنع التجاوز والعملة والتحصيل غير المؤكد", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 10_000 }),
      context("allocation-promise"),
    );
    const collectionOne = await createConfirmedCollection(sql, { amountMinor: 4_000 });
    const collectionTwo = await createConfirmedCollection(sql, { amountMinor: 8_000 });
    const unconfirmed = await createConfirmedCollection(sql, {
      amountMinor: 1_000,
      confirmed: false,
    });
    const rgCollection = await createConfirmedCollection(sql, {
      amountMinor: 1_000,
      currency: "RG",
    });

    const first = await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId: collectionOne, amountMinor: 4_000 },
      context("allocation-first"),
    );
    expect(first.promise).toMatchObject({
      baseStatus: "PARTIALLY_FULFILLED",
      fulfilledAmountMinor: 4_000,
      remainingAmountMinor: 6_000,
    });
    const replay = await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId: collectionOne, amountMinor: 4_000 },
      context("allocation-first"),
    );
    expect(replay.replayed).toBe(true);

    const second = await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId: collectionTwo, amountMinor: 6_000 },
      context("allocation-second"),
    );
    expect(second.promise).toMatchObject({
      baseStatus: "FULFILLED",
      fulfilledAmountMinor: 10_000,
      remainingAmountMinor: 0,
    });

    const overPromise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 1_000 }),
      context("over-promise"),
    );
    await expect(
      allocateConfirmedCollectionPostgres(
        sql,
        overPromise.promise.id,
        { collectionId: collectionTwo, amountMinor: 1_001 },
        context("over-promise-allocation"),
      ),
    ).rejects.toBeInstanceOf(PromiseBusinessRuleError);
    await expect(
      allocateConfirmedCollectionPostgres(
        sql,
        overPromise.promise.id,
        { collectionId: unconfirmed, amountMinor: 500 },
        context("unconfirmed-allocation"),
      ),
    ).rejects.toBeInstanceOf(PromiseBusinessRuleError);
    await expect(
      allocateConfirmedCollectionPostgres(
        sql,
        overPromise.promise.id,
        { collectionId: rgCollection, amountMinor: 500 },
        context("currency-mismatch-allocation"),
      ),
    ).rejects.toBeInstanceOf(PromiseBusinessRuleError);
  });

  it("يعكس التخصيص ويعيد فتح الوعد ويسجل COLLECTION_REVERSED وREOPENED", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 5_000 }),
      context("reversal-promise"),
    );
    const collection = await createConfirmedCollection(sql, { amountMinor: 5_000 });
    const allocation = await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId: collection, amountMinor: 5_000 },
      context("reversal-allocation"),
    );
    expect(allocation.promise.baseStatus).toBe("FULFILLED");

    const reversed = await reverseCollectionAllocationPostgres(
      sql,
      promise.promise.id,
      allocation.allocation.id,
      { reason: "عكس سند التحصيل" },
      context("reversal-operation"),
    );
    expect(reversed.promise.fulfilledAmountMinor).toBe(0);
    expect(["NEW", "UPCOMING"]).toContain(reversed.promise.baseStatus);
    const replay = await reverseCollectionAllocationPostgres(
      sql,
      promise.promise.id,
      allocation.allocation.id,
      { reason: "عكس سند التحصيل" },
      context("reversal-operation"),
    );
    expect(replay.replayed).toBe(true);
    const events = await getPromiseHistoryPostgres(sql, promise.promise.id);
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["COLLECTION_REVERSED", "REOPENED"]),
    );
  });

  it("يمنع Lost Updates باستخدام version", async () => {
    const promise = await createPromisePostgres(sql, promiseInput(), context("version-promise"));
    const version = promise.promise.version;
    const first = updatePromisePostgres(
      sql,
      promise.promise.id,
      { version, notes: "التحديث الأول" },
      context("version-update-one"),
    );
    const second = updatePromisePostgres(
      sql,
      promise.promise.id,
      { version, notes: "التحديث الثاني" },
      context("version-update-two"),
    );
    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejection = settled.find((item) => item.status === "rejected");
    expect(rejection && rejection.status === "rejected" ? rejection.reason : null)
      .toBeInstanceOf(PromiseConflictError);
  });

  it("يسلسل تخصيصات متزامنة على الوعد نفسه عبر اتصالات مستقلة", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 10_000 }),
      context("concurrent-promise"),
    );
    const collectionOne = await createConfirmedCollection(sql, { amountMinor: 7_000 });
    const collectionTwo = await createConfirmedCollection(sql, { amountMinor: 7_000 });
    const clientOne = isolatedClient();
    const clientTwo = isolatedClient();
    try {
      const settled = await Promise.allSettled([
        allocateConfirmedCollectionPostgres(
          clientOne,
          promise.promise.id,
          { collectionId: collectionOne, amountMinor: 7_000 },
          context("concurrent-promise-one"),
        ),
        allocateConfirmedCollectionPostgres(
          clientTwo,
          promise.promise.id,
          { collectionId: collectionTwo, amountMinor: 7_000 },
          context("concurrent-promise-two"),
        ),
      ]);
      expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      const rows = await sql<{ total: string }[]>`
        SELECT COALESCE(SUM(amount_minor), 0)::text AS total
        FROM payment_promise_allocations
        WHERE promise_id = ${promise.promise.id} AND reversed_at IS NULL
      `;
      expect(Number(rows[0]?.total)).toBe(7_000);
    } finally {
      await Promise.all([clientOne.end(), clientTwo.end()]);
    }
  });

  it("يسلسل تخصيصات متزامنة على التحصيل نفسه عبر اتصالات مستقلة", async () => {
    const promiseOne = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 10_000 }),
      context("same-collection-promise-one"),
    );
    const promiseTwo = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 10_000 }),
      context("same-collection-promise-two"),
    );
    const collection = await createConfirmedCollection(sql, { amountMinor: 10_000 });
    const clientOne = isolatedClient();
    const clientTwo = isolatedClient();
    try {
      const settled = await Promise.allSettled([
        allocateConfirmedCollectionPostgres(
          clientOne,
          promiseOne.promise.id,
          { collectionId: collection, amountMinor: 7_000 },
          context("same-collection-one"),
        ),
        allocateConfirmedCollectionPostgres(
          clientTwo,
          promiseTwo.promise.id,
          { collectionId: collection, amountMinor: 7_000 },
          context("same-collection-two"),
        ),
      ]);
      expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      const rows = await sql<{ total: string }[]>`
        SELECT COALESCE(SUM(amount_minor), 0)::text AS total
        FROM payment_promise_allocations
        WHERE collection_id = ${collection} AND reversed_at IS NULL
      `;
      expect(Number(rows[0]?.total)).toBe(7_000);
    } finally {
      await Promise.all([clientOne.end(), clientTwo.end()]);
    }
  });

  it("يمنع UPDATE وDELETE في سجل الأحداث", async () => {
    const promise = await createPromisePostgres(sql, promiseInput(), context("append-only-promise"));
    const events = await getPromiseHistoryPostgres(sql, promise.promise.id);
    const eventId = events[0]?.id;
    if (!eventId) throw new Error("expected promise event");
    await expect(
      sql`UPDATE payment_promise_events SET reason = 'غير مسموح' WHERE id = ${eventId}`,
    ).rejects.toBeDefined();
    await expect(
      sql`DELETE FROM payment_promise_events WHERE id = ${eventId}`,
    ).rejects.toBeDefined();
  });

  it("يوفر Pagination ثابتة وفلاتر وملخصات مفصولة حسب العملة", async () => {
    for (let index = 0; index < 3; index += 1) {
      await createPromisePostgres(
        sql,
        promiseInput({
          dueDate: `2026-07-${String(21 + index).padStart(2, "0")}`,
          notes: `بحث ثابت ${index}`,
        }),
        context(`pagination-${index}`),
      );
    }
    await createPromisePostgres(
      sql,
      promiseInput({
        customerAccountId: rgAccountId,
        currencyCode: "RG",
        notes: "ملخص RG",
      }),
      context("summary-rg"),
    );

    const firstPage = await listPromisesPostgres(sql, {
      customerId,
      query: "بحث ثابت",
      limit: 2,
    });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await listPromisesPostgres(sql, {
      customerId,
      query: "بحث ثابت",
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size)
      .toBe(3);

    const customerSummary = await getCustomerPromiseSummaryPostgres(sql, customerId);
    expect(customerSummary?.currencies.map((item) => item.currencyCode)).toEqual(
      expect.arrayContaining(["SR", "RG"]),
    );
    const salespersonSummary = await getSalespersonPromiseSummaryPostgres(
      sql,
      representativeId,
    );
    expect(salespersonSummary?.representativeId).toBe(representativeId);
  });

  it("يعيد إنشاء الوعد Idempotently بعد تعديل الحقول المتغيرة", async () => {
    const createKey = "immutable-create-payload";
    const originalInput = promiseInput({ notes: "الملاحظات الأصلية" });
    const created = await createPromisePostgres(
      sql,
      originalInput,
      context(createKey),
    );
    await updatePromisePostgres(
      sql,
      created.promise.id,
      { version: created.promise.version, notes: "ملاحظات معدلة لاحقًا" },
      context("immutable-create-later-update"),
    );

    const replay = await createPromisePostgres(
      sql,
      originalInput,
      context(createKey),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.promise.id).toBe(created.promise.id);
    expect(replay.promise.notes).toBe("ملاحظات معدلة لاحقًا");
  });

  it("يعيد إنشاء الوعد مع تطبيع nextFollowUpAt ذي الإزاحة الزمنية", async () => {
    const createKey = "create-offset-timestamp";
    const input = promiseInput({
      nextFollowUpAt: "2026-07-20T12:00:00+03:00",
    });
    const created = await createPromisePostgres(sql, input, context(createKey));
    const replay = await createPromisePostgres(sql, input, context(createKey));

    expect(replay.replayed).toBe(true);
    expect(replay.promise.id).toBe(created.promise.id);
    const payloadRows = await sql<{ next_follow_up_at: string | null }[]>`
      SELECT create_payload ->> 'nextFollowUpAt' AS next_follow_up_at
      FROM payment_promises
      WHERE id = ${created.promise.id}
    `;
    expect(payloadRows[0]?.next_follow_up_at).toBe(
      "2026-07-20T09:00:00.000Z",
    );
  });

  it("يعيد المتابعات المتزامنة ذات مفتاح Idempotency نفسه", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput(),
      context("contended-followup-promise"),
    );
    const clientOne = isolatedClient();
    const clientTwo = isolatedClient();
    const input = {
      scheduledAt: "2026-07-21T09:00:00.000Z",
      notes: "متابعة متزامنة",
    };
    try {
      const results = await Promise.all([
        addFollowUpPostgres(
          clientOne,
          promise.promise.id,
          input,
          context("contended-followup"),
        ),
        addFollowUpPostgres(
          clientTwo,
          promise.promise.id,
          input,
          context("contended-followup"),
        ),
      ]);
      expect(results.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);
      expect(results[0]?.followUp.id).toBe(results[1]?.followUp.id);
    } finally {
      await Promise.all([clientOne.end(), clientTwo.end()]);
    }
  });

  it("يعيد الكتابات المتزامنة ذات مفتاح Idempotency نفسه بدل تعارض version", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput(),
      context("contended-idempotent-write-promise"),
    );
    const clientOne = isolatedClient();
    const clientTwo = isolatedClient();
    try {
      const results = await Promise.all([
        updatePromisePostgres(
          clientOne,
          promise.promise.id,
          { version: promise.promise.version, notes: "كتابة متزامنة" },
          context("contended-idempotent-update"),
        ),
        updatePromisePostgres(
          clientTwo,
          promise.promise.id,
          { version: promise.promise.version, notes: "كتابة متزامنة" },
          context("contended-idempotent-update"),
        ),
      ]);
      expect(results.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);
      const current = await getPromisePostgres(sql, promise.promise.id);
      expect(current?.version).toBe(promise.promise.version + 1);
    } finally {
      await Promise.all([clientOne.end(), clientTwo.end()]);
    }
  });

  it("يعيد العمليات النهائية والتصعيد المتزامنة ذات المفتاح نفسه", async () => {
    const rejectionPromise = await createPromisePostgres(
      sql,
      promiseInput(),
      context("contended-terminal-promise"),
    );
    const escalationPromise = await createPromisePostgres(
      sql,
      promiseInput(),
      context("contended-escalation-promise"),
    );
    const rejectionClientOne = isolatedClient();
    const rejectionClientTwo = isolatedClient();
    const escalationClientOne = isolatedClient();
    const escalationClientTwo = isolatedClient();
    try {
      const rejectionResults = await Promise.all([
        rejectPromisePostgres(
          rejectionClientOne,
          rejectionPromise.promise.id,
          { version: rejectionPromise.promise.version, reason: "رفض متزامن" },
          context("contended-terminal-reject"),
        ),
        rejectPromisePostgres(
          rejectionClientTwo,
          rejectionPromise.promise.id,
          { version: rejectionPromise.promise.version, reason: "رفض متزامن" },
          context("contended-terminal-reject"),
        ),
      ]);
      expect(rejectionResults.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);

      const escalationResults = await Promise.all([
        escalatePromisePostgres(
          escalationClientOne,
          escalationPromise.promise.id,
          { version: escalationPromise.promise.version, level: 1, reason: "تصعيد متزامن" },
          context("contended-escalation"),
        ),
        escalatePromisePostgres(
          escalationClientTwo,
          escalationPromise.promise.id,
          { version: escalationPromise.promise.version, level: 1, reason: "تصعيد متزامن" },
          context("contended-escalation"),
        ),
      ]);
      expect(escalationResults.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);
    } finally {
      await Promise.all([
        rejectionClientOne.end(),
        rejectionClientTwo.end(),
        escalationClientOne.end(),
        escalationClientTwo.end(),
      ]);
    }
  });

  it("يعيد عكس التخصيص المتزامن ذي مفتاح Idempotency نفسه", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 2_500 }),
      context("contended-reversal-promise"),
    );
    const collectionId = await createConfirmedCollection(sql, {
      amountMinor: 2_500,
    });
    const allocation = await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId, amountMinor: 2_500 },
      context("contended-reversal-allocation"),
    );
    const clientOne = isolatedClient();
    const clientTwo = isolatedClient();
    try {
      const results = await Promise.all([
        reverseCollectionAllocationPostgres(
          clientOne,
          promise.promise.id,
          allocation.allocation.id,
          { reason: "عكس متزامن" },
          context("contended-reversal"),
        ),
        reverseCollectionAllocationPostgres(
          clientTwo,
          promise.promise.id,
          allocation.allocation.id,
          { reason: "عكس متزامن" },
          context("contended-reversal"),
        ),
      ]);
      expect(results.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);
      expect(results[0]?.allocation.id).toBe(results[1]?.allocation.id);
      expect(results[0]?.promise.fulfilledAmountMinor).toBe(0);
      expect(results[1]?.promise.fulfilledAmountMinor).toBe(0);
    } finally {
      await Promise.all([clientOne.end(), clientTwo.end()]);
    }
  });



  it("يعيد تخصيص التحصيل المتزامن بالمفتاح نفسه دون سجلات إضافية", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 2_500 }),
      context("contended-allocation-promise"),
    );
    const collectionId = await createConfirmedCollection(sql, {
      amountMinor: 2_500,
    });
    const clientOne = isolatedClient();
    const clientTwo = isolatedClient();
    const key = "contended-allocation";
    const input = { collectionId, amountMinor: 2_500 };
    try {
      const results = await Promise.all([
        allocateConfirmedCollectionPostgres(
          clientOne,
          promise.promise.id,
          input,
          context(key),
        ),
        allocateConfirmedCollectionPostgres(
          clientTwo,
          promise.promise.id,
          input,
          context(key),
        ),
      ]);

      expect(results.map((result) => result.replayed).sort()).toEqual([
        false,
        true,
      ]);
      expect(results[0]?.allocation.id).toBe(results[1]?.allocation.id);
      expect(results[0]?.promise.baseStatus).toBe("FULFILLED");
      expect(results[1]?.promise.baseStatus).toBe("FULFILLED");

      const countRows = await sql<{
        allocation_count: string;
        allocated_event_count: string;
        fulfilled_event_count: string;
        audit_count: string;
      }[]>`
        SELECT
          (
            SELECT COUNT(*)::text
            FROM payment_promise_allocations
            WHERE promise_id = ${promise.promise.id}
              AND collection_id = ${collectionId}
          ) AS allocation_count,
          (
            SELECT COUNT(*)::text
            FROM payment_promise_events
            WHERE promise_id = ${promise.promise.id}
              AND event_type = 'COLLECTION_ALLOCATED'
              AND idempotency_key = ${`${runKey}-${key}`}
          ) AS allocated_event_count,
          (
            SELECT COUNT(*)::text
            FROM payment_promise_events
            WHERE promise_id = ${promise.promise.id}
              AND event_type = 'FULFILLED'
          ) AS fulfilled_event_count,
          (
            SELECT COUNT(*)::text
            FROM audit_logs
            WHERE resource_type = 'PAYMENT_PROMISE'
              AND resource_id = ${promise.promise.id}
              AND action = 'promises.allocate_collection'
          ) AS audit_count
      `;
      expect(countRows[0]).toEqual({
        allocation_count: "1",
        allocated_event_count: "1",
        fulfilled_event_count: "1",
        audit_count: "1",
      });
    } finally {
      await Promise.all([clientOne.end(), clientTwo.end()]);
    }
  });

  it("يرفض Payload مختلفًا لمفتاح تخصيص مستخدم سابقًا", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 3_000 }),
      context("allocation-payload-conflict-promise"),
    );
    const collectionId = await createConfirmedCollection(sql, {
      amountMinor: 3_000,
    });
    const key = "allocation-payload-conflict";
    await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId, amountMinor: 3_000 },
      context(key),
    );

    await expect(
      allocateConfirmedCollectionPostgres(
        sql,
        promise.promise.id,
        { collectionId, amountMinor: 2_999 },
        context(key),
      ),
    ).rejects.toBeInstanceOf(PromiseIdempotencyConflictError);
  });

  it("يمنع عكس التحصيل قبل عكس تخصيص الوعد ثم يسمح به بعد العكس", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 3_000 }),
      context("collection-reversal-guard-promise"),
    );
    const collectionId = await createConfirmedCollection(sql, {
      amountMinor: 3_000,
    });
    const allocation = await allocateConfirmedCollectionPostgres(
      sql,
      promise.promise.id,
      { collectionId, amountMinor: 3_000 },
      context("collection-reversal-guard-allocation"),
    );

    await expect(
      sql.begin(async (transaction) => {
        await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
        await transaction`
          UPDATE collections
          SET state = 'REVERSED',
              reversed_at = now(),
              reversed_by = ${reviewerId},
              reversal_reason = 'محاولة عكس قبل فك الوعد',
              updated_by = ${reviewerId}
          WHERE id = ${collectionId}
        `;
      }),
    ).rejects.toThrow(/reverse active payment promise allocations/);

    await reverseCollectionAllocationPostgres(
      sql,
      promise.promise.id,
      allocation.allocation.id,
      { reason: "فك الربط قبل عكس التحصيل" },
      context("collection-reversal-guard-release"),
    );
    await sql.begin(async (transaction) => {
      await transaction`SELECT set_config('app.request_id', ${randomUUID()}, true)`;
      await transaction`
        UPDATE collections
        SET state = 'REVERSED',
            reversed_at = now(),
            reversed_by = ${reviewerId},
            reversal_reason = 'عكس بعد فك تخصيص الوعد',
            updated_by = ${reviewerId}
        WHERE id = ${collectionId}
      `;
    });
    const rows = await sql<{ state: string }[]>`
      SELECT state FROM collections WHERE id = ${collectionId}
    `;
    expect(rows[0]?.state).toBe("REVERSED");
  });

  it("يقيد قراءة وكتابة المندوب على وعوده فقط", async () => {
    const own = await createPromisePostgres(
      sql,
      promiseInput(),
      context("representative-scope-own"),
      representativeId,
    );
    const other = await createPromisePostgres(
      sql,
      {
        customerId: secondCustomerId,
        customerAccountId: secondAccountId,
        representativeId: secondRepresentativeId,
        currencyCode: "SR",
        promisedAmountMinor: 1_000,
        promiseDate: "2026-07-18",
        dueDate: "2026-07-20",
        debtReason: "وعد مندوب آخر",
      },
      context("representative-scope-other"),
    );

    const page = await listPromisesPostgres(
      sql,
      { limit: 100 },
      representativeId,
    );
    expect(page.items.some((item) => item.id === own.promise.id)).toBe(true);
    expect(page.items.some((item) => item.id === other.promise.id)).toBe(false);
    await expect(
      updatePromisePostgres(
        sql,
        other.promise.id,
        { version: other.promise.version, notes: "محاولة غير مصرح بها" },
        context("representative-scope-forbidden-update"),
        representativeId,
      ),
    ).rejects.toBeInstanceOf(PromiseNotFoundError);
  });

  it("يتراجع بالكامل إذا فشل تسجيل الحدث داخل Transaction", async () => {
    const promise = await createPromisePostgres(
      sql,
      promiseInput({ promisedAmountMinor: 2_000 }),
      context("rollback-promise"),
    );
    const collection = await createConfirmedCollection(sql, { amountMinor: 2_000 });
    const failureKey = `${runKey}-rollback-allocation`;
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION fail_selected_promise_event_for_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.idempotency_key = '${failureKey}' THEN
          RAISE EXCEPTION 'forced promise event failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER fail_selected_promise_event_for_test_trigger
      BEFORE INSERT ON payment_promise_events
      FOR EACH ROW EXECUTE FUNCTION fail_selected_promise_event_for_test()
    `);
    try {
      await expect(
        allocateConfirmedCollectionPostgres(
          sql,
          promise.promise.id,
          { collectionId: collection, amountMinor: 2_000 },
          context("rollback-allocation"),
        ),
      ).rejects.toBeDefined();
      const allocationRows = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM payment_promise_allocations
        WHERE promise_id = ${promise.promise.id}
      `;
      const promiseRows = await sql<{ fulfilled: string }[]>`
        SELECT fulfilled_amount_minor::text AS fulfilled
        FROM payment_promises WHERE id = ${promise.promise.id}
      `;
      expect(allocationRows[0]?.count).toBe("0");
      expect(promiseRows[0]?.fulfilled).toBe("0");
    } finally {
      await sql.unsafe(`
        DROP TRIGGER IF EXISTS fail_selected_promise_event_for_test_trigger
          ON payment_promise_events
      `);
      await sql.unsafe(`DROP FUNCTION IF EXISTS fail_selected_promise_event_for_test()`);
    }
  });
});

function isolatedClient(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
  return postgres(databaseUrl, { max: 1, prepare: false });
}
