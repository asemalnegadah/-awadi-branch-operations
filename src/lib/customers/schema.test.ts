import { describe, expect, it } from "vitest";

import { parseCreateCustomerInput } from "./schema";

describe("Customer schema", () => {
  it("يقبل عميلًا بالحد الأدنى ويطبق القيم الافتراضية", () => {
    const result = parseCreateCustomerInput({ tradeNameAr: "متجر تجريبي" });

    expect(result).toMatchObject({
      tradeNameAr: "متجر تجريبي",
      customerType: "RETAIL",
      lifecycleStatus: "ACTIVE",
      creditStatus: "ALLOWED",
    });
  });

  it("ينظف المسافات في الاسم والرقم", () => {
    const result = parseCreateCustomerInput({
      customerNumber: "  60001  ",
      tradeNameAr: "  متجر النور  ",
    });

    expect(result.customerNumber).toBe("60001");
    expect(result.tradeNameAr).toBe("متجر النور");
  });

  it("يرفض اسمًا قصيرًا أو فارغًا", () => {
    expect(() => parseCreateCustomerInput({ tradeNameAr: " " })).toThrow();
    expect(() => parseCreateCustomerInput({ tradeNameAr: "أ" })).toThrow();
  });

  it("يرفض حالة ائتمان غير معرفة", () => {
    expect(() =>
      parseCreateCustomerInput({
        tradeNameAr: "عميل اختبار",
        creditStatus: "UNKNOWN",
      }),
    ).toThrow();
  });
});
