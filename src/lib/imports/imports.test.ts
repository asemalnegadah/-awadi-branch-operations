import { describe, expect, it } from "vitest";

import { classifyDocumentText } from "./classify-document";
import { normalizeCustomerRow } from "./customer-row";
import { deriveAgingBucket, normalizeDebtAgingRow } from "./debt-aging-row";
import { parseLocalizedMoneyToMinor } from "./localized-number";
import { extractPdfTableCandidates } from "./pdf-table-extractor";

describe("PDF document classification", () => {
  it("يصنف كشف أعمار الديون", () => {
    const result = classifyDocumentText(`
      كشف أعمار الديون
      رقم العميل | اسم العميل | العملة | الرصيد المتبقي | عمر الدين | تاريخ الاستحقاق
      60001 | متجر النور | SR | 125,000 | 190 | 2026-01-01
    `);

    expect(result.documentType).toBe("DEBT_AGING");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.matchedSignals).toContain("اعمار الديون");
  });

  it("يصنف قائمة العملاء", () => {
    const result = classifyDocumentText(`
      رقم العميل | اسم العميل | الهاتف | المندوب | المنطقة | العنوان
      60001 | متجر النور | 777111222 | سعد | المنصورة | شارع التسعين
    `);

    expect(result.documentType).toBe("CUSTOMER_LIST");
  });

  it("يعيد UNKNOWN للنص غير الكافي", () => {
    expect(classifyDocumentText("مستند غير واضح").documentType).toBe("UNKNOWN");
  });
});

describe("Localized money parsing", () => {
  it("يحول الأرقام العربية والفواصل إلى وحدات صغرى", () => {
    expect(parseLocalizedMoneyToMinor("١٢٥٬٠٠٠", 2)).toBe(12_500_000);
    expect(parseLocalizedMoneyToMinor("1,250.75", 2)).toBe(125_075);
    expect(parseLocalizedMoneyToMinor("1.250,75", 2)).toBe(125_075);
  });

  it("يتعامل مع القيم السالبة بين قوسين", () => {
    expect(parseLocalizedMoneyToMinor("(500.25)", 2)).toBe(-50_025);
  });

  it("يرفض الكسور الزائدة والقيم غير الرقمية", () => {
    expect(() => parseLocalizedMoneyToMinor("1,000.123", 2)).toThrow();
    expect(() => parseLocalizedMoneyToMinor("غير معروف", 2)).toThrow();
  });
});

describe("Debt aging normalization", () => {
  it("يطبع صف الدين ويشتق الفئة العمرية", () => {
    const result = normalizeDebtAgingRow({
      customerNumber: " 60001 ",
      customerName: "متجر النور",
      representativeName: "سعد",
      currency: "sr",
      originalAmount: "150,000",
      remainingAmount: "125,000",
      invoiceNumber: "INV-001",
      invoiceDate: "2026-01-01",
      dueDate: "2026-01-15",
      ageDays: 181,
      sourcePage: 1,
      sourceRow: 2,
      confidence: 0.95,
    });

    expect(result.currency).toBe("SR");
    expect(result.remainingAmountMinor).toBe(12_500_000);
    expect(result.agingBucket).toBe("OVER_180");
    expect(result.warnings).toEqual([]);
  });

  it("ينبه عندما يكون المتبقي أكبر من الأصل", () => {
    const result = normalizeDebtAgingRow({
      customerName: "عميل تجريبي",
      currency: "RG",
      originalAmount: "100",
      remainingAmount: "150",
      ageDays: 45,
      sourcePage: 1,
      sourceRow: 3,
      confidence: 0.8,
    });

    expect(result.agingBucket).toBe("DAYS_31_60");
    expect(result.warnings).toContain("الرصيد المتبقي أكبر من المبلغ الأصلي.");
  });

  it("يشتق جميع حدود أعمار الديون", () => {
    expect(deriveAgingBucket(0)).toBe("NOT_DUE");
    expect(deriveAgingBucket(30)).toBe("DAYS_1_30");
    expect(deriveAgingBucket(60)).toBe("DAYS_31_60");
    expect(deriveAgingBucket(90)).toBe("DAYS_61_90");
    expect(deriveAgingBucket(180)).toBe("DAYS_91_180");
    expect(deriveAgingBucket(181)).toBe("OVER_180");
  });
});

describe("Customer normalization", () => {
  it("ينظف رقم العميل والهاتف والاسم", () => {
    const result = normalizeCustomerRow({
      customerNumber: " 60 001 ",
      customerName: "مؤسسة الإنماء",
      phone: "+٩٦٧ ٧٧٧ ١١١ ٢٢٢",
      representativeName: "سعد",
      sourcePage: 1,
      sourceRow: 2,
      confidence: 0.9,
    });

    expect(result.customerNumber).toBe("60001");
    expect(result.phone).toBe("967777111222");
    expect(result.normalizedCustomerName).toBe("مؤسسه الانماء");
  });

  it("ينبه عند غياب الرقم ووسيلة الاتصال", () => {
    const result = normalizeCustomerRow({
      customerName: "متجر تجريبي",
      sourcePage: 1,
      sourceRow: 2,
      confidence: 0.7,
    });

    expect(result.warnings).toHaveLength(2);
  });
});

describe("PDF table extraction", () => {
  it("يستخرج صفوف العملاء من جدول نصي", () => {
    const rows = extractPdfTableCandidates(
      [
        {
          pageNumber: 1,
          text: [
            "رقم العميل\tاسم العميل\tالهاتف\tالمندوب\tالمنطقة",
            "60001\tمتجر النور\t777111222\tسعد\tالمنصورة",
            "60002\tسوبر ماركت الهدى\t777333444\tسلطان\tكالتكس",
            "الإجمالي\t2",
          ].join("\n"),
        },
      ],
      "CUSTOMER_LIST",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.rowType).toBe("CUSTOMER");
    expect(rows[0]?.rawData.customerNumber).toBe("60001");
  });

  it("يستخرج صفوف أعمار الديون ويحافظ على الصفحة والصف", () => {
    const rows = extractPdfTableCandidates(
      [
        {
          pageNumber: 3,
          text: [
            "رقم العميل | اسم العميل | العملة | الرصيد المتبقي | عمر الدين | رقم الفاتورة",
            "60001 | متجر النور | SR | 125,000 | 190 | INV-001",
          ].join("\n"),
        },
      ],
      "DEBT_AGING",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourcePage).toBe(3);
    expect(rows[0]?.sourceRow).toBe(2);
    expect(rows[0]?.rawData.remainingAmount).toBe("125,000");
  });
});
