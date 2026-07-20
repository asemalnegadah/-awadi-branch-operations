import type {
  CreditRiskAction,
  CreditRiskFactor,
  CreditRiskInput,
  CreditRiskLevel,
  CreditRiskResult,
  CustomerOperationalStatus,
} from "./types";

export const CREDIT_RISK_RULESET_VERSION = "credit-risk-v1";

export function calculateCreditRisk(input: CreditRiskInput): CreditRiskResult {
  validateInput(input);
  const factors: CreditRiskFactor[] = [];

  addAmountFactor(
    factors,
    "AGING_31_60",
    input.overdue31To60Minor,
    4,
    "يوجد رصيد متأخر بين 31 و60 يومًا.",
  );
  addAmountFactor(
    factors,
    "AGING_61_90",
    input.overdue61To90Minor,
    8,
    "يوجد رصيد متأخر بين 61 و90 يومًا.",
  );
  addAmountFactor(
    factors,
    "AGING_91_180",
    input.overdue91To180Minor,
    15,
    "يوجد رصيد متأخر بين 91 و180 يومًا.",
  );
  addAmountFactor(
    factors,
    "AGING_OVER_180",
    input.overdueOver180Minor,
    25,
    "يوجد رصيد متأخر لأكثر من 180 يومًا.",
  );

  const brokenPromisePoints = Math.min(24, input.brokenPromisesCount * 8);
  if (brokenPromisePoints > 0 || input.overduePromiseAmountMinor > 0) {
    factors.push(Object.freeze({
      code: "BROKEN_PROMISES",
      points: Math.max(5, brokenPromisePoints),
      maxPoints: 24,
      observedValue: input.brokenPromisesCount,
      explanationAr: `لدى العميل ${input.brokenPromisesCount} وعد سداد مكسور أو متأخر.`,
    }));
  }

  if (
    input.creditLimitMinor !== null
    && input.totalOutstandingMinor > input.creditLimitMinor
  ) {
    factors.push(Object.freeze({
      code: "OVER_CREDIT_LIMIT",
      points: 20,
      maxPoints: 20,
      observedValue: input.totalOutstandingMinor - input.creditLimitMinor,
      explanationAr: "الرصيد القائم يتجاوز الحد الائتماني المعتمد.",
    }));
  }

  const statusPoints = operationalStatusPoints(input.customerOperationalStatus);
  if (statusPoints > 0) {
    factors.push(Object.freeze({
      code: "CUSTOMER_OPERATIONAL_STATUS",
      points: statusPoints,
      maxPoints: 35,
      observedValue: input.customerOperationalStatus,
      explanationAr: operationalStatusExplanation(input.customerOperationalStatus),
    }));
  }

  if (input.unresolvedReconciliationCount > 0) {
    factors.push(Object.freeze({
      code: "UNRESOLVED_RECONCILIATION",
      points: Math.min(10, input.unresolvedReconciliationCount * 5),
      maxPoints: 10,
      observedValue: input.unresolvedReconciliationCount,
      explanationAr: "توجد فروقات أو مطابقات غير محسومة.",
    }));
  }

  if (!input.hasUsablePhone) {
    factors.push(Object.freeze({
      code: "MISSING_CONTACT",
      points: 5,
      maxPoints: 5,
      observedValue: false,
      explanationAr: "لا توجد وسيلة اتصال صالحة ومثبتة للعميل.",
    }));
  }

  const staleVisitPoints = input.daysSinceLastVisit === null
    ? 0
    : input.daysSinceLastVisit > 90
      ? 8
      : input.daysSinceLastVisit > 60
        ? 5
        : 0;
  if (staleVisitPoints > 0) {
    factors.push(Object.freeze({
      code: "STALE_VISIT",
      points: staleVisitPoints,
      maxPoints: 8,
      observedValue: input.daysSinceLastVisit,
      explanationAr: "لم تُسجل زيارة حديثة للعميل ضمن المدة المقبولة.",
    }));
  }

  if (input.unhandedCollectionAmountMinor > 0) {
    factors.push(Object.freeze({
      code: "UNHANDED_COLLECTION",
      points: 10,
      maxPoints: 10,
      observedValue: input.unhandedCollectionAmountMinor,
      explanationAr: "يوجد تحصيل مرتبط بالعميل لم يكتمل تسليمه أو إغلاق عهدته.",
    }));
  }

  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  const riskLevel = riskLevelForScore(score);
  const recommendedAction = actionForLevel(riskLevel);
  const missingInputs = normalizeMissingInputs(input);
  const dataQualityScore = Math.max(0, 100 - missingInputs.length * 10);

  return Object.freeze({
    rulesetVersion: CREDIT_RISK_RULESET_VERSION,
    currencyCode: input.currencyCode,
    cutoffAt: new Date(input.cutoffAt).toISOString(),
    score,
    riskLevel,
    recommendedAction,
    automaticBlockRecommended: recommendedAction === "BLOCK",
    dataQualityScore,
    missingInputs: Object.freeze(missingInputs),
    factors: Object.freeze(factors),
  });
}

function addAmountFactor(
  factors: CreditRiskFactor[],
  code: CreditRiskFactor["code"],
  amountMinor: number,
  points: number,
  explanationAr: string,
): void {
  if (amountMinor <= 0) return;
  factors.push(Object.freeze({
    code,
    points,
    maxPoints: points,
    observedValue: amountMinor,
    explanationAr,
  }));
}

function riskLevelForScore(score: number): CreditRiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

function actionForLevel(level: CreditRiskLevel): CreditRiskAction {
  if (level === "CRITICAL") return "BLOCK";
  if (level === "HIGH") return "LIMIT";
  if (level === "MEDIUM") return "MONITOR";
  return "NONE";
}

function operationalStatusPoints(status: CustomerOperationalStatus): number {
  if (status === "BANKRUPT") return 35;
  if (status === "STOPPED" || status === "CLOSED") return 30;
  if (status === "DISPUTED") return 15;
  return 0;
}

function operationalStatusExplanation(status: CustomerOperationalStatus): string {
  if (status === "BANKRUPT") return "العميل مصنف مفلسًا ويحتاج منعًا ائتمانيًا فوريًا بعد اعتماد المدير.";
  if (status === "STOPPED") return "نشاط العميل متوقف ويحتاج مراجعة ائتمانية.";
  if (status === "CLOSED") return "منشأة العميل مغلقة ويجب تقييد البيع الآجل.";
  if (status === "DISPUTED") return "حساب العميل محل نزاع أو فرق غير محسوم.";
  return "حالة العميل تشغيلية.";
}

function normalizeMissingInputs(input: CreditRiskInput): string[] {
  const missing = new Set(input.missingInputs ?? []);
  if (input.creditLimitMinor === null) missing.add("creditLimitMinor");
  if (input.daysSinceLastVisit === null) missing.add("daysSinceLastVisit");
  return [...missing].sort();
}

function validateInput(input: CreditRiskInput): void {
  const integers: readonly [string, number][] = [
    ["totalOutstandingMinor", input.totalOutstandingMinor],
    ["overdue31To60Minor", input.overdue31To60Minor],
    ["overdue61To90Minor", input.overdue61To90Minor],
    ["overdue91To180Minor", input.overdue91To180Minor],
    ["overdueOver180Minor", input.overdueOver180Minor],
    ["brokenPromisesCount", input.brokenPromisesCount],
    ["overduePromiseAmountMinor", input.overduePromiseAmountMinor],
    ["unresolvedReconciliationCount", input.unresolvedReconciliationCount],
    ["unhandedCollectionAmountMinor", input.unhandedCollectionAmountMinor],
  ];
  for (const [name, value] of integers) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer.`);
    }
  }
  if (
    input.creditLimitMinor !== null
    && (!Number.isSafeInteger(input.creditLimitMinor) || input.creditLimitMinor < 0)
  ) {
    throw new Error("creditLimitMinor must be null or a non-negative safe integer.");
  }
  if (
    input.daysSinceLastVisit !== null
    && (!Number.isSafeInteger(input.daysSinceLastVisit) || input.daysSinceLastVisit < 0)
  ) {
    throw new Error("daysSinceLastVisit must be null or a non-negative safe integer.");
  }
  if (Number.isNaN(Date.parse(input.cutoffAt))) {
    throw new Error("cutoffAt must be a valid datetime.");
  }
}
