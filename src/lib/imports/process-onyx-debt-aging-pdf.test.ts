import { describe, expect, it, vi } from "vitest";

import type { InspectedPdfUpload } from "./inspect-pdf-upload";
import type { PdfJsPositionedExtraction } from "./pdfjs-positioned-extractor";
import type { PdfPositionedTextItem } from "./pdf-positioned-text";

const inspection: InspectedPdfUpload = Object.freeze({
  originalName: "كشف أعمار الديون.pdf",
  safeName: "كشف-أعمار-الديون.pdf",
  mediaType: "application/pdf",
  sizeBytes: 100,
  sha256: "a".repeat(64),
  headerOffset: 0,
  hasEofMarker: true,
  warnings: Object.freeze([]),
});

let mockedExtraction: PdfJsPositionedExtraction;

vi.mock("./inspect-pdf-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inspect-pdf-upload")>();
  return {
    ...actual,
    inspectPdfUpload: vi.fn(() => inspection),
  };
});

vi.mock("./pdfjs-positioned-extractor", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./pdfjs-positioned-extractor")
  >();
  return {
    ...actual,
    extractPositionedTextWithPdfJs: vi.fn(async () => mockedExtraction),
  };
});

import { processOnyxDebtAgingPdfBytes } from "./process-onyx-debt-aging-pdf";

const x = {
  totalDue: 40,
  over120: 120,
  days91To120: 200,
  days61To90: 280,
  days31To60: 360,
  days0To30: 440,
  localAmount: 520,
  amount: 600,
  currency: 680,
  representative: 740,
  name: 820,
  number: 960,
} as const;

function item(text: string, itemX: number, y: number, width = 40): PdfPositionedTextItem {
  return { pageNumber: 1, text, x: itemX, y, width, height: 10 };
}

function header(): PdfPositionedTextItem[] {
  return [
    item("إجمالي المستحق", x.totalDue, 760, 55),
    item("120 <", x.over120, 760),
    item("120 - 91", x.days91To120, 760),
    item("90 - 61", x.days61To90, 760),
    item("60 - 31", x.days31To60, 760),
    item("30 - 0", x.days0To30, 760),
    item("المبلغ بالعملة المحلية", x.localAmount, 760, 60),
    item("المبلغ", x.amount, 760),
    item("العملة", x.currency, 760),
    item("المندوب", x.representative, 760),
    item("اسم العميل", x.name, 760, 60),
    item("رقم العميل", x.number, 760, 55),
  ];
}

function dataRow(
  y: number,
  number: string,
  currency: "SR" | "RG",
  name: string,
): PdfPositionedTextItem[] {
  return [
    item("125,000.00", x.totalDue, y),
    item("100,000.00", x.over120, y),
    item("25,000.00", x.days0To30, y),
    item("125,000.00", x.localAmount, y),
    item("125,000.00", x.amount, y),
    item(currency, x.currency, y),
    item("35", x.representative, y),
    item(name, x.name, y, 70),
    item(number, x.number, y),
  ];
}

function extractionWithRows(
  rows: readonly PdfPositionedTextItem[],
): PdfJsPositionedExtraction {
  const metadataText = [
    "أعمار الديون للعملاء",
    "من تاريخ : 01/01/2026 إلى تاريخ : 05/07/2026",
    "05/07/2026 02:01:48 AM",
    "1 / 1",
    "35",
    "35",
    "SR",
    "RG",
    "30 - 0 60 - 31 90 - 61 120 - 91 120 <",
  ].join("\n");

  return Object.freeze({
    document: Object.freeze({
      pages: Object.freeze([{ pageNumber: 1, width: 1000, height: 800 }]),
      items: Object.freeze([...header(), ...rows]),
    }),
    pageTexts: Object.freeze([{ pageNumber: 1, text: metadataText }]),
    pageCount: 1,
    textItemCount: header().length + rows.length,
    visibleCharacterCount: 500,
    requiresOcr: false,
    warnings: Object.freeze([]),
  });
}

describe("Process Onyx debt aging PDF", () => {
  it("ينتج صفوف مراجعة بفئات الأعمار دون ترحيل تشغيلي", async () => {
    mockedExtraction = extractionWithRows([
      ...dataRow(700, "60016", "SR", "متجر النور"),
      ...dataRow(675, "60017", "RG", "متجر الهدى"),
    ]);

    const result = await processOnyxDebtAgingPdfBytes({
      originalName: "كشف أعمار الديون.pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.metadata).toMatchObject({
      periodStart: "2026-01-01",
      periodEnd: "2026-07-05",
      asOfDate: "2026-07-05",
      representativeCode: "35",
      agingScheme: "ONYX_0_30_60_90_120",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.invalidCount).toBe(0);
    expect(result.conflictCount).toBe(0);
    expect(result.rows[0]?.normalized).toMatchObject({
      customerNumber: "60016",
      currency: "SR",
      totalDueMinor: 12_500_000,
      aging: {
        days0To30Minor: 2_500_000,
        over120Minor: 10_000_000,
      },
    });
  });

  it("يحول تكرار رقم العميل والعملة في تاريخ القطع نفسه إلى تعارض", async () => {
    mockedExtraction = extractionWithRows([
      ...dataRow(700, "60016", "SR", "متجر النور"),
      ...dataRow(675, "60016", "SR", "متجر النور"),
    ]);

    const result = await processOnyxDebtAgingPdfBytes({
      originalName: "كشف أعمار الديون.pdf",
      bytes: new Uint8Array([1]),
    });

    expect(result.conflictCount).toBe(2);
    expect(result.rows.every((row) => row.status === "CONFLICT")).toBe(true);
  });

  it("يعيد OCR_REQUIRED عند عدم وجود نص كافٍ", async () => {
    mockedExtraction = Object.freeze({
      document: Object.freeze({ pages: Object.freeze([]), items: Object.freeze([]) }),
      pageTexts: Object.freeze([]),
      pageCount: 2,
      textItemCount: 0,
      visibleCharacterCount: 0,
      requiresOcr: true,
      warnings: Object.freeze([
        "لا يحتوي PDF على نص كافٍ؛ يحتاج إلى OCR قبل استخراج الصفوف.",
      ]),
    });

    const result = await processOnyxDebtAgingPdfBytes({
      originalName: "كشف مصور.pdf",
      bytes: new Uint8Array([1]),
    });

    expect(result.status).toBe("OCR_REQUIRED");
    expect(result.rows).toEqual([]);
  });
});
