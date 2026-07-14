import { describe, expect, it } from "vitest";

import {
  approveCollection,
  closeCollection,
  createCollectionDraft,
  flagCollectionConflict,
  receiveCollectionFunds,
  returnCollection,
  reviewCollection,
  reverseCollection,
  submitCollection,
} from "./workflow";

const creatorId = "11111111-1111-4111-8111-111111111111";
const reviewerId = "22222222-2222-4222-8222-222222222222";
const approverId = "33333333-3333-4333-8333-333333333333";
const accountantId = "44444444-4444-4444-8444-444444444444";

function draft(withEvidence = true) {
  return createCollectionDraft({
    id: "55555555-5555-4555-8555-555555555555",
    customerId: "66666666-6666-4666-8666-666666666666",
    customerAccountId: "77777777-7777-4777-8777-777777777777",
    representativeId: "88888888-8888-4888-8888-888888888888",
    currency: "SR",
    amountMinor: 25_000,
    paymentMethod: "CASH",
    collectedAt: "2026-07-14T09:00:00.000Z",
    evidence: withEvidence ? { receiptNumber: "RCPT-001" } : undefined,
    createdAt: "2026-07-14T09:05:00.000Z",
    createdBy: creatorId,
  });
}

function approvedCollection() {
  const submitted = submitCollection(draft(), {
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

describe("Collection workflow", () => {
  it("ينفذ مسار المسودة والإرسال والمراجعة والاعتماد", () => {
    const submitted = submitCollection(draft(), {
      actorUserId: creatorId,
      changedAt: "2026-07-14T09:10:00.000Z",
    });
    const reviewed = reviewCollection(submitted.collection, {
      actorUserId: reviewerId,
      changedAt: "2026-07-14T09:20:00.000Z",
    });
    const approved = approveCollection(reviewed.collection, {
      actorUserId: approverId,
      changedAt: "2026-07-14T09:30:00.000Z",
    });

    expect(submitted.collection.state).toBe("SUBMITTED");
    expect(reviewed.collection.reviewedBy).toBe(reviewerId);
    expect(approved.collection.state).toBe("APPROVED");
    expect(approved.collection.approvedBy).toBe(approverId);
  });

  it("يرفض إرسال التحصيل دون سند أو دليل", () => {
    expect(() =>
      submitCollection(draft(false), {
        actorUserId: creatorId,
        changedAt: "2026-07-14T09:10:00.000Z",
      }),
    ).toThrow("دون رقم سند أو دليل");
  });

  it("يفصل المنشئ عن المراجع والمعتمد", () => {
    const submitted = submitCollection(draft(), {
      actorUserId: creatorId,
      changedAt: "2026-07-14T09:10:00.000Z",
    }).collection;

    expect(() =>
      reviewCollection(submitted, {
        actorUserId: creatorId,
        changedAt: "2026-07-14T09:20:00.000Z",
      }),
    ).toThrow("لا يجوز أن يراجعه بنفسه");
  });

  it("يسجل استلام الأموال من مستخدم آخر", () => {
    const received = receiveCollectionFunds(approvedCollection(), {
      actorUserId: accountantId,
      changedAt: "2026-07-14T10:00:00.000Z",
    });

    expect(received.collection.state).toBe("CASH_RECEIVED");
    expect(received.collection.cashReceivedBy).toBe(accountantId);
  });

  it("يشترط سببًا للإرجاع والتعارض والعكس", () => {
    const submitted = submitCollection(draft(), {
      actorUserId: creatorId,
      changedAt: "2026-07-14T09:10:00.000Z",
    }).collection;

    expect(() =>
      returnCollection(submitted, {
        actorUserId: reviewerId,
        changedAt: "2026-07-14T09:20:00.000Z",
      }),
    ).toThrow("سبب الانتقال إلزامي");

    const conflicted = flagCollectionConflict(submitted, {
      actorUserId: reviewerId,
      changedAt: "2026-07-14T09:20:00.000Z",
      reason: "المبلغ لا يطابق السند",
    });
    expect(conflicted.collection.state).toBe("CONFLICTED");

    expect(() =>
      reverseCollection(approvedCollection(), {
        actorUserId: approverId,
        changedAt: "2026-07-14T11:00:00.000Z",
      }),
    ).toThrow("سبب الانتقال إلزامي");
  });

  it("يرفض القفز من المسودة إلى الاعتماد أو الإغلاق", () => {
    expect(() =>
      approveCollection(draft(), {
        actorUserId: approverId,
        changedAt: "2026-07-14T09:30:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      closeCollection(draft(), {
        actorUserId: accountantId,
        changedAt: "2026-07-14T11:00:00.000Z",
      }),
    ).toThrow("قبل ربطه بحركة دفتر مالي");
  });
});
