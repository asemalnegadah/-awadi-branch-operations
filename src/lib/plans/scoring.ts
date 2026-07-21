import {
  DAILY_PLAN_RULESET_VERSION,
  type BuildDailyPlanOptions,
  type BuiltDailyPlan,
  type DailyPlanCandidateInput,
  type DailyPlanFactor,
  type DailyPlanMoneyByCurrency,
  type DailyPlanPriorityLevel,
  type DailyPlanTaskType,
  type PlannedDailyPlanCandidate,
  type ScoredDailyPlanCandidate,
} from "./types";

const ZERO_MONEY: DailyPlanMoneyByCurrency = Object.freeze({ SR: 0, RG: 0 });

export function scoreDailyPlanCandidate(
  input: DailyPlanCandidateInput,
): ScoredDailyPlanCandidate {
  validateCandidate(input);
  const factors: DailyPlanFactor[] = [];

  addPromiseFactors(input, factors);
  addAgingFactors(input, factors);
  addOutstandingFactors(input, factors);
  addRiskFactors(input, factors);
  addVisitFactor(input, factors);
  addReconciliationFactor(input, factors);
  addLifecycleFactor(input, factors);
  addManagerPriorityFactor(input, factors);
  addSalesOpportunityFactor(input, factors);
  addDataQualityFactors(input, factors);

  const hasDebt = totalMoney(input.outstandingMinor) > 0;
  const hasPromise = input.promise !== null;
  const closedWithoutRecoveryWork = ["PERMANENTLY_CLOSED", "BANKRUPT"].includes(
    input.lifecycleStatus,
  ) && !hasDebt && !hasPromise && input.unresolvedReconciliationCount === 0;
  const eligible = !closedWithoutRecoveryWork;
  const score = Math.min(1000, factors.reduce((sum, factor) => sum + factor.points, 0));
  const targetCollectionMinor = eligible
    ? collectionTargets(input)
    : ZERO_MONEY;
  const targetSalesMinor = eligible && !hasActiveRestriction(input)
    ? input.salesTargetMinor
    : ZERO_MONEY;
  const taskType = taskTypeFor(input, targetCollectionMinor, targetSalesMinor);

  return Object.freeze({
    input,
    score,
    priorityLevel: priorityLevelFor(score),
    taskType,
    factors: Object.freeze(factors),
    eligible,
    exclusionReason: closedWithoutRecoveryWork
      ? "العميل مغلق أو مفلس ولا يوجد رصيد أو وعد أو فرق يحتاج زيارة موثقة."
      : null,
    selectionReason: selectionReasonFor(input, factors),
    objective: objectiveFor(taskType, input),
    expectedResult: expectedResultFor(taskType),
    targetCollectionMinor,
    targetSalesMinor,
    estimatedWorkMinutes: input.estimatedTravelMinutes + input.estimatedVisitMinutes,
  });
}

export function buildDailyPlan(
  inputs: readonly DailyPlanCandidateInput[],
  options: BuildDailyPlanOptions,
): BuiltDailyPlan {
  validateBuildOptions(options);
  const scored = inputs.map(scoreDailyPlanCandidate);
  const routeGroups = groupByRoute(scored.filter((candidate) => candidate.eligible));
  const orderedEligible = [...routeGroups.entries()]
    .sort((left, right) => {
      const groupDifference = routeGroupScore(right[1]) - routeGroupScore(left[1]);
      if (groupDifference !== 0) return groupDifference;
      return left[0].localeCompare(right[0]);
    })
    .flatMap(([, candidates]) =>
      [...candidates].sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (scoreDifference !== 0) return scoreDifference;
        return left.input.customerId.localeCompare(right.input.customerId);
      }),
    );

  let selectedCount = 0;
  let usedMinutes = 0;
  const planned = new Map<string, PlannedDailyPlanCandidate>();
  for (const candidate of orderedEligible) {
    const capacityAvailable =
      selectedCount < options.maxItems
      && usedMinutes + candidate.estimatedWorkMinutes <= options.workMinutesBudget;
    if (capacityAvailable) {
      selectedCount += 1;
      usedMinutes += candidate.estimatedWorkMinutes;
      planned.set(candidate.input.customerId, Object.freeze({
        ...candidate,
        selected: true,
        selectionRank: selectedCount,
        finalExclusionReason: null,
      }));
    } else {
      planned.set(candidate.input.customerId, Object.freeze({
        ...candidate,
        selected: false,
        selectionRank: null,
        finalExclusionReason:
          selectedCount >= options.maxItems
            ? "تجاوز الحد الأقصى لعدد زيارات اليوم."
            : "لا تتسع له ميزانية وقت العمل بعد احتساب الزيارة والتنقل.",
      }));
    }
  }

  for (const candidate of scored.filter((item) => !item.eligible)) {
    planned.set(candidate.input.customerId, Object.freeze({
      ...candidate,
      selected: false,
      selectionRank: null,
      finalExclusionReason: candidate.exclusionReason,
    }));
  }

  const allCandidates = Object.freeze(
    inputs.map((input) => {
      const candidate = planned.get(input.customerId);
      if (!candidate) throw new Error("daily plan candidate was not classified");
      return candidate;
    }),
  );
  const selected = Object.freeze(
    allCandidates
      .filter((candidate) => candidate.selected)
      .sort((left, right) => (left.selectionRank ?? 0) - (right.selectionRank ?? 0)),
  );
  const excluded = Object.freeze(
    allCandidates
      .filter((candidate) => !candidate.selected)
      .sort((left, right) => right.score - left.score),
  );

  return Object.freeze({
    rulesetVersion: DAILY_PLAN_RULESET_VERSION,
    selected,
    excluded,
    allCandidates,
    targetCollectionMinor: sumCandidateMoney(selected, "targetCollectionMinor"),
    targetSalesMinor: sumCandidateMoney(selected, "targetSalesMinor"),
    estimatedWorkMinutes: selected.reduce(
      (sum, candidate) => sum + candidate.estimatedWorkMinutes,
      0,
    ),
  });
}

function addPromiseFactors(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (!input.promise) return;
  if (input.promise.temporalStatus === "OVERDUE") {
    factors.push(factor(
      "OVERDUE_PROMISE",
      260,
      input.promise.remainingAmountMinor,
      "يوجد وعد سداد متأخر يحتاج متابعة وتحصيلًا عاجلًا.",
    ));
  } else if (input.promise.temporalStatus === "DUE_TODAY") {
    factors.push(factor(
      "DUE_TODAY_PROMISE",
      190,
      input.promise.remainingAmountMinor,
      "يوجد وعد سداد مستحق اليوم.",
    ));
  } else {
    factors.push(factor(
      "UPCOMING_PROMISE",
      90,
      input.promise.dueDate,
      "يوجد وعد قريب يستحق متابعة استباقية.",
    ));
  }
}

function addAgingFactors(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  const buckets: readonly [
    keyof Pick<DailyPlanCandidateInput,
      | "overdue31To60Minor"
      | "overdue61To90Minor"
      | "overdue91To180Minor"
      | "overdueOver180Minor">,
    DailyPlanFactor["code"],
    number,
    string,
  ][] = [
    ["overdue31To60Minor", "AGING_31_60", 55, "يوجد رصيد متأخر بين 31 و60 يومًا."],
    ["overdue61To90Minor", "AGING_61_90", 95, "يوجد رصيد متأخر بين 61 و90 يومًا."],
    ["overdue91To180Minor", "AGING_91_180", 150, "يوجد رصيد متأخر بين 91 و180 يومًا."],
    ["overdueOver180Minor", "AGING_OVER_180", 220, "يوجد رصيد متأخر لأكثر من 180 يومًا."],
  ];
  for (const [key, code, points, explanation] of buckets) {
    const money = input[key];
    if (totalMoney(money) > 0) {
      factors.push(factor(code, points, moneyObservation(money), explanation));
    }
  }
}

function addOutstandingFactors(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (input.outstandingMinor.SR > 0) {
    factors.push(factor(
      "OUTSTANDING_SR",
      amountPresencePoints(input.outstandingMinor.SR),
      input.outstandingMinor.SR,
      "يوجد رصيد SR قائم؛ بقي منفصلًا ولم يجمع مع RG.",
    ));
  }
  if (input.outstandingMinor.RG > 0) {
    factors.push(factor(
      "OUTSTANDING_RG",
      amountPresencePoints(input.outstandingMinor.RG),
      input.outstandingMinor.RG,
      "يوجد رصيد RG قائم؛ بقي منفصلًا ولم يجمع مع SR.",
    ));
  }
}

function addRiskFactors(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  const highest = [...input.riskSignals].sort((left, right) => right.score - left.score)[0];
  if (highest?.riskLevel === "CRITICAL") {
    factors.push(factor("RISK_CRITICAL", 180, highest.score, "تصنيف المخاطر الحالي حرج."));
  } else if (highest?.riskLevel === "HIGH") {
    factors.push(factor("RISK_HIGH", 120, highest.score, "تصنيف المخاطر الحالي مرتفع."));
  } else if (highest?.riskLevel === "MEDIUM") {
    factors.push(factor("RISK_MEDIUM", 60, highest.score, "تصنيف المخاطر الحالي متوسط."));
  }
  if (hasActiveRestriction(input)) {
    factors.push(factor(
      "ACTIVE_CREDIT_RESTRICTION",
      45,
      true,
      "يوجد قرار ائتماني نافذ؛ أُلغي هدف البيع وبقيت مهمة التحصيل أو المعالجة.",
    ));
  }
}

function addVisitFactor(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (input.daysSinceLastVisit === null) return;
  const points = input.daysSinceLastVisit > 120
    ? 110
    : input.daysSinceLastVisit > 90
      ? 90
      : input.daysSinceLastVisit > 60
        ? 60
        : 0;
  if (points > 0) {
    factors.push(factor(
      "STALE_VISIT",
      points,
      input.daysSinceLastVisit,
      "لم تُسجل زيارة حديثة ضمن المدة المقبولة.",
    ));
  }
}

function addReconciliationFactor(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (input.unresolvedReconciliationCount > 0) {
    factors.push(factor(
      "UNRESOLVED_RECONCILIATION",
      Math.min(120, input.unresolvedReconciliationCount * 50),
      input.unresolvedReconciliationCount,
      "توجد مطابقة أو فروقات غير محسومة تتطلب زيارة أو إفادة.",
    ));
  }
}

function addLifecycleFactor(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (["PERMANENTLY_CLOSED", "BANKRUPT"].includes(input.lifecycleStatus)) {
    factors.push(factor(
      "CLOSED_OR_BANKRUPT",
      totalMoney(input.outstandingMinor) > 0 || input.promise ? 160 : 0,
      input.lifecycleStatus,
      "العميل مغلق أو مفلس؛ تُوجّه الزيارة للتحصيل أو حل المشكلة فقط عند وجود التزام قائم.",
    ));
  }
}

function addManagerPriorityFactor(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (input.managerPriority > 0) {
    factors.push(factor(
      "MANAGER_PRIORITY",
      Math.min(200, input.managerPriority * 2),
      input.managerPriority,
      "أضاف مدير الفرع أولوية تشغيلية موثقة لهذا العميل.",
    ));
  }
}

function addSalesOpportunityFactor(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (input.salesOpportunityScore > 0 && !hasActiveRestriction(input)) {
    factors.push(factor(
      "SALES_OPPORTUNITY",
      Math.min(120, input.salesOpportunityScore),
      input.salesOpportunityScore,
      "توجد فرصة بيع مسجلة ولا يوجد قرار ائتماني يمنع متابعتها.",
    ));
  }
}

function addDataQualityFactors(
  input: DailyPlanCandidateInput,
  factors: DailyPlanFactor[],
): void {
  if (!input.routeId) {
    factors.push(factor(
      "MISSING_ROUTE",
      0,
      null,
      "لا يوجد مسار معتمد؛ يظهر النقص ولا يفترض النظام مسارًا مخفيًا.",
    ));
  }
  if (input.daysSinceLastVisit === null) {
    factors.push(factor(
      "MISSING_VISIT_DATA",
      0,
      null,
      "لا تتوفر بيانات زيارة سابقة؛ يظهر النقص في Snapshot.",
    ));
  }
}

function collectionTargets(input: DailyPlanCandidateInput): DailyPlanMoneyByCurrency {
  const promiseSr = input.promise?.currencyCode === "SR"
    ? input.promise.remainingAmountMinor
    : 0;
  const promiseRg = input.promise?.currencyCode === "RG"
    ? input.promise.remainingAmountMinor
    : 0;
  const overdueSr = Math.max(
    input.overdue31To60Minor.SR,
    input.overdue61To90Minor.SR,
    input.overdue91To180Minor.SR,
    input.overdueOver180Minor.SR,
  );
  const overdueRg = Math.max(
    input.overdue31To60Minor.RG,
    input.overdue61To90Minor.RG,
    input.overdue91To180Minor.RG,
    input.overdueOver180Minor.RG,
  );
  return Object.freeze({
    SR: Math.min(input.outstandingMinor.SR, Math.max(promiseSr, overdueSr)),
    RG: Math.min(input.outstandingMinor.RG, Math.max(promiseRg, overdueRg)),
  });
}

function taskTypeFor(
  input: DailyPlanCandidateInput,
  collection: DailyPlanMoneyByCurrency,
  sales: DailyPlanMoneyByCurrency,
): DailyPlanTaskType {
  const hasCollection = totalMoney(collection) > 0;
  const hasSales = totalMoney(sales) > 0;
  if (input.unresolvedReconciliationCount > 0 && !hasCollection && !hasSales) {
    return "RECONCILIATION";
  }
  if (["PERMANENTLY_CLOSED", "BANKRUPT", "UNDER_REVIEW"].includes(input.lifecycleStatus)) {
    return hasCollection ? "MIXED" : "PROBLEM_RESOLUTION";
  }
  if (input.promise && hasCollection && !hasSales) return "PROMISE_FOLLOWUP";
  if (hasCollection && hasSales) return "MIXED";
  if (hasCollection) return "COLLECTION";
  if (hasSales) return "SALES";
  return "DATA_UPDATE";
}

function selectionReasonFor(
  input: DailyPlanCandidateInput,
  factors: readonly DailyPlanFactor[],
): string {
  const positive = factors
    .filter((item) => item.points > 0)
    .sort((left, right) => right.points - left.points)
    .slice(0, 3)
    .map((item) => item.explanationAr);
  if (positive.length > 0) return positive.join(" ");
  if (input.salesOpportunityScore > 0) return "فرصة بيع مسجلة ضمن نطاق المندوب.";
  return "عميل مكلف للمندوب ويحتاج تحديث بيانات أو متابعة تشغيلية.";
}

function objectiveFor(
  taskType: DailyPlanTaskType,
  input: DailyPlanCandidateInput,
): string {
  const labels: Record<DailyPlanTaskType, string> = {
    COLLECTION: "تحصيل الرصيد المستهدف وإثبات السند.",
    PROMISE_FOLLOWUP: "تنفيذ أو تحديث الوعد بتاريخ واضح وإثبات النتيجة.",
    RECONCILIATION: "جمع إفادة العميل والمستندات اللازمة لحسم المطابقة.",
    SALES: "تحويل فرصة البيع إلى طلب موثق ضمن السياسة الائتمانية.",
    DATA_UPDATE: "التحقق من بيانات الاتصال والموقع وتوثيق التحديث.",
    PROBLEM_RESOLUTION: "توثيق المشكلة أو حالة الإغلاق وتحديد الإجراء التالي.",
    MIXED: "تنفيذ التحصيل والمتابعة والفرصة التشغيلية ذات الأولوية.",
  };
  return input.promise ? `${labels[taskType]} الوعد المرتبط: ${input.promise.id}.` : labels[taskType];
}

function expectedResultFor(taskType: DailyPlanTaskType): string {
  if (taskType === "COLLECTION") return "تحصيل موثق أو سبب عدم التحصيل وخطوة تالية.";
  if (taskType === "PROMISE_FOLLOWUP") return "تحصيل أو وعد جديد بتاريخ ومبلغ واضحين.";
  if (taskType === "RECONCILIATION") return "إفادة ومستندات تكفي لنقل المطابقة للمرحلة التالية.";
  if (taskType === "SALES") return "طلب بيع موثق أو سبب رفض الفرصة.";
  if (taskType === "DATA_UPDATE") return "بيانات اتصال وموقع موثقة ومحدثة.";
  if (taskType === "PROBLEM_RESOLUTION") return "مشكلة موثقة مع مسؤول وموعد إجراء.";
  return "نتيجة موثقة تشمل التحصيل والمتابعة وأي طلب بيع صالح.";
}

function priorityLevelFor(score: number): DailyPlanPriorityLevel {
  if (score >= 700) return "CRITICAL";
  if (score >= 450) return "HIGH";
  if (score >= 220) return "MEDIUM";
  return "LOW";
}

function factor(
  code: DailyPlanFactor["code"],
  points: number,
  observedValue: DailyPlanFactor["observedValue"],
  explanationAr: string,
): DailyPlanFactor {
  return Object.freeze({ code, points, observedValue, explanationAr });
}

function groupByRoute(
  candidates: readonly ScoredDailyPlanCandidate[],
): Map<string, ScoredDailyPlanCandidate[]> {
  const groups = new Map<string, ScoredDailyPlanCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.input.routeId ?? `NO_ROUTE:${candidate.input.customerId}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return groups;
}

function routeGroupScore(candidates: readonly ScoredDailyPlanCandidate[]): number {
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  return (sorted[0]?.score ?? 0) + sorted.slice(1, 4).reduce((sum, item) => sum + item.score, 0) / 4;
}

function sumCandidateMoney(
  candidates: readonly PlannedDailyPlanCandidate[],
  key: "targetCollectionMinor" | "targetSalesMinor",
): DailyPlanMoneyByCurrency {
  return Object.freeze(candidates.reduce(
    (sum, candidate) => ({
      SR: sum.SR + candidate[key].SR,
      RG: sum.RG + candidate[key].RG,
    }),
    { SR: 0, RG: 0 },
  ));
}

function amountPresencePoints(amountMinor: number): number {
  if (amountMinor >= 1_000_000) return 80;
  if (amountMinor >= 100_000) return 60;
  if (amountMinor >= 10_000) return 40;
  return 20;
}

function hasActiveRestriction(input: DailyPlanCandidateInput): boolean {
  return input.riskSignals.some((signal) => signal.hasActiveRestriction);
}

function totalMoney(money: DailyPlanMoneyByCurrency): number {
  // Used only to detect presence; monetary values are never reported or persisted as a combined amount.
  return money.SR + money.RG;
}

function moneyObservation(money: DailyPlanMoneyByCurrency): string {
  return `SR:${money.SR};RG:${money.RG}`;
}

function validateCandidate(input: DailyPlanCandidateInput): void {
  const moneyFields: readonly [string, DailyPlanMoneyByCurrency][] = [
    ["outstandingMinor", input.outstandingMinor],
    ["overdue31To60Minor", input.overdue31To60Minor],
    ["overdue61To90Minor", input.overdue61To90Minor],
    ["overdue91To180Minor", input.overdue91To180Minor],
    ["overdueOver180Minor", input.overdueOver180Minor],
    ["salesTargetMinor", input.salesTargetMinor],
  ];
  for (const [name, money] of moneyFields) {
    for (const currency of ["SR", "RG"] as const) {
      if (!Number.isSafeInteger(money[currency]) || money[currency] < 0) {
        throw new Error(`${name}.${currency} must be a non-negative safe integer`);
      }
    }
  }
  const integerFields: readonly [string, number][] = [
    ["estimatedTravelMinutes", input.estimatedTravelMinutes],
    ["estimatedVisitMinutes", input.estimatedVisitMinutes],
    ["unresolvedReconciliationCount", input.unresolvedReconciliationCount],
    ["managerPriority", input.managerPriority],
    ["salesOpportunityScore", input.salesOpportunityScore],
  ];
  for (const [name, value] of integerFields) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  if (input.managerPriority > 100 || input.salesOpportunityScore > 100) {
    throw new Error("managerPriority and salesOpportunityScore must not exceed 100");
  }
  if (
    input.daysSinceLastVisit !== null
    && (!Number.isSafeInteger(input.daysSinceLastVisit) || input.daysSinceLastVisit < 0)
  ) {
    throw new Error("daysSinceLastVisit must be null or a non-negative safe integer");
  }
}

function validateBuildOptions(options: BuildDailyPlanOptions): void {
  if (!Number.isSafeInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 100) {
    throw new Error("maxItems must be an integer between 1 and 100");
  }
  if (
    !Number.isSafeInteger(options.workMinutesBudget)
    || options.workMinutesBudget < 30
    || options.workMinutesBudget > 1440
  ) {
    throw new Error("workMinutesBudget must be an integer between 30 and 1440");
  }
}
