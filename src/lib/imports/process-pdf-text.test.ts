import { describe, expect, it } from "vitest";

import { processPdfTextPages } from "./process-pdf-text";

describe("Process PDF text pages", () => {
  it("يحول كشف أعمار الديون إلى صفوف مراجعة منظمة", () => {
    const result = processPdfTextPages([
      {
        pageNumber: 1,
        text: [
          "كشف أعمار الديون",
          "رقم العميل | اسم العميل | المندوب | العملة | الرصيد المتبقي | عمر الدين | رقم الفاتورة",
          "60001 | متجر النور | سعد | SR | 125,000 | 190 | INV-001",
          "60002 | سوبر الهدى | سلطان | RG | 50,000 | 45 | INV-002",
        ].join("\n"),
      },
    ]);

    expect(result.classification.documentType).toBe("DEBT_AGING");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.validationStatus).toBe("VALID");
    expect(result.rows[0]?.normalizedData).toMatchObject({
      customerNumber: "60001",
      currency: "SR",
      remainingAmountMinor: 12_500_000,
      agingBucket: "OVER_180",
    });
    expect(result.requiresOcr).toBe(false);
  });

  it("يحول كشف العملاء إلى صفوف مع تحذيرات النواقص", () => {
    const result = processPdfTextPages([
      {
        pageNumber: 2,
        text: [
          "رقم العميل\tاسم العميل\tالهاتف\tالمندوب\tالمنطقة",
          "60001\tمتجر النور\t777111222\tسعد\tالمنصورة",
          "\tعميل بلا رقم\t\tهيثم\tكريتر",
        ].join("\n"),
      },
    ]);

    expect(result.classification.documentType).toBe("CUSTOMER_LIST");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.validationStatus).toBe("VALID");
    expect(result.rows[1]?.validationStatus).toBe("WARNING");
    expect(result.rows[1]?.warnings).toContain("رقم العميل غير موجود.");
  });

  it("يحول الصف غير الصالح إلى INVALID بدل إيقاف الملف كله", () => {
    const result = processPdfTextPages([
      {
        pageNumber: 1,
        text: [
          "كشف أعمار الديون",
          "اسم العميل | العملة | الرصيد المتبقي | عمر الدين",
          "متجر النور | XX | غير معروف | 45",
        ].join("\n"),
      },
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.validationStatus).toBe("INVALID");
    expect(result.invalidCount).toBe(1);
  });

  it("يطلب OCR عندما لا يحتوي PDF على نص كافٍ", () => {
    const result = processPdfTextPages([
      { pageNumber: 1, text: " " },
      { pageNumber: 2, text: "" },
    ]);

    expect(result.requiresOcr).toBe(true);
    expect(result.rows).toEqual([]);
  });
});
