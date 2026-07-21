import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import type { CurrencyCode } from "@/lib/domain/currency";

export const fieldVisitStates = [
  "DRAFT",
  "CHECKED_IN",
  "CHECKED_OUT",
  "SUBMITTED",
  "VERIFIED",
  "RETURNED",
  "CANCELLED",
] as const;
export type FieldVisitState = (typeof fieldVisitStates)[number];

export const fieldVisitTypes = [
  "COLLECTION",
  "SALES",
  "PROMISE_FOLLOWUP",
  "RECONCILIATION",
  "DATA_UPDATE",
  "PROBLEM_RESOLUTION",
  "MIXED",
] as const;
export type FieldVisitType = (typeof fieldVisitTypes)[number];

export const fieldVisitResults = ["SUCCESS", "PARTIAL", "FAILED", "NO_CONTACT"] as const;
export type FieldVisitResult = (typeof fieldVisitResults)[number];

export const fieldVisitOutcomeTypes = [
  "COLLECTION",
  "SALES_ORDER",
  "PAYMENT_PROMISE",
  "RECONCILIATION",
  "CUSTOMER_DATA_UPDATE",
  "PROBLEM_RESOLUTION",
  "NO_RESULT",
] as const;
export type FieldVisitOutcomeType = (typeof fieldVisitOutcomeTypes)[number];

export const dailyPlanItemResultTypes = [
  "VISITED_SUCCESS",
  "VISITED_PARTIAL",
  "VISITED_FAILED",
  "CUSTOMER_ABSENT",
  "REFUSED",
  "CLOSED",
  "NOT_FOUND",
  "RESCHEDULED",
  "SKIPPED",
  "OTHER",
] as const;
export type DailyPlanItemResultType = (typeof dailyPlanItemResultTypes)[number];

export interface FieldVisit {
  readonly id: string;
  readonly representativeId: string;
  readonly representativeName: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly planId: string | null;
  readonly planItemId: string | null;
  readonly visitSource: "PLAN" | "OUT_OF_PLAN";
  readonly state: FieldVisitState;
  readonly visitType: FieldVisitType;
  readonly objective: string;
  readonly declaredResult: FieldVisitResult | null;
  readonly outcomeSummary: string | null;
  readonly arrivedAt: string | null;
  readonly departedAt: string | null;
  readonly deviceArrivedAt: string | null;
  readonly deviceDepartedAt: string | null;
  readonly checkinLatitude: number | null;
  readonly checkinLongitude: number | null;
  readonly checkinAccuracyMeters: number | null;
  readonly checkoutLatitude: number | null;
  readonly checkoutLongitude: number | null;
  readonly checkoutAccuracyMeters: number | null;
  readonly syncStatus: "ONLINE" | "PENDING_UPLOAD" | "SYNCED" | "CONFLICT";
  readonly syncReceivedAt: string | null;
  readonly outOfPlanReason: string | null;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly version: number;
  readonly updatedAt: string;
  readonly outcomeCount: number;
  readonly qualifyingOutcomeCount: number;
  readonly evidenceCount: number;
}

export interface FieldVisitOutcome {
  readonly id: string;
  readonly visitId: string;
  readonly outcomeType: FieldVisitOutcomeType;
  readonly collectionId: string | null;
  readonly promiseId: string | null;
  readonly referenceId: string | null;
  readonly currencyCode: CurrencyCode | null;
  readonly amountMinor: number | null;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly qualifiesSuccess: boolean;
  readonly recordedBy: string;
  readonly recordedByName: string;
  readonly recordedAt: string;
}

export interface FieldVisitEvidence {
  readonly id: string;
  readonly visitId: string;
  readonly uploadedFileId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly evidenceType:
    | "RECEIPT"
    | "CUSTOMER_LOCATION"
    | "SHOP_FRONT"
    | "DOCUMENT"
    | "SIGNATURE"
    | "OTHER";
  readonly caption: string | null;
  readonly recordedBy: string;
  readonly recordedByName: string;
  readonly recordedAt: string;
}

export interface FieldVisitEvent {
  readonly id: string;
  readonly visitId: string;
  readonly eventType:
    | "CREATED"
    | "CHECKED_IN"
    | "CHECKED_OUT"
    | "OUTCOME_ADDED"
    | "EVIDENCE_ADDED"
    | "SUBMITTED"
    | "RETURNED"
    | "VERIFIED"
    | "CANCELLED";
  readonly actorUserId: string;
  readonly actorName: string;
  readonly occurredAt: string;
  readonly oldValues: Readonly<Record<string, unknown>>;
  readonly newValues: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
}

export interface DailyPlanItemExecutionResult {
  readonly id: string;
  readonly planItemId: string;
  readonly visitId: string | null;
  readonly resultType: DailyPlanItemResultType;
  readonly reason: string;
  readonly nextActionAt: string | null;
  readonly recordedBy: string;
  readonly recordedByName: string;
  readonly recordedAt: string;
  readonly supersedesResultId: string | null;
}

export interface FieldVisitDetails {
  readonly visit: FieldVisit;
  readonly outcomes: readonly FieldVisitOutcome[];
  readonly evidence: readonly FieldVisitEvidence[];
  readonly events: readonly FieldVisitEvent[];
  readonly planItemResult: DailyPlanItemExecutionResult | null;
}

export interface FieldVisitReadContext {
  readonly actor: AuthenticatedUser;
}

export interface FieldVisitCommandContext extends FieldVisitReadContext {
  readonly request: RequestSecurityContext;
  readonly idempotencyKey: string;
  readonly sessionId?: string | undefined;
}

export interface CreateFieldVisitInput {
  readonly customerId: string;
  readonly planId?: string | null | undefined;
  readonly planItemId?: string | null | undefined;
  readonly visitType: FieldVisitType;
  readonly objective: string;
  readonly outOfPlanReason?: string | null | undefined;
}

export interface FieldVisitLocationInput {
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
  readonly accuracyMeters?: number | null | undefined;
  readonly deviceAt?: string | null | undefined;
  readonly syncStatus?: "ONLINE" | "PENDING_UPLOAD" | "SYNCED" | "CONFLICT" | undefined;
}

export interface SubmitFieldVisitInput {
  readonly version: number;
  readonly result: FieldVisitResult;
  readonly summary: string;
}

export interface FieldVisitTransitionInput {
  readonly version: number;
  readonly reason?: string | undefined;
}

export interface AddFieldVisitOutcomeInput {
  readonly outcomeType: FieldVisitOutcomeType;
  readonly collectionId?: string | null | undefined;
  readonly promiseId?: string | null | undefined;
  readonly referenceId?: string | null | undefined;
  readonly currencyCode?: CurrencyCode | null | undefined;
  readonly amountMinor?: number | null | undefined;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface AddFieldVisitEvidenceInput {
  readonly uploadedFileId: string;
  readonly evidenceType: FieldVisitEvidence["evidenceType"];
  readonly caption?: string | null | undefined;
}

export interface RecordPlanItemResultInput {
  readonly planItemId: string;
  readonly visitId?: string | null | undefined;
  readonly resultType: DailyPlanItemResultType;
  readonly reason: string;
  readonly nextActionAt?: string | null | undefined;
  readonly supersedesResultId?: string | null | undefined;
}

export interface FieldVisitListFilters {
  readonly representativeId?: string | undefined;
  readonly customerId?: string | undefined;
  readonly state?: FieldVisitState | undefined;
  readonly visitDateFrom?: string | undefined;
  readonly visitDateTo?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface FieldVisitPage {
  readonly items: readonly FieldVisit[];
  readonly nextCursor: string | null;
}
