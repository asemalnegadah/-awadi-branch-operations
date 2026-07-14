import { describe, expect, it } from "vitest";

import { updateCollectionDraft } from "./draft";
import { createCollectionDraft, submitCollection } from "./workflow";

const creatorId = "11111111-1111-4111-8111-111111111111";

function draft() {
  return createCollectionDraft({
    id: "22222222-2222-4222-8222-222222222222",
    customerId: "33333333-3333-4333-8333-333333333333",
    customerAccountId: "44444444-4444-4444-8444-444444444444",
    representativeId: "55555555-5555-4555-8555-555555555555",
    currency: "SR",
    amountMinor: 10_000,
    paymentMethod: "CASH",
    collectedAt: "2026-07-14T09:00:00.000Z",
    evidence: { receiptNumber: "RCPT-001" },
    createdAt: "2026-07-14T09:05:00.000Z",
    createdBy: creatorId,
  });
}

describe("Collection draft editing", () => {
  it("يسمح بتصحيح المسودة قبل الإرسال", () => {
    const updated = updateCollectionDraft(draft(), {
      amountMinor: 12_500,
      paymentMethod: "BANK_TRANSFER",
      evidence: {
        evidenceDocumentId: "66666666-6666-4666-8666-666666666666",
        note: "  تحويل بنكي  ",
      },
    });

    expect(updated.amount).toEqual({ currency: "SR", minorUnits: 12_500 });
    expect(updated.paymentMethod).toBe("BANK_TRANSFER");
    expect(updated.evidence.note).toBe("تحويل بنكي");
    expect(Object.isFrozen(updated)).toBe(true);
  });

  it("يسمح بتغيير العملة والمبلغ معًا داخل المسودة", () => {
    const updated = updateCollectionDraft(draft(), {
      currency: "RG",
      amountMinor: 8_000,
    });

    expect(updated.amount).toEqual({ currency: "RG", minorUnits: 8_000 });
  });

  it("يرفض تعديل التحصيل بعد الإرسال", () => {
    const submitted = submitCollection(draft(), {
      actorUserId: creatorId,
      changedAt: "2026-07-14T09:10:00.000Z",
    }).collection;

    expect(() =>
      updateCollectionDraft(submitted, { amountMinor: 20_000 }),
    ).toThrow("لا يمكن تعديل التحصيل بعد إرساله");
  });

  it("يرفض مبلغًا غير موجب وحقلًا إلزاميًا فارغًا", () => {
    expect(() => updateCollectionDraft(draft(), { amountMinor: 0 })).toThrow(
      "مبلغ التحصيل موجبًا",
    );

    expect(() => updateCollectionDraft(draft(), { customerId: "   " })).toThrow(
      "لا يمكن تفريغ حقل إلزامي",
    );
  });
});
