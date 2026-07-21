import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
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

export const creditRestrictionDecisionTypes = ["LIMIT", "SUSPEND", "BLOCK"] as const;
export type CreditRestrictionDecisionType = (typeof creditRestrictionDecisionTypes)[number];

export const creditDecisionStates = [
  "DRAFT",
  "PENDING_APPROVAL",
  "ACTIVE",
  "REJECTED",
  "REVOKED",
  "EXPIRED",
] as const;
export type CreditDecisionState = (typeof creditDecisionStates)[number];

export const creditRestrictionReasonCodes = [
  "OLD_DEBT",
  "BROKEN_PROMISE",
  "RECONCILIATION_DIFFERENCE",
  "CLOSED_OR_BANKRUPT",
  "DISPUTE",
  "MISSING_CONTACT",
  "NO_VISIT",
  "UNHANDED_COLLECTION",
  "CREDIT_LIMIT_EXCEEDED",
  "MANAGER_DECISION",
  "OTHER",
] as const;
export type CreditRestrictionReasonCode = (typeof creditRestrictionReasonCodes)[number];

export const creditExceptionScopes = ["SINGLE_TRANSACTION", "MULTIPLE_TRANSACTIONS"] as const;
export type CreditExceptionScope = (typeof creditExceptionScopes)[number];

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

export interface CreditRiskAssessment extends CreditRiskResult {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly sourceSnapshot: Readonly<Record<string, unknown>>;
  readonly inputFingerprint: string;
  readonly supersedesAssessmentId: string | null;
  readonly assessedBy: string;
  readonly assessedByName: string;
  readonly assessedAt: string;
}

export interface CreditRestriction {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly currencyCode: CurrencyCode;
  readonly decisionType: CreditRestrictionDecisionType;
  readonly limitAmountMinor: number | null;
  readonly state: CreditDecisionState;
  readonly reasonCode: CreditRestrictionReasonCode;
  readonly reasonText: string;
  readonly sourceAssessmentId: string | null;
  readonly effectiveFrom: string;
  readonly reviewDueAt: string | null;
  readonly expiresAt: string | null;
  readonly restorationConditions: string;
  readonly proposedBy: string;
  readonly proposedByName: string;
  readonly proposedAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly revokedBy: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreditException {
  readonly id: string;
  readonly restrictionId: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly currencyCode: CurrencyCode;
  readonly scope: CreditExceptionScope;
  readonly maxAmountMinor: number;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly state: CreditDecisionState;
  readonly reason: string;
  readonly conditions: string;
  readonly proposedBy: string;
  readonly proposedByName: string;
  readonly proposedAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly revokedBy: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreditDecisionEvent {
  readonly id: string;
  readonly eventType: "CREATED" | "UPDATED" | "SUBMITTED" | "APPROVED" | "REJECTED" | "REVOKED" | "EXPIRED";
  readonly actorUserId: string;
  readonly actorName: string;
  readonly occurredAt: string;
  readonly oldValues: Readonly<Record<string, unknown>>;
  readonly newValues: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
}

export interface CreditRiskAccountItem {
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly currencyCode: CurrencyCode;
  readonly accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  readonly creditLimitMinor: number | null;
  readonly assessment: CreditRiskAssessment | null;
  readonly activeRestriction: CreditRestriction | null;
  readonly activeException: CreditException | null;
}

export interface CreditRiskAccountDetails extends CreditRiskAccountItem {
  readonly assessmentHistory: readonly CreditRiskAssessment[];
  readonly restrictions: readonly CreditRestriction[];
  readonly exceptions: readonly CreditException[];
  readonly restrictionEvents: readonly CreditDecisionEvent[];
  readonly exceptionEvents: readonly CreditDecisionEvent[];
}

export interface CreditRiskReadContext {
  readonly actor: AuthenticatedUser;
}

export interface CreditRiskCommandContext extends CreditRiskReadContext {
  readonly request: RequestSecurityContext;
  readonly idempotencyKey: string;
  readonly sessionId?: string | undefined;
}

export interface CreditRiskListFilters {
  readonly currencyCode?: CurrencyCode | undefined;
  readonly riskLevel?: CreditRiskLevel | undefined;
  readonly decisionState?: CreditDecisionState | undefined;
  readonly query?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface CreditRiskPage {
  readonly items: readonly CreditRiskAccountItem[];
  readonly nextCursor: string | null;
}

export interface RecalculateCreditRiskInput {
  readonly customerAccountId: string;
}

export interface CreateCreditRestrictionInput {
  readonly customerAccountId: string;
  readonly decisionType: CreditRestrictionDecisionType;
  readonly limitAmountMinor?: number | null | undefined;
  readonly reasonCode: CreditRestrictionReasonCode;
  readonly reasonText: string;
  readonly sourceAssessmentId?: string | null | undefined;
  readonly effectiveFrom: string;
  readonly reviewDueAt?: string | null | undefined;
  readonly expiresAt?: string | null | undefined;
  readonly restorationConditions: string;
}

export interface CreateCreditExceptionInput {
  readonly restrictionId: string;
  readonly scope: CreditExceptionScope;
  readonly maxAmountMinor: number;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly reason: string;
  readonly conditions: string;
}

export interface DecisionTransitionInput {
  readonly version: number;
  readonly reason?: string | undefined;
}
