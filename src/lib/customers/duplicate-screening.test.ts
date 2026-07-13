import { describe, expect, it } from "vitest";

import { screenPotentialDuplicate } from "./duplicate-screening";

describe("Customer duplicate screening", () => {
  it("يرفع المطابقة الخارجية الكاملة للمراجعة دون دمج تلقائي", () => {
    const result = screenPotentialDuplicate(
      {
        tradeNameAr: "متجر النور",
        externalIdentifiers: [
          { sourceSystem: "ONYX", externalIdentifier: "60001" },
        ],
      },
      {
        tradeNameAr: "محلات أخرى",
        externalIdentifiers: [
          { sourceSystem: "onyx", externalIdentifier: "60001" },
        ],
      },
    );

    expect(result.score).toBe(100);
    expect(result.signals).toContain("EXACT_EXTERNAL_IDENTIFIER");
    expect(result.requiresHumanReview).toBe(true);
    expect(result.automaticMergeAllowed).toBe(false);
  });

  it("يكشف رقم العميل والهاتف والاسم بعد التطبيع", () => {
    const result = screenPotentialDuplicate(
      {
        tradeNameAr: "مؤسسة الإنماء",
        customerNumber: "60 001",
        phones: ["+٩٦٧ ٧٧٧ ١١١ ٢٢٢"],
      },
      {
        tradeNameAr: "مؤسسه الانماء",
        customerNumber: "60001",
        phones: ["967777111222"],
      },
    );

    expect(result.score).toBe(100);
    expect(result.signals).toEqual([
      "EXACT_CUSTOMER_NUMBER",
      "EXACT_PHONE",
      "NORMALIZED_TRADE_NAME",
    ]);
  });

  it("لا يعتبر اختلافًا كاملًا حالة مراجعة", () => {
    const result = screenPotentialDuplicate(
      { tradeNameAr: "متجر الشرق", customerNumber: "100" },
      { tradeNameAr: "متجر الغرب", customerNumber: "200" },
    );

    expect(result.score).toBe(0);
    expect(result.signals).toEqual([]);
    expect(result.requiresHumanReview).toBe(false);
  });

  it("تشابه الاسم وحده يولد مرشحًا ولا يسمح بالدمج", () => {
    const result = screenPotentialDuplicate(
      { tradeNameAr: "سوبر ماركت النور" },
      { tradeNameAr: "سوبر ـ ماركت النور" },
    );

    expect(result.score).toBe(30);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.automaticMergeAllowed).toBe(false);
  });
});
