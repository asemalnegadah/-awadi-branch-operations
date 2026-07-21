import { describe, expect, it } from "vitest";

import { buildDailyPlan, scoreDailyPlanCandidate } from "./scoring";
import type { DailyPlanCandidateInput } from "./types";

function candidate(
  customerId: string,
  overrides: Partial<DailyPlanCandidateInput> = {},
): DailyPlanCandidateInput {
  return {
    customerId,
    customerName: `عميل ${customerId}`,
    customerNumber: customerId,
    representativeId: "00000000-0000-4000-8000-000000000001",
    lifecycleStatus: "ACTIVE",
    areaId: "10000000-0000-4000-8000-000000000001",
    routeId: "20000000-0000-4000-8000-000000000001",
    routeName: "المسار الأول",
    estimatedTravelMinutes: 15,
    estimatedVisitMinutes: 30,
    outstandingMinor: { SR: 0, RG: 0 },
    overdue31To60Minor: { SR: 0, RG: 0 },
    overdue61To90Minor: { SR: 0, RG: 0 },
    overdue91To180Minor: { SR: 0, RG: 0 },
    overdueOver180Minor: { SR: 0, RG: 0 },
    promise: null,
    riskSignals: [],
    daysSinceLastVisit: 10,
    unresolvedReconciliationCount: 0,
    managerPriority: 0,
    salesOpportunityScore: 0,
    salesTargetMinor: { SR: 0, RG: 0 },
    ...overrides,
  };
}

describe("daily plan scoring", () => {
  it("يرفع أولوية الوعد المتأخر والدين القديم دون جمع SR وRG", () => {
    const result = scoreDailyPlanCandidate(candidate("C-1", {
      outstandingMinor: { SR: 50_000, RG: 7_000 },
      overdueOver180Minor: { SR: 40_000, RG: 0 },
      overdue91To180Minor: { SR: 0, RG: 5_000 },
      promise: {
        id: "30000000-0000-4000-8000-000000000001",
        currencyCode: "SR",
        remainingAmountMinor: 25_000,
        dueDate: "2026-07-20",
        temporalStatus: "OVERDUE",
      },
      riskSignals: [{
        currencyCode: "SR",
        score: 82,
        riskLevel: "CRITICAL",
        hasActiveRestriction: false,
      }],
    }));

    expect(result.priorityLevel).toBe("CRITICAL");
    expect(result.factors.map((factor) => factor.code)).toEqual(
      expect.arrayContaining([
        "OVERDUE_PROMISE",
        "AGING_OVER_180",
        "AGING_91_180",
        "OUTSTANDING_SR",
        "OUTSTANDING_RG",
        "RISK_CRITICAL",
      ]),
    );
    expect(result.targetCollectionMinor).toEqual({ SR: 40_000, RG: 5_000 });
    expect(result.taskType).toBe("PROMISE_FOLLOWUP");
  });

  it("يلغي هدف البيع عند وجود قرار ائتماني نافذ ويبقي التحصيل", () => {
    const result = scoreDailyPlanCandidate(candidate("C-2", {
      outstandingMinor: { SR: 20_000, RG: 0 },
      overdue61To90Minor: { SR: 15_000, RG: 0 },
      salesOpportunityScore: 90,
      salesTargetMinor: { SR: 50_000, RG: 0 },
      riskSignals: [{
        currencyCode: "SR",
        score: 70,
        riskLevel: "HIGH",
        hasActiveRestriction: true,
      }],
    }));

    expect(result.targetCollectionMinor).toEqual({ SR: 15_000, RG: 0 });
    expect(result.targetSalesMinor).toEqual({ SR: 0, RG: 0 });
    expect(result.factors.map((factor) => factor.code)).toContain("ACTIVE_CREDIT_RESTRICTION");
    expect(result.taskType).toBe("COLLECTION");
  });

  it("يستبعد العميل المغلق بلا التزام ويحتفظ بسبب الاستبعاد", () => {
    const result = scoreDailyPlanCandidate(candidate("C-3", {
      lifecycleStatus: "PERMANENTLY_CLOSED",
      daysSinceLastVisit: null,
    }));

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toContain("مغلق أو مفلس");
    expect(result.targetCollectionMinor).toEqual({ SR: 0, RG: 0 });
  });

  it("يجمع زيارات المسار نفسه ويستبعد ما يتجاوز طاقة اليوم", () => {
    const built = buildDailyPlan([
      candidate("C-A", {
        routeId: "route-a",
        managerPriority: 100,
        estimatedTravelMinutes: 10,
        estimatedVisitMinutes: 30,
      }),
      candidate("C-B", {
        routeId: "route-a",
        overdue91To180Minor: { SR: 10_000, RG: 0 },
        outstandingMinor: { SR: 10_000, RG: 0 },
        estimatedTravelMinutes: 10,
        estimatedVisitMinutes: 30,
      }),
      candidate("C-C", {
        routeId: "route-b",
        promise: {
          id: "40000000-0000-4000-8000-000000000001",
          currencyCode: "RG",
          remainingAmountMinor: 5_000,
          dueDate: "2026-07-21",
          temporalStatus: "DUE_TODAY",
        },
        outstandingMinor: { SR: 0, RG: 5_000 },
        estimatedTravelMinutes: 60,
        estimatedVisitMinutes: 60,
      }),
    ], { maxItems: 2, workMinutesBudget: 90 });

    expect(built.selected).toHaveLength(2);
    expect(built.selected.map((item) => item.input.customerId)).toEqual(["C-A", "C-B"]);
    expect(built.excluded).toHaveLength(1);
    expect(built.excluded[0]?.finalExclusionReason).toContain("عدد زيارات");
    expect(built.estimatedWorkMinutes).toBe(80);
  });

  it("يرفض المدخلات النقدية أو القيود غير الصالحة", () => {
    expect(() => scoreDailyPlanCandidate(candidate("C-X", {
      outstandingMinor: { SR: -1, RG: 0 },
    }))).toThrow(/outstandingMinor\.SR/u);
    expect(() => buildDailyPlan([candidate("C-X")], {
      maxItems: 0,
      workMinutesBudget: 480,
    })).toThrow(/maxItems/u);
  });
});
