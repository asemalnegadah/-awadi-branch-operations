import { describe, expect, it } from "vitest";

import {
  detectCustomerNameRelationship,
  resolveExtractedCustomer,
  type CustomerIdentityCandidate,
} from "./resolve-extracted-customer";

const customerA: CustomerIdentityCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  tradeNameAr: "مؤسسة عبدالله محمد للتجارة",
  accountIdentities: [
    { customerNumber: "60001", currency: "SR" },
    { customerNumber: "20001", currency: "RG" },
  ],
  phones: ["967777111222"],
  representativeName: "سعد",
  areaName: "المنصورة",
};

const customerB: CustomerIdentityCandidate = {
  id: "22222222-2222-4222-8222-222222222222",
  tradeNameAr: "مؤسسة عبدالله حسن للتجارة",
  accountIdentities: [{ customerNumber: "60002", currency: "SR" }],
  phones: ["967777333444"],
  representativeName: "هيثم",
  areaName: "كريتر",
};

describe("Extracted customer resolution", () => {
  it("يربط الاسم المقطوع بالاسم الكامل اعتمادًا على رقم العميل", () => {
    const result = resolveExtractedCustomer(
      {
        customerNumber: "60001",
        currency: "SR",
        customerName: "مؤسسة عبدالله محمد",
      },
      [customerA, customerB],
    );

    expect(result.status).toBe("MATCHED_BY_CUSTOMER_NUMBER");
    expect(result.matchedCustomerId).toBe(customerA.id);
    expect(result.canonicalCustomerName).toBe(customerA.tradeNameAr);
    expect(result.nameRelationship).toBe("TRUNCATED_PREFIX");
    expect(result.autoLinkAllowed).toBe(true);
    expect(result.warnings).toContain(
      "اسم العميل في PDF مقطوع؛ تم الربط برقم العميل واستخدام الاسم الكامل من السجل الرئيسي.",
    );
  });

  it("يعامل رقم العميل كرقم حساب منفصل عن الهاتف", () => {
    const result = resolveExtractedCustomer(
      {
        customerNumber: "60001",
        currency: "SR",
        customerName: "مؤسسة عبدالله محمد",
        phones: [customerB.phones?.[0] ?? ""],
      },
      [customerA, customerB],
    );

    expect(result.status).toBe("CONFLICT");
    expect(result.autoLinkAllowed).toBe(false);
    expect(result.warnings).toContain(
      "رقم العميل يشير إلى عميل، بينما الهاتف يشير إلى عميل آخر؛ يجب مراجعة الصف.",
    );
  });

  it("لا يربط تلقائيًا اعتمادًا على الهاتف وحده", () => {
    const result = resolveExtractedCustomer(
      {
        customerName: "مؤسسة عبدالله محمد",
        phones: ["967777111222"],
      },
      [customerA, customerB],
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.autoLinkAllowed).toBe(false);
    expect(result.matchedCustomerId).toBeUndefined();
  });

  it("يستخدم العملة للتمييز بين رقمي SR وRG لنفس العميل", () => {
    const sr = resolveExtractedCustomer(
      {
        customerNumber: "60001",
        currency: "SR",
        customerName: "مؤسسة عبدالله محمد",
      },
      [customerA],
    );
    const rg = resolveExtractedCustomer(
      {
        customerNumber: "20001",
        currency: "RG",
        customerName: "مؤسسة عبدالله محمد",
      },
      [customerA],
    );

    expect(sr.matchedCustomerId).toBe(customerA.id);
    expect(rg.matchedCustomerId).toBe(customerA.id);
  });

  it("يرفض الرقم الصحيح عندما يكون الاسم مختلفًا وليس مقطوعًا", () => {
    const result = resolveExtractedCustomer(
      {
        customerNumber: "60001",
        currency: "SR",
        customerName: "سوبر ماركت مختلف تمامًا",
      },
      [customerA],
    );

    expect(result.status).toBe("CONFLICT");
    expect(result.autoLinkAllowed).toBe(false);
    expect(result.warnings).toContain(
      "رقم العميل مطابق لكن الاسم المستخرج مختلف وليس مجرد اسم مقطوع.",
    );
  });

  it("يوقف الربط إذا كان رقم العميل نفسه مرتبطًا بعميلين", () => {
    const duplicateNumberCandidate: CustomerIdentityCandidate = {
      ...customerB,
      accountIdentities: [{ customerNumber: "60001", currency: "SR" }],
    };

    const result = resolveExtractedCustomer(
      {
        customerNumber: "60001",
        currency: "SR",
        customerName: "مؤسسة عبدالله",
      },
      [customerA, duplicateNumberCandidate],
    );

    expect(result.status).toBe("CONFLICT");
    expect(result.autoLinkAllowed).toBe(false);
  });

  it("يكشف الاسم المقطوع عند حد كلمة أو داخل الكلمة الأخيرة", () => {
    expect(
      detectCustomerNameRelationship(
        "شركة المقبلي للصناعه",
        "شركة المقبلي للصناعة والتجارة",
      ),
    ).toBe("TRUNCATED_PREFIX");

    expect(
      detectCustomerNameRelationship("متجر الن", "متجر النور"),
    ).toBe("TRUNCATED_PREFIX");

    expect(
      detectCustomerNameRelationship("متجر الشرق", "متجر النور"),
    ).toBe("DIFFERENT");
  });
});
