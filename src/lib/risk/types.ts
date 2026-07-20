import type { CurrencyCode } from "@/lib/domain/currency";

export const creditRiskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type CreditRiskLevel = (typeof creditRiskLevels)[number];

export const creditRiskActions = ["NONE", "MONITOR", "LIMIT", "BLOCK"] as const;
export type CreditRiskAction = (typeof creditRiskActions)[number];

export const customerOperationalStatuses = [
  "ACTIVE",
  "STOPPED",
  "CLOSED",
  "BANKRUPT",
  "DISPUTED",
] as const;
export type CustomerOperationalStatus = (typeof customerOperationalStatuses)[number];

export const creditRiskFactorCodes = [
  "AGING_31_60",
  "AGING_61_90",
  "AGING_91_180",
  "AGING_OVER_180",
  "BROKEN_PROMISES",
  "OVER_CREDIT_LIMIT",
  "CUSTOMER_OPERATIONAL_STATUS",
  "UNRESOLVED_RECONCILIATION",
  "MISSING_CONTACT",
  "STALE_VISIT",
  "UNHANDED_COLLECTION",
] as const;
export type CreditRiskFactorCode = (typeof creditRiskFactorCodes)[number];

export interface CreditRiskInput {
  readonly currencyCode: CurrencyCode;
  readonly cutoffAt: string;
  readonly totalOutstandingMinor: number;
  readonly overdue31To60Minor: number;
  readonly overdue61To90Minor: number;
  readonly overdue91To180Minor: number;
  readonly overdueOver180Minor: number;
  readonly creditLimitMinor: number | null;
  readonly brokenPromisesCount: number;
  readonly overduePromiseAmountMinor: number;
  readonly unresolvedReconciliationCount: number;
  readonly customerOperationalStatus: CustomerOperationalStatus;
  readonly hasUsablePhone: boolean;
  readonly daysSinceLastVisit: number | null;
  readonly unhandedCollectionAmountMinor: number;
  readonly missingInputs?: readonly string[];
}

export interface CreditRiskFactor {
  readonly code: CreditRiskFactorCode;
  readonly points: number;
  readonly maxPoints: number;
  readonly observedValue: number | string | boolean | null;
  readonly explanationAr: string;
}

export interface CreditRiskResult {
  readonly rulesetVersion: string;
  readonly currencyCode: CurrencyCode;
  readonly cutoffAt: string;
  readonly score: number;
  readonly riskLevel: CreditRiskLevel;
  readonly recommendedAction: CreditRiskAction;
  readonly automaticBlockRecommended: boolean;
  readonly dataQualityScore: number;
  readonly missingInputs: readonly string[];
  readonly factors: readonly CreditRiskFactor[];
}
