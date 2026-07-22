import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import type { CurrencyCode } from "@/lib/domain/currency";

export const reconciliationStates = [
  "DRAFT",
  "PENDING_REVIEW",
  "REVIEWED",
  "PENDING_APPROVAL",
  "APPROVED",
  "RETURNED",
  "REJECTED",
  "MATCHED",
  "SETTLED",
] as const;
export type ReconciliationState = (typeof reconciliationStates)[number];

export const reconciliationSourceKinds = [
  "LEDGER_TO_STATEMENT",
  "COLLECTION_TO_LEDGER",
  "IMPORT_TO_LEDGER",
  "CUSTODY_TO_COLLECTION",
] as const;
export type ReconciliationSourceKind = (typeof reconciliationSourceKinds)[number];

export const reconciliationReasonCodes = [
  "TIMING_DIFFERENCE",
  "MISSING_COLLECTION",
  "UNPOSTED_INVOICE",
  "DUPLICATE_ENTRY",
  "WRONG_ACCOUNT",
  "WRONG_CURRENCY",
  "WRONG_AMOUNT",
  "UNALLOCATED_COLLECTION",
  "IMPORT_VARIANCE",
  "CUSTODY_VARIANCE",
  "MANUAL_ERROR",
  "OTHER",
] as const;
export type ReconciliationReasonCode = (typeof reconciliationReasonCodes)[number];

export interface ReconciliationRecord {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly currencyCode: CurrencyCode;
  readonly sourceKind: ReconciliationSourceKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly cutoffDate: string;
  readonly expectedAmountMinor: number;
  readonly observedAmountMinor: number;
  readonly differenceAmountMinor: number;
  readonly reasonCode: ReconciliationReasonCode | null;
  readonly reasonText: string | null;
  readonly state: ReconciliationState;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly returnedBy: string | null;
  readonly returnedAt: string | null;
  readonly returnReason: string | null;
  readonly settledBy: string | null;
  readonly settledAt: string | null;
  readonly settlementLedgerEntryId: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ReconciliationEvent {
  readonly id: string;
  readonly eventType:
    | "CREATED"
    | "SUBMITTED"
    | "REVIEWED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "RETURNED"
    | "REJECTED"
    | "MATCHED"
    | "SETTLED";
  readonly fromState: ReconciliationState | null;
  readonly toState: ReconciliationState;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly operatingMode: "SINGLE_MANAGER" | "MULTI_USER";
  readonly selfApproved: boolean;
}

export interface ReconciliationDetails extends ReconciliationRecord {
  readonly events: readonly ReconciliationEvent[];
}

export interface ReconciliationReadContext {
  readonly actor: AuthenticatedUser;
}

export interface ReconciliationCommandContext extends ReconciliationReadContext {
  readonly request: RequestSecurityContext;
  readonly idempotencyKey: string;
  readonly sessionId?: string | undefined;
}

export interface CreateReconciliationInput {
  readonly customerAccountId: string;
  readonly sourceKind: ReconciliationSourceKind;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly cutoffDate: string;
  readonly expectedAmountMinor: number;
  readonly observedAmountMinor: number;
  readonly reasonCode?: ReconciliationReasonCode | null | undefined;
  readonly reasonText?: string | null | undefined;
}

export interface ReconciliationTransitionInput {
  readonly version: number;
  readonly reason?: string | undefined;
  readonly reasonCode?: ReconciliationReasonCode | undefined;
  readonly reasonText?: string | undefined;
}

export interface ReconciliationListFilters {
  readonly currencyCode?: CurrencyCode | undefined;
  readonly state?: ReconciliationState | undefined;
  readonly query?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ReconciliationPage {
  readonly items: readonly ReconciliationRecord[];
  readonly nextCursor: string | null;
}

export interface ReconciliationMutationResult {
  readonly reconciliation: ReconciliationRecord;
  readonly replayed: boolean;
}
