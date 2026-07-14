import { describe, expect, it } from "vitest";

import { normalizeOnyxDebtAgingSnapshotRow } from "./onyx-debt-aging-snapshot-row";
import type { OnyxDebtAgingCoordinateRow } from "./onyx-coordinate-parser";

function row(
  overrides: Partial<OnyxDebtAgingCoordinateRow> = {},
): OnyxDebtAgingCoordinateRow {
  return {
    customerNumber: "60016",
    customerName: "متجر النور",
    representativeCode: "35",
    currency: "SR",
    amount: "125,000.00",
    localAmount: "125,000.00",
    days0To30: "25,000.00",
    days31To60: undefined,
    days61To90: undefined,
    days91To120: undefined,
    over120: "100,000.00",
    totalDue: "125,000.00",
    sourcePage: 1,
    sourceY: 700,
    warnings: [],
    ...overrides,
  };
}

describe("Onyx debt aging snapshot row", () => {
  it("يحفظ جميع فئات الأعمار مفصولة مع رقم العميل والعملة وتاريخ القطع", () => {
    const result = normalizeOnyxDebtAgingSnapshotRow(
      row(),
      "2026-07-05",
    );

    expect(result).toMatchObject({
      customerNumber: "60016",
      currency: "SR",
      reportAsOfDate: "2026-07-05",
      rowIdentity: "60016|SR|2026-07-05",
      amountMinor: 12_500_000,
      totalDueMinor: 12_500_000,
      aging: {
        days0To30Minor: 2_500_000,
        days31To60Minor: 0,
        days61To90Minor: 0,
        days91To120Minor: 0,
        over120Minor: 10_000_000,
      },
    });
    expect(result.warnings).toEqual([]);
  });

  it("ينبه عند اختلاف مجموع الفئات عن الإجمالي", () => {
    const result = normalizeOnyxDebtAgingSnapshotRow(
      row({ totalDue: "130,000.00" }),
      "2026-07-05",
    );

    expect(result.warnings.some((warning) => warning.includes("لا يطابق إجمالي"))).toBe(
      true,
    );
    expect(result.warnings).toContain(
      "عمود المبلغ لا يطابق إجمالي المستحق في الصف.",
    );
  });

  it("يستخدم مجموع الفئات عندما تغيب أعمدة الإجمالي", () => {
    const result = normalizeOnyxDebtAgingSnapshotRow(
      row({ amount: undefined, totalDue: undefined }),
      "2026-07-05",
    );

    expect(result.totalDueMinor).toBe(12_500_000);
  });

  it("يحتفظ بالرصيد السالب ويضيف تحذيرًا بدل إسقاطه", () => {
    const result = normalizeOnyxDebtAgingSnapshotRow(
      row({
        amount: "(500.00)",
        totalDue: "(500.00)",
        days0To30: "(500.00)",
        over120: undefined,
      }),
      "2026-07-05",
    );

    expect(result.totalDueMinor).toBe(-50_000);
    expect(result.warnings).toContain(
      "إجمالي الصف سالب ويعامل كرصيد دائن يحتاج مراجعة.",
    );
  });

  it("يميز الاسم الظاهر كمقطوع دون تغيير الاسم الخام", () => {
    const result = normalizeOnyxDebtAgingSnapshotRow(
      row({ customerName: "سوبر ماركت البشائر..." }),
      "2026-07-05",
    );

    expect(result.extractedCustomerName).toBe("سوبر ماركت البشائر...");
    expect(result.warnings).toContain(
      "اسم العميل يبدو مقطوعًا في PDF؛ تتم المطابقة برقم العميل والعملة.",
    );
  });

  it("يرفض تاريخ قطع غير موجود تقويميًا", () => {
    expect(() =>
      normalizeOnyxDebtAgingSnapshotRow(row(), "2026-02-31"),
    ).toThrow("تاريخ قطع التقرير غير صالح.");
  });
});
