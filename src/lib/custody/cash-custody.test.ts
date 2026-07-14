import { describe, expect, it } from "vitest";

import { money } from "@/lib/domain/money";
import {
  approveCollection,
  createCollectionDraft,
  reviewCollection,
  submitCollection,
} from "@/lib/collections/workflow";

import {
  calculateCustodyBalance,
  createCashHandoverEvent,
  createCollectionCustodyEvent,
  createCustodyReversalEvent,
} from "./cash-custody";

const creatorId = "11111111-1111-4111-8111-111111111111";
const reviewerId = "22222222-2222-4222-8222-222222222222";
const approverId = "33333333-3333-4333-8333-333333333333";
const accountantId = "44444444-4444-4444-8444-444444444444";
const representativeId = "55555555-5555-4555-8555-555555555555";

function approvedCashCollection() {
  const draft = createCollectionDraft({
    id: "66666666-6666-4666-8666-666666666666",
    customerId: "77777777-7777-4777-8777-777777777777",
    customerAccountId: "88888888-8888-4888-8888-888888888888",
    representativeId,
    currency: "SR",
    amountMinor: 20_000,
    paymentMethod: "CASH",
    collectedAt: "2026-07-14T09:00:00.000Z",
    evidence: { receiptNumber: "RCPT-100" },
    createdAt: "2026-07-14T09:05:00.000Z",
    createdBy: creatorId,
  });
  const submitted = submitCollection(draft, {
    actorUserId: creatorId,
    changedAt: "2026-07-14T09:10:00.000Z",
  }).collection;
  const reviewed = reviewCollection(submitted, {
    actorUserId: reviewerId,
    changedAt: "2026-07-14T09:20:00.000Z",
  }).collection;

  return approveCollection(reviewed, {
    actorUserId: approverId,
    changedAt: "2026-07-14T09:30:00.000Z",
  }).collection;
}

describe("Representative cash custody", () => {
  it("يسجل التحصيل النقدي المعتمد كدخول في عهدة المندوب", () => {
    const event = createCollectionCustodyEvent({
      id: "99999999-9999-4999-8999-999999999999",
      collection: approvedCashCollection(),
      occurredAt: "2026-07-14T09:00:00.000Z",
      recordedAt: "2026-07-14T09:35:00.000Z",
      recordedBy: approverId,
      idempotencyKey: "custody-in-001",
    });

    expect(event.direction).toBe("IN");
    expect(event.eventType).toBe("COLLECTION_IN");
    expect(event.amount).toEqual(money("SR", 20_000));
  });

  it("يحسب العهدة بعد التسليم للحسابات", () => {
    const collected = createCollectionCustodyEvent({
      id: "99999999-9999-4999-8999-999999999999",
      collection: approvedCashCollection(),
      occurredAt: "2026-07-14T09:00:00.000Z",
      recordedAt: "2026-07-14T09:35:00.000Z",
      recordedBy: approverId,
      idempotencyKey: "custody-in-002",
    });
    const handover = createCashHandoverEvent({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      representativeId,
      amount: money("SR", 15_000),
      availableBalance: money("SR", 20_000),
      receivedBy: accountantId,
      handoverReference: "HO-001",
      occurredAt: "2026-07-14T10:00:00.000Z",
      recordedAt: "2026-07-14T10:01:00.000Z",
      recordedBy: accountantId,
      idempotencyKey: "custody-out-001",
    });

    expect(calculateCustodyBalance([collected, handover], representativeId, "SR")).toEqual(
      money("SR", 5_000),
    );
  });

  it("يرفض تسليمًا يتجاوز العهدة أو بعملة مختلفة", () => {
    expect(() =>
      createCashHandoverEvent({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        representativeId,
        amount: money("SR", 21_000),
        availableBalance: money("SR", 20_000),
        receivedBy: accountantId,
        handoverReference: "HO-002",
        occurredAt: "2026-07-14T10:00:00.000Z",
        recordedAt: "2026-07-14T10:01:00.000Z",
        recordedBy: accountantId,
        idempotencyKey: "custody-out-002",
      }),
    ).toThrow("يتجاوز رصيد عهدة المندوب");

    expect(() =>
      createCashHandoverEvent({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        representativeId,
        amount: money("RG", 10_000),
        availableBalance: money("SR", 20_000),
        receivedBy: accountantId,
        handoverReference: "HO-003",
        occurredAt: "2026-07-14T10:00:00.000Z",
        recordedAt: "2026-07-14T10:01:00.000Z",
        recordedBy: accountantId,
        idempotencyKey: "custody-out-003",
      }),
    ).toThrow("عملة التسليم لا تطابق");
  });

  it("يعكس حركة العهدة بحركة مساوية ومعاكسة", () => {
    const collected = createCollectionCustodyEvent({
      id: "99999999-9999-4999-8999-999999999999",
      collection: approvedCashCollection(),
      occurredAt: "2026-07-14T09:00:00.000Z",
      recordedAt: "2026-07-14T09:35:00.000Z",
      recordedBy: approverId,
      idempotencyKey: "custody-in-003",
    });
    const reversal = createCustodyReversalEvent({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      original: collected,
      reason: "إلغاء تحصيل مسجل بالخطأ",
      occurredAt: "2026-07-14T11:00:00.000Z",
      recordedAt: "2026-07-14T11:01:00.000Z",
      recordedBy: accountantId,
      idempotencyKey: "custody-reversal-001",
    });

    expect(reversal.direction).toBe("OUT");
    expect(reversal.reversalOfEventId).toBe(collected.id);
    expect(calculateCustodyBalance([collected, reversal], representativeId, "SR")).toEqual(
      money("SR", 0),
    );
  });

  it("يرفض خلط المندوبين أو العملات أثناء حساب العهدة", () => {
    const collected = createCollectionCustodyEvent({
      id: "99999999-9999-4999-8999-999999999999",
      collection: approvedCashCollection(),
      occurredAt: "2026-07-14T09:00:00.000Z",
      recordedAt: "2026-07-14T09:35:00.000Z",
      recordedBy: approverId,
      idempotencyKey: "custody-in-004",
    });

    expect(() =>
      calculateCustodyBalance([collected], "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "SR"),
    ).toThrow("حركة مندوب آخر");

    expect(() => calculateCustodyBalance([collected], representativeId, "RG")).toThrow(
      "لا يمكن حساب عهدة RG",
    );
  });
});
