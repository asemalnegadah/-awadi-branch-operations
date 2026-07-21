import { describe, expect, it } from "vitest";

import {
  parseConsumeCreditExceptionInput,
  parseReverseCreditExceptionUsageInput,
} from "./usage-validation";

const exceptionId = "00000000-0000-4000-8000-000000000001";
const usageId = "10000000-0000-4000-8000-000000000001";

describe("credit exception usage validation", () => {
  it("يقبل استهلاكًا موثقًا بوحدات صغرى", () => {
    expect(parseConsumeCreditExceptionInput({
      exceptionId,
      amountMinor: 1250,
      sourceType: "CREDIT_SALE",
      sourceId: "SALE-2026-0001",
      metadata: { channel: "WEB" },
    })).toEqual({
      exceptionId,
      amountMinor: 1250,
      sourceType: "CREDIT_SALE",
      sourceId: "SALE-2026-0001",
      metadata: { channel: "WEB" },
    });
  });

  it("يرفض المبلغ الكسري أو غير الموجب والمصدر غير المعياري", () => {
    expect(() => parseConsumeCreditExceptionInput({
      exceptionId,
      amountMinor: 12.5,
      sourceType: "CREDIT SALE",
      sourceId: "SALE 1",
    })).toThrow();
    expect(() => parseConsumeCreditExceptionInput({
      exceptionId,
      amountMinor: 0,
      sourceType: "CREDIT_SALE",
      sourceId: "SALE-1",
    })).toThrow();
  });

  it("يفرض سببًا صريحًا لعكس الاستهلاك", () => {
    expect(parseReverseCreditExceptionUsageInput({ usageId, reason: "إلغاء الفاتورة." })).toEqual({
      usageId,
      reason: "إلغاء الفاتورة.",
    });
    expect(() => parseReverseCreditExceptionUsageInput({ usageId, reason: "" })).toThrow();
  });
});
