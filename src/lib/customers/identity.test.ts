import { describe, expect, it } from "vitest";

import {
  normalizeArabicName,
  normalizeCustomerNumber,
  normalizeExternalIdentifier,
  normalizePhone,
} from "./identity";

describe("Customer identity normalization", () => {
  it("يوحد أشكال الألف والياء والتاء المربوطة", () => {
    expect(normalizeArabicName("  مَؤسَّسَة الإِنماء  ")).toBe("مؤسسه الانماء");
    expect(normalizeArabicName("مؤسسة الإنماء")).toBe("مؤسسه الانماء");
  });

  it("يزيل التطويل والرموز ويجمع المسافات", () => {
    expect(normalizeArabicName("سوبر ـ ماركت / النور")).toBe("سوبر ماركت النور");
  });

  it("يحول الأرقام العربية والفارسية في الهاتف", () => {
    expect(normalizePhone("+٩٦٧ ٧٧٩-٥٩٥-٩٨٢")).toBe("967779595982");
    expect(normalizePhone("۰۱-۲۳۴")).toBe("01234");
  });

  it("يوحد معرف المصدر ورقم العميل دون تخمين", () => {
    expect(normalizeExternalIdentifier(" onyx- 001 ")).toBe("ONYX- 001");
    expect(normalizeCustomerNumber(" 60 013 ")).toBe("60013");
  });
});
