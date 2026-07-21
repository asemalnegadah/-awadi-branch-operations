import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import type { CurrencyCode } from "@/lib/domain/currency";

export const DAILY_PLAN_RULESET_VERSION = "daily-plan-v1";

export const dailyPlanStates = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type DailyPlanState = (typeof dailyPlanStates)[number];

export const dailyPlanTaskTypes = [
  "COLLECTION",
  "PROMISE_FOLLOWUP",
  "RECONCILIATION",
  "SALES",
  "DATA_UPDATE",
  "PROBLEM_RESOLUTION",
  "MIXED",
] as const;
export type DailyPlanTaskType = (typeof dailyPlanTaskTypes)[number];

export const dailyPlanPriorityLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type DailyPlanPriorityLevel = (typeof dailyPlanPriorityLevels)[number];

export const dailyPlanFactorCodes = [
  "OVERDUE_PROMISE",
  "DUE_TODAY_PROMISE",
  "UPCOMING_PROMISE",
  "AGING_31_60",
  "AGING_61_90",
  "AGING_91_180",
  "AGING_OVER_180",
  "OUTSTANDING_SR",
  "OUTSTANDING_RG",
  "RISK_MEDIUM",
  "RISK_HIGH",
  "RISK_CRITICAL",
  "STALE_VISIT",
  "UNRESOLVED_RECONCILIATION",
  "CLOSED_OR_BANKRUPT",
  "ACTIVE_CREDIT_RESTRICTION",
  "MANAGER_PRIORITY",
  "SALES_OPPORTUNITY",
  "MISSING_ROUTE",
  "MISSING_VISIT_DATA",
] as const;
export type DailyPlanFactorCode = (typeof dailyPlanFactorCodes)[number];

export interface DailyPlanMoneyByCurrency {
  readonly SR: number;
  readonly RG: number;
}

export interface DailyPlanPromiseSignal {
  readonly id: string;
  readonly currencyCode: CurrencyCode;
  readonly remainingAmountMinor: number;
  readonly dueDate: string;
  readonly temporalStatus: "OVERDUE" | "DUE_TODAY" | "UPCOMING";
}

export interface DailyPlanRiskSignal {
  readonly currencyCode: CurrencyCode;
  readonly score: number;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly hasActiveRestriction: boolean;
}

export interface DailyPlanCandidateInput {
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly representativeId: string;
  readonly lifecycleStatus:
    | "ACTIVE"
    | "TEMPORARILY_CLOSED"
    | "PERMANENTLY_CLOSED"
    | "BANKRUPT"
    | "SUSPENDED"
    | "UNDER_REVIEW";
  readonly areaId: string | null;
  readonly routeId: string | null;
  readonly routeName: string | null;
  readonly estimatedTravelMinutes: number;
  readonly estimatedVisitMinutes: number;
  readonly outstandingMinor: DailyPlanMoneyByCurrency;
  readonly overdue31To60Minor: DailyPlanMoneyByCurrency;
  readonly overdue61To90Minor: DailyPlanMoneyByCurrency;
  readonly overdue91To180Minor: DailyPlanMoneyByCurrency;
  readonly overdueOver180Minor: DailyPlanMoneyByCurrency;
  readonly promise: DailyPlanPromiseSignal | null;
  readonly riskSignals: readonly DailyPlanRiskSignal[];
  readonly daysSinceLastVisit: number | null;
  readonly unresolvedReconciliationCount: number;
  readonly managerPriority: number;
  readonly salesOpportunityScore: number;
  readonly salesTargetMinor: DailyPlanMoneyByCurrency;
  readonly missingInputs?: readonly string[] | undefined;
}

export interface DailyPlanFactor {
  readonly code: DailyPlanFactorCode;
  readonly points: number;
  readonly observedValue: string | number | boolean | null;
  readonly explanationAr: string;
}

export interface ScoredDailyPlanCandidate {
  readonly input: DailyPlanCandidateInput;
  readonly score: number;
  readonly priorityLevel: DailyPlanPriorityLevel;
  readonly taskType: DailyPlanTaskType;
  readonly factors: readonly DailyPlanFactor[];
  readonly eligible: boolean;
  readonly exclusionReason: string | null;
  readonly selectionReason: string;
  readonly objective: string;
  readonly expectedResult: string;
  readonly targetCollectionMinor: DailyPlanMoneyByCurrency;
  readonly targetSalesMinor: DailyPlanMoneyByCurrency;
  readonly estimatedWorkMinutes: number;
}

export interface PlannedDailyPlanCandidate extends ScoredDailyPlanCandidate {
  readonly selected: boolean;
  readonly selectionRank: number | null;
  readonly finalExclusionReason: string | null;
}

export interface BuildDailyPlanOptions {
  readonly maxItems: number;
  readonly workMinutesBudget: number;
}

export interface BuiltDailyPlan {
  readonly rulesetVersion: string;
  readonly selected: readonly PlannedDailyPlanCandidate[];
  readonly excluded: readonly PlannedDailyPlanCandidate[];
  readonly allCandidates: readonly PlannedDailyPlanCandidate[];
  readonly targetCollectionMinor: DailyPlanMoneyByCurrency;
  readonly targetSalesMinor: DailyPlanMoneyByCurrency;
  readonly estimatedWorkMinutes: number;
}

export interface DailyPlan {
  readonly id: string;
  readonly representativeId: string;
  readonly representativeName: string;
  readonly planDate: string;
  readonly state: DailyPlanState;
  readonly generationMode: "AUTO" | "MANUAL" | "HYBRID";
  readonly cutoffAt: string;
  readonly rulesetVersion: string;
  readonly sourceSnapshot: Readonly<Record<string, unknown>>;
  readonly inputFingerprint: string;
  readonly targetCollectionSrMinor: number;
  readonly targetCollectionRgMinor: number;
  readonly targetSalesSrMinor: number;
  readonly targetSalesRgMinor: number;
  readonly fuelBudgetCurrencyCode: CurrencyCode | null;
  readonly fuelBudgetMinor: number | null;
  readonly estimatedWorkMinutes: number;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly startedBy: string | null;
  readonly startedAt: string | null;
  readonly completedBy: string | null;
  readonly completedAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface DailyPlanItem {
  readonly id: string;
  readonly planId: string;
  readonly sequenceNumber: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly linkedPromiseId: string | null;
  readonly taskType: DailyPlanTaskType;
  readonly priorityLevel: DailyPlanPriorityLevel;
  readonly priorityScore: number;
  readonly selectionReason: string;
  readonly objective: string;
  readonly expectedResult: string;
  readonly targetCollectionSrMinor: number;
  readonly targetCollectionRgMinor: number;
  readonly targetSalesSrMinor: number;
  readonly targetSalesRgMinor: number;
  readonly areaId: string | null;
  readonly areaName: string | null;
  readonly routeId: string | null;
  readonly routeName: string | null;
  readonly estimatedVisitMinutes: number;
  readonly estimatedTravelMinutes: number;
  readonly manualOverride: boolean;
  readonly version: number;
}

export interface DailyPlanCandidateRecord {
  readonly id: string;
  readonly planId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly routeId: string | null;
  readonly routeName: string | null;
  readonly areaId: string | null;
  readonly areaName: string | null;
  readonly computedScore: number;
  readonly selected: boolean;
  readonly selectionRank: number | null;
  readonly decisionReason: string;
  readonly exclusionReason: string | null;
  readonly factors: readonly DailyPlanFactor[];
  readonly sourceSnapshot: Readonly<Record<string, unknown>>;
  readonly linkedPromiseId: string | null;
}

export interface DailyPlanEvent {
  readonly id: string;
  readonly planId: string;
  readonly eventType:
    | "GENERATED"
    | "CREATED"
    | "UPDATED"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED"
    | "STARTED"
    | "COMPLETED"
    | "CANCELLED";
  readonly actorUserId: string;
  readonly actorName: string;
  readonly occurredAt: string;
  readonly oldValues: Readonly<Record<string, unknown>>;
  readonly newValues: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
}

export interface DailyPlanDetails {
  readonly plan: DailyPlan;
  readonly items: readonly DailyPlanItem[];
  readonly candidates: readonly DailyPlanCandidateRecord[];
  readonly events: readonly DailyPlanEvent[];
}

export interface DailyPlanReadContext {
  readonly actor: AuthenticatedUser;
}

export interface DailyPlanCommandContext extends DailyPlanReadContext {
  readonly request: RequestSecurityContext;
  readonly idempotencyKey: string;
  readonly sessionId?: string | undefined;
}

export interface GenerateDailyPlanInput {
  readonly representativeId: string;
  readonly planDate: string;
  readonly maxItems: number;
  readonly workMinutesBudget: number;
  readonly fuelBudgetCurrencyCode?: CurrencyCode | null | undefined;
  readonly fuelBudgetMinor?: number | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface DailyPlanTransitionInput {
  readonly version: number;
  readonly reason?: string | undefined;
}

export interface DailyPlanListFilters {
  readonly representativeId?: string | undefined;
  readonly planDateFrom?: string | undefined;
  readonly planDateTo?: string | undefined;
  readonly state?: DailyPlanState | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface DailyPlanPage {
  readonly items: readonly DailyPlan[];
  readonly nextCursor: string | null;
}
