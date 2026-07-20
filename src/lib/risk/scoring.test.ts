import { describe, expect, it } from "vitest";

import { CREDIT_RISK_RULESET_VERSION, calculateCreditRisk } from "./scoring";
import type { CreditRiskInput } from "./types";

function baseline(overrides: Partial<CreditRiskInput> = {}): CreditRiskInput {
  return {
    currencyCode: "SR",
    cutoffAt: "2026-07-21T00:00:00.000Z",
    totalOutstandingMinor: 0,
    overdue31To60Minor: 0,
    overdue61To90Minor: 0,
    overdue91To180Minor: 0,
    overdueOver180Minor: 0,
    creditLimitMinor: 100_000,
    brokenPromisesCount: 0,
    overduePromiseAmountMinor: 0,
    unresolvedReconciliationCount: 0,
    customerOperationalStatus: "ACTIVE",
    hasUsablePhone: true,
    daysSinceLastVisit: 10,
    unhandedCollectionAmountMinor: 0,
    ...overrides,
  };
}

describe("credit risk scoring", () => {
  it("يصنف العميل السليم منخفض المخاطر دون توصية منع", () => {
    const result = calculateCreditRisk(baseline());
    expect(result).toMatchObject({
      rulesetVersion: CREDIT_RISK_RULESET_VERSION,
      currencyCode: "SR",
      score: 0,
      riskLevel: "LOW",
      recommendedAction: "NONE",
      automaticBlockRecommended: false,
      dataQualityScore: 100,
    });
    expect(result.factors).toEqual([]);
  });

  it("يصنف الدين القديم والوعود المكسورة والتجاوز كخطر حرج", () => {
    const result = calculateCreditRisk(baseline({
      totalOutstandingMinor: 300_000,
      overdue91To180Minor: 50_000,
      overdueOver180Minor: 150_000,
      creditLimitMinor: 100_000,
      brokenPromisesCount: 3,
      overduePromiseAmountMinor: 75_000,
      unresolvedReconciliationCount: 2,
      customerOperationalStatus: "STOPPED",
      hasUsablePhone: false,
      daysSinceLastVisit: 120,
      unhandedCollectionAmountMinor: 20_000,
    }));

    expect(result.score).toBe(100);
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.recommendedAction).toBe("BLOCK");
    expect(result.automaticBlockRecommended).toBe(true);
    expect(result.factors.map((factor) => factor.code)).toEqual(expect.arrayContaining([
      "AGING_OVER_180",
      "BROKEN_PROMISES",
      "OVER_CREDIT_LIMIT",
      "CUSTOMER_OPERATIONAL_STATUS",
      "UNRESOLVED_RECONCILIATION",
      "MISSING_CONTACT",
      "STALE_VISIT",
      "UNHANDED_COLLECTION",
    ]));
  });

  it("يحافظ على فصل تقييم SR عن RG ولا يجمع العملات", () => {
    const sr = calculateCreditRisk(baseline({
      currencyCode: "SR",
      totalOutstandingMinor: 50_000,
      overdue61To90Minor: 50_000,
    }));
    const rg = calculateCreditRisk(baseline({
      currencyCode: "RG",
      totalOutstandingMinor: 10_000,
      overdue31To60Minor: 10_000,
    }));

    expect(sr.currencyCode).toBe("SR");
    expect(rg.currencyCode).toBe("RG");
    expect(sr.score).not.toBe(rg.score);
  });

  it("يخفض جودة البيانات عند غياب الحد الائتماني أو الزيارة", () => {
    const result = calculateCreditRisk(baseline({
      creditLimitMinor: null,
      daysSinceLastVisit: null,
      missingInputs: ["contactVerification"],
    }));
    expect(result.missingInputs).toEqual([
      "contactVerification",
      "creditLimitMinor",
      "daysSinceLastVisit",
    ]);
    expect(result.dataQualityScore).toBe(70);
  });

  it("يرفض الأرقام السالبة أو غير الصحيحة", () => {
    expect(() => calculateCreditRisk(baseline({ totalOutstandingMinor: -1 }))).toThrow();
    expect(() => calculateCreditRisk(baseline({ brokenPromisesCount: 1.5 }))).toThrow();
  });
});
