import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import type { CurrencyCode } from "@/lib/domain/currency";

export const cashClosingStates = [
  "DRAFT",
  "PENDING_REVIEW",
  "REVIEWED",
  "PENDING_APPROVAL",
  "APPROVED",
  "RETURNED",
  "REJECTED",
] as const;

export type CashClosingState = (typeof cashClosingStates)[number];

export interface CashCustodySummary {
  readonly representativeId: string;
  readonly representativeName: string;
  readonly currencyCode: CurrencyCode;
  readonly balanceMinor: number;
  readonly lastEventAt: string | null;
}

export interface CashHandoverRecord {
  readonly id: string;
  readonly representativeId: string;
  readonly representativeName: string;
  readonly currencyCode: CurrencyCode;
  readonly amountMinor: number;
  readonly handedOverAt: string;
  readonly receivedBy: string;
  readonly receivedByName: string;
  readonly reference: string;
  readonly note: string | null;
  readonly custodyEventId: string;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
}

export interface CashClosingRecord {
  readonly id: string;
  readonly representativeId: string;
  readonly representativeName: string;
  readonly businessDate: string;
  readonly currencyCode: CurrencyCode;
  readonly openingBalanceMinor: number;
  readonly collectionsInMinor: number;
  readonly reversalsInMinor: number;
  readonly handoversOutMinor: number;
  readonly reversalsOutMinor: number;
  readonly expectedCashMinor: number;
  readonly declaredCashMinor: number;
  readonly varianceMinor: number;
  readonly varianceReason: string | null;
  readonly snapshotRevision: number;
  readonly snapshotAt: string | null;
  readonly state: CashClosingState;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly returnedBy: string | null;
  readonly returnedAt: string | null;
  readonly returnReason: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface CashClosingEvent {
  readonly id: string;
  readonly eventType:
    | "CREATED"
    | "REVISED"
    | "SUBMITTED"
    | "REVIEWED"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "RETURNED"
    | "REJECTED";
  readonly fromState: CashClosingState | null;
  readonly toState: CashClosingState;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly operatingMode: "SINGLE_MANAGER" | "MULTI_USER";
  readonly selfApproved: boolean;
  readonly snapshotRevision: number;
}

export interface CashClosingSnapshotItem {
  readonly id: string;
  readonly snapshotRevision: number;
  readonly custodyEventId: string;
  readonly eventType: "COLLECTION_IN" | "HANDOVER_OUT" | "REVERSAL";
  readonly direction: "IN" | "OUT";
  readonly amountMinor: number;
  readonly occurredAt: string;
}

export interface CashClosingDetails extends CashClosingRecord {
  readonly events: readonly CashClosingEvent[];
  readonly snapshotItems: readonly CashClosingSnapshotItem[];
}

export interface CashClosingReadContext {
  readonly actor: AuthenticatedUser;
}

export interface CashClosingCommandContext extends CashClosingReadContext {
  readonly request: RequestSecurityContext;
  readonly idempotencyKey: string;
  readonly sessionId?: string | undefined;
}

export interface CreateCashHandoverInput {
  readonly representativeId: string;
  readonly currencyCode: CurrencyCode;
  readonly amountMinor: number;
  readonly handedOverAt: string;
  readonly receivedBy: string;
  readonly reference: string;
  readonly note?: string | null | undefined;
}

export interface CreateCashClosingInput {
  readonly representativeId: string;
  readonly businessDate: string;
  readonly currencyCode: CurrencyCode;
  readonly declaredCashMinor: number;
  readonly varianceReason?: string | null | undefined;
}

export interface ReviseCashClosingInput {
  readonly version: number;
  readonly declaredCashMinor: number;
  readonly varianceReason?: string | null | undefined;
}

export interface CashClosingTransitionInput {
  readonly version: number;
  readonly reason?: string | undefined;
}

export interface CashClosingListFilters {
  readonly representativeId?: string | undefined;
  readonly currencyCode?: CurrencyCode | undefined;
  readonly state?: CashClosingState | undefined;
  readonly businessDate?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface CashClosingPage {
  readonly items: readonly CashClosingRecord[];
  readonly nextCursor: string | null;
}

export interface CashClosingMutationResult {
  readonly closing: CashClosingRecord;
  readonly replayed: boolean;
}
