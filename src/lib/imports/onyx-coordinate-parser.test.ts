import { describe, expect, it } from "vitest";

import { extractOnyxDebtRowsFromCoordinates } from "./onyx-coordinate-parser";
import type { PdfPositionedTextItem } from "./pdf-positioned-text";

const columnX = {
  totalDue: 40,
  over120: 120,
  days91To120: 200,
  days61To90: 280,
  days31To60: 360,
  days0To30: 440,
  localAmount: 520,
  amount: 600,
  currency: 680,
  representativeCode: 740,
  customerName: 820,
  customerNumber: 960,
} as const;

function item(
  pageNumber: number,
  text: string,
  x: number,
  y: number,
  width = 40,
): PdfPositionedTextItem {
  return { pageNumber, text, x, y, width, height: 10 };
}

function header(pageNumber: number, y = 760): PdfPositionedTextItem[] {
  return [
    item(pageNumber, "إجمالي المستحق", columnX.totalDue, y, 55),
    item(pageNumber, "120 <", columnX.over120, y),
    item(pageNumber, "120 - 91", columnX.days91To120, y),
    item(pageNumber, "90 - 61", columnX.days61To90, y),
    item(pageNumber, "60 - 31", columnX.days31To60, y),
    item(pageNumber, "30 - 0", columnX.days0To30, y),
    item(pageNumber, "المبلغ بالعملة المحلية", columnX.localAmount, y, 60),
    item(pageNumber, "المبلغ", columnX.amount, y),
    item(pageNumber, "العملة", columnX.currency, y),
    item(pageNumber, "المندوب", columnX.representativeCode, y),
    item(pageNumber, "اسم العميل", columnX.customerName, y, 60),
    item(pageNumber, "رقم العميل", columnX.customerNumber, y, 55),
  ];
}

function debtRow(
  pageNumber: number,
  y: number,
  values: {
    number: string;
    name: string;
    representative?: string;
    currency: "SR" | "RG";
    amount: string;
    days0To30?: string;
    days31To60?: string;
    days61To90?: string;
    days91To120?: string;
    over120?: string;
    totalDue?: string;
  },
): PdfPositionedTextItem[] {
  return [
    item(pageNumber, values.totalDue ?? values.amount, columnX.totalDue, y),
    ...(values.over120
      ? [item(pageNumber, values.over120, columnX.over120, y)]
      : []),
    ...(values.days91To120
      ? [item(pageNumber, values.days91To120, columnX.days91To120, y)]
      : []),
    ...(values.days61To90
      ? [item(pageNumber, values.days61To90, columnX.days61To90, y)]
      : []),
    ...(values.days31To60
      ? [item(pageNumber, values.days31To60, columnX.days31To60, y)]
      : []),
    ...(values.days0To30
      ? [item(pageNumber, values.days0To30, columnX.days0To30, y)]
      : []),
    item(pageNumber, values.amount, columnX.localAmount, y),
    item(pageNumber, values.amount, columnX.amount, y),
    item(pageNumber, values.currency, columnX.currency, y),
    ...(values.representative
      ? [
          item(
            pageNumber,
            values.representative,
            columnX.representativeCode,
            y,
          ),
        ]
      : []),
    item(pageNumber, values.name, columnX.customerName, y, 70),
    item(pageNumber, values.number, columnX.customerNumber, y),
  ];
}

describe("Onyx coordinate parser", () => {
  it("يعيد تكوين الصفوف حسب الإحداثيات بصرف النظر عن ترتيب عناصر PDF", () => {
    const items = [
      ...header(1),
      ...debtRow(1, 700, {
        number: "60016",
        name: "متجر النور",
        representative: "35",
        currency: "RG",
        amount: "125,000.00",
        days0To30: "25,000.00",
        over120: "100,000.00",
      }),
      ...debtRow(1, 675, {
        number: "60017",
        name: "سوبر الهدى",
        representative: "35",
        currency: "SR",
        amount: "50,000.00",
        days31To60: "50,000.00",
      }),
    ].reverse();

    const rows = extractOnyxDebtRowsFromCoordinates(items);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      customerNumber: "60016",
      customerName: "متجر النور",
      representativeCode: "35",
      currency: "RG",
      amount: "125,000.00",
      days0To30: "25,000.00",
      over120: "100,000.00",
      sourcePage: 1,
    });
    expect(rows[1]).toMatchObject({
      customerNumber: "60017",
      currency: "SR",
      days31To60: "50,000.00",
    });
  });

  it("يتجاهل رأس الجدول المتكرر ويستخرج الصفوف من عدة صفحات", () => {
    const rows = extractOnyxDebtRowsFromCoordinates([
      ...header(1),
      ...debtRow(1, 700, {
        number: "60016",
        name: "عميل الصفحة الأولى",
        representative: "35",
        currency: "RG",
        amount: "100",
      }),
      ...header(2),
      ...debtRow(2, 700, {
        number: "60088",
        name: "عميل الصفحة الثانية",
        representative: "35",
        currency: "SR",
        amount: "200",
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.customerNumber)).toEqual(["60016", "60088"]);
  });

  it("يجمع الاسم الممتد إلى سطر تالٍ مع الصف الأقرب", () => {
    const rows = extractOnyxDebtRowsFromCoordinates([
      ...header(1),
      ...debtRow(1, 700, {
        number: "60173",
        name: "مؤسسة عبدالله محمد",
        representative: "35",
        currency: "SR",
        amount: "300",
      }),
      item(1, "للتجارة", columnX.customerName, 690, 60),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerName).toBe("مؤسسة عبدالله محمد للتجارة");
    expect(rows[0]?.warnings).toContain(
      "اسم العميل ممتد إلى سطر ثانٍ في PDF.",
    );
  });

  it("يضيف تحذيرًا عند غياب كود المندوب ولا يسقط الصف", () => {
    const rows = extractOnyxDebtRowsFromCoordinates([
      ...header(1),
      ...debtRow(1, 700, {
        number: "60090",
        name: "عميل بلا مندوب",
        currency: "SR",
        amount: "400",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.representativeCode).toBeUndefined();
    expect(rows[0]?.warnings).toContain(
      "كود المندوب غير موجود في الصف المستخرج.",
    );
  });

  it("لا يستخرج صفحة لا تحتوي على رأس Onyx كافٍ", () => {
    const rows = extractOnyxDebtRowsFromCoordinates([
      item(1, "رقم العميل", columnX.customerNumber, 760),
      item(1, "اسم العميل", columnX.customerName, 760),
      item(1, "60001", columnX.customerNumber, 700),
      item(1, "اسم بلا جدول", columnX.customerName, 700),
    ]);

    expect(rows).toEqual([]);
  });
});
