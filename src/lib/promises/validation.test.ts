import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  parseAddFollowUpInput,
  parseAllocateCollectionInput,
  parseCreatePromiseInput,
  parsePromiseListFilters,
  parseUpdatePromiseInput,
} from "./validation";

const ids = {
  customer: "10000000-0000-4000-8000-000000000001",
  account: "10000000-0000-4000-8000-000000000002",
  representative: "10000000-0000-4000-8000-000000000003",
  collection: "10000000-0000-4000-8000-000000000004",
};

describe("payment promise validation", () => {
  it("يقبل وعدًا صحيحًا بعملة SR", () => {
    expect(
      parseCreatePromiseInput({
        customerId: ids.customer,
        customerAccountId: ids.account,
        representativeId: ids.representative,
        currencyCode: "SR",
        promisedAmountMinor: 15_000,
        promiseDate: "2026-07-18",
        dueDate: "2026-07-20",
        debtReason: "فاتورة آجلة",
      }),
    ).toMatchObject({ currencyCode: "SR", promisedAmountMinor: 15_000 });
  });

  it("يرفض العملات غير SR وRG والحقول المالية المحسوبة يدويًا", () => {
    const base = {
      customerId: ids.customer,
      customerAccountId: ids.account,
      representativeId: ids.representative,
      promisedAmountMinor: 15_000,
      promiseDate: "2026-07-18",
      dueDate: "2026-07-20",
      debtReason: "فاتورة آجلة",
    };
    expect(() => parseCreatePromiseInput({ ...base, currencyCode: "USD" })).toThrow(ZodError);
    expect(() =>
      parseCreatePromiseInput({
        ...base,
        currencyCode: "SR",
        fulfilledAmountMinor: 1,
      }),
    ).toThrow(ZodError);
  });

  it("يرفض المبالغ غير الموجبة وتاريخ الاستحقاق السابق للوعد", () => {
    const base = {
      customerId: ids.customer,
      customerAccountId: ids.account,
      representativeId: ids.representative,
      currencyCode: "RG",
      debtReason: "دين سابق",
    };
    expect(() =>
      parseCreatePromiseInput({
        ...base,
        promisedAmountMinor: 0,
        promiseDate: "2026-07-18",
        dueDate: "2026-07-18",
      }),
    ).toThrow(ZodError);
    expect(() =>
      parseCreatePromiseInput({
        ...base,
        promisedAmountMinor: 100,
        promiseDate: "2026-07-19",
        dueDate: "2026-07-18",
      }),
    ).toThrow("تاريخ الاستحقاق لا يجوز أن يسبق تاريخ الوعد");
  });

  it("يفرض version ويمنع تحديثًا فارغًا", () => {
    expect(() => parseUpdatePromiseInput({ version: 1 })).toThrow("لا توجد حقول");
    expect(parseUpdatePromiseInput({ version: 2, notes: "ملاحظة" })).toEqual({
      version: 2,
      notes: "ملاحظة",
    });
  });

  it("يتحقق من اكتمال نتيجة المتابعة", () => {
    expect(() =>
      parseAddFollowUpInput({
        scheduledAt: "2026-07-20T08:00:00+03:00",
        outcome: "تم التواصل",
      }),
    ).toThrow("وقت الإكمال مطلوب");
    expect(
      parseAddFollowUpInput({
        scheduledAt: "2026-07-20T08:00:00+03:00",
        completedAt: "2026-07-20T08:15:00+03:00",
        outcome: "تعهد بالدفع",
      }),
    ).toMatchObject({ outcome: "تعهد بالدفع" });
  });

  it("يفرض مبلغ تخصيص موجبًا", () => {
    expect(parseAllocateCollectionInput({ collectionId: ids.collection, amountMinor: 1 })).toEqual({
      collectionId: ids.collection,
      amountMinor: 1,
    });
    expect(() =>
      parseAllocateCollectionInput({ collectionId: ids.collection, amountMinor: -1 }),
    ).toThrow(ZodError);
  });

  it("يدعم الفلاتر والحد الأعلى للصفحة ويرفض القيم المنطقية المشوهة", () => {
    const filters = parsePromiseListFilters(
      new URLSearchParams("currency=SR&temporalStatus=OVERDUE&limit=100&fulfilled=true"),
    );
    expect(filters).toMatchObject({
      currencyCode: "SR",
      temporalStatus: "OVERDUE",
      fulfilled: true,
      limit: 100,
    });
    expect(() => parsePromiseListFilters(new URLSearchParams("limit=101"))).toThrow(ZodError);
    expect(() =>
      parsePromiseListFilters(new URLSearchParams("fulfilled=maybe")),
    ).toThrow("قيمة الفلتر المنطقي غير صالحة");
  });
});
