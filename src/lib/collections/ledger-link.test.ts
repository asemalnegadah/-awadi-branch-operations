import { describe, expect, it } from "vitest";

import { money } from "@/lib/domain/money";

import {
  createCollectionLedgerEntry,
  reconcileCollectionWithLedger,
} from "./ledger-link";
import {
  approveCollection,
  createCollectionDraft,
  receiveCollectionFunds,
  reviewCollection,
  submitCollection,
} from "./workflow";

const creatorId = "11111111-1111-4111-8111-111111111111";
const reviewerId = "22222222-2222-4222-8222-222222222222";
const approverId = "33333333-3333-4333-8333-333333333333";
const accountantId = "44444444-4444-4444-8444-444444444444";

function receivedCollection() {
  const draft = createCollectionDraft({
    id: "55555555-5555-4555-8555-555555555555",
    customerId: "66666666-6666-4666-8666-666666666666",
    customerAccountId: "77777777-7777-4777-8777-777777777777",
    representativeId: "88888888-8888-4888-8888-888888888888",
    currency: "RG",
    amountMinor: 15_000,
    paymentMethod: "CASH",
    collectedAt: "2026-07-14T09:00:00.000Z",
    evidence: { receiptNumber: "RG-001" },
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
  const approved = approveCollection(reviewed, {
    actorUserId: approverId,
    changedAt: "2026-07-14T09:30:00.000Z",
  }).collection;

  return receiveCollectionFunds(approved, {
    actorUserId: accountantId,
    changedAt: "2026-07-14T10:00:00.000Z",
  }).collection;
}

describe("Collection ledger linkage", () => {
  it("ينشئ حركة دائنة بنفس مبلغ وعملة التحصيل", () => {
    const collection = receivedCollection();
    const entry = createCollectionLedgerEntry({
      id: "99999999-9999-4999-8999-999999999999",
      collection,
      postedAt: "2026-07-14T10:05:00.000Z",
      postedBy: accountantId,
      idempotencyKey: "collection-ledger-001",
    });

    expect(entry.entryType).toBe("COLLECTION");
    expect(entry.direction).toBe("CREDIT");
    expect(entry.amount).toEqual(collection.amount);
    expect(entry.sourceId).toBe(collection.id);
  });

  it("يرفض إنشاء حركة دفتر قبل استلام الأموال", () => {
    const draft = createCollectionDraft({
      id: "55555555-5555-4555-8555-555555555555",
      customerId: "66666666-6666-4666-8666-666666666666",
      customerAccountId: "77777777-7777-4777-8777-777777777777",
      representativeId: "88888888-8888-4888-8888-888888888888",
      currency: "SR",
      amountMinor: 10_000,
      paymentMethod: "CASH",
      collectedAt: "2026-07-14T09:00:00.000Z",
      evidence: { receiptNumber: "SR-001" },
      createdAt: "2026-07-14T09:05:00.000Z",
      createdBy: creatorId,
    });

    expect(() =>
      createCollectionLedgerEntry({
        id: "99999999-9999-4999-8999-999999999999",
        collection: draft,
        postedAt: "2026-07-14T10:05:00.000Z",
        postedBy: accountantId,
        idempotencyKey: "collection-ledger-002",
      }),
    ).toThrow("قبل استلام الأموال");
  });

  it("يطابق حركة الدفتر ثم ينقل التحصيل إلى المطابقة", () => {
    const collection = receivedCollection();
    const entry = createCollectionLedgerEntry({
      id: "99999999-9999-4999-8999-999999999999",
      collection,
      postedAt: "2026-07-14T10:05:00.000Z",
      postedBy: accountantId,
      idempotencyKey: "collection-ledger-003",
    });

    const result = reconcileCollectionWithLedger(
      collection,
      entry,
      accountantId,
      "2026-07-14T10:10:00.000Z",
    );

    expect(result.collection.state).toBe("RECONCILED");
    expect(result.collection.ledgerEntryId).toBe(entry.id);
  });

  it("يرفض حركة دفتر بمبلغ أو عملة مختلفة", () => {
    const collection = receivedCollection();
    const entry = createCollectionLedgerEntry({
      id: "99999999-9999-4999-8999-999999999999",
      collection,
      postedAt: "2026-07-14T10:05:00.000Z",
      postedBy: accountantId,
      idempotencyKey: "collection-ledger-004",
    });

    expect(() =>
      reconcileCollectionWithLedger(
        collection,
        { ...entry, amount: money("SR", 15_000) },
        accountantId,
        "2026-07-14T10:10:00.000Z",
      ),
    ).toThrow("لا يطابق التحصيل");
  });
});
