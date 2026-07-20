import type { AuthenticatedUser, RequestSecurityContext } from "@/lib/auth/types";
import type { CurrencyCode } from "@/lib/domain/currency";

export const promiseBaseStatuses = [
  "NEW",
  "UPCOMING",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "REJECTED",
  "CANCELLED",
] as const;

export type PromiseBaseStatus = (typeof promiseBaseStatuses)[number];

export const promiseTemporalStatuses = ["DUE_TODAY", "OVERDUE"] as const;
export type PromiseTemporalStatus = (typeof promiseTemporalStatuses)[number];

export const promiseEventTypes = [
  "CREATED",
  "UPDATED",
  "FOLLOW_UP_ADDED",
  "ASSIGNED",
  "DUE_DATE_CHANGED",
  "AMOUNT_CHANGED",
  "COLLECTION_ALLOCATED",
  "COLLECTION_REVERSED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "REJECTED",
  "CANCELLED",
  "ESCALATED",
  "REOPENED",
] as const;

export type PromiseEventType = (typeof promiseEventTypes)[number];

export interface PaymentPromise {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly representativeId: string;
  readonly representativeName: string;
  readonly currencyCode: CurrencyCode;
  readonly promisedAmountMinor: number;
  readonly fulfilledAmountMinor: number;
  readonly remainingAmountMinor: number;
  readonly promiseDate: string;
  readonly dueDate: string;
  readonly nextFollowUpAt: string | null;
  readonly debtReason: string;
  readonly delayReason: string | null;
  readonly notes: string | null;
  readonly baseStatus: PromiseBaseStatus;
  readonly temporalStatus: PromiseTemporalStatus | null;
  readonly escalationLevel: number;
  readonly rejectedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectionReason: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
  readonly cancellationReason: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PaymentPromiseEvent {
  readonly id: string;
  readonly promiseId: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly occurredAt: string;
  readonly requestId: string;
  readonly eventType: PromiseEventType;
  readonly oldValues: Readonly<Record<string, unknown>>;
  readonly newValues: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
  readonly sourceEntity: string | null;
  readonly sourceId: string | null;
}

export interface PaymentPromiseFollowUp {
  readonly id: string;
  readonly promiseId: string;
  readonly scheduledAt: string;
  readonly completedAt: string | null;
  readonly outcome: string | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
}

export interface PaymentPromiseAllocation {
  readonly id: string;
  readonly promiseId: string;
  readonly collectionId: string;
  readonly currencyCode: CurrencyCode;
  readonly amountMinor: number;
  readonly allocatedAt: string;
  readonly allocatedBy: string;
  readonly allocatedByName: string;
  readonly reversedAt: string | null;
  readonly reversedBy: string | null;
  readonly reversalReason: string | null;
}

export interface PaymentPromiseDetails {
  readonly promise: PaymentPromise;
  readonly events: readonly PaymentPromiseEvent[];
  readonly followUps: readonly PaymentPromiseFollowUp[];
  readonly allocations: readonly PaymentPromiseAllocation[];
}

export interface PromiseCommandContext {
  readonly actor: AuthenticatedUser;
  readonly request: RequestSecurityContext;
  readonly idempotencyKey: string;
  readonly sessionId?: string | undefined;
}

export interface PromiseReadContext {
  readonly actor: AuthenticatedUser;
}

export interface CreatePromiseInput {
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly representativeId: string;
  readonly currencyCode: CurrencyCode;
  readonly promisedAmountMinor: number;
  readonly promiseDate: string;
  readonly dueDate: string;
  readonly nextFollowUpAt?: string | null | undefined;
  readonly debtReason: string;
  readonly delayReason?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface UpdatePromiseInput {
  readonly version: number;
  readonly representativeId?: string | undefined;
  readonly promisedAmountMinor?: number | undefined;
  readonly promiseDate?: string | undefined;
  readonly dueDate?: string | undefined;
  readonly nextFollowUpAt?: string | null | undefined;
  readonly debtReason?: string | undefined;
  readonly delayReason?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface AddFollowUpInput {
  readonly scheduledAt: string;
  readonly completedAt?: string | null | undefined;
  readonly outcome?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

export interface RejectPromiseInput {
  readonly version: number;
  readonly reason: string;
}

export interface CancelPromiseInput {
  readonly version: number;
  readonly reason: string;
}

export interface EscalatePromiseInput {
  readonly version: number;
  readonly level: number;
  readonly reason: string;
}

export interface AllocateCollectionInput {
  readonly collectionId: string;
  readonly amountMinor: number;
}

export interface ReverseAllocationInput {
  readonly reason: string;
}

export interface PromiseListFilters {
  readonly dueDateFrom?: string | undefined;
  readonly dueDateTo?: string | undefined;
  readonly customerId?: string | undefined;
  readonly representativeId?: string | undefined;
  readonly currencyCode?: CurrencyCode | undefined;
  readonly baseStatus?: PromiseBaseStatus | undefined;
  readonly temporalStatus?: PromiseTemporalStatus | undefined;
  readonly escalationLevel?: number | undefined;
  readonly partiallyFulfilled?: boolean | undefined;
  readonly fulfilled?: boolean | undefined;
  readonly query?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface PromisePage {
  readonly items: readonly PaymentPromise[];
  readonly nextCursor: string | null;
}

export interface CurrencyPromiseSummary {
  readonly currencyCode: CurrencyCode;
  readonly promiseCount: number;
  readonly promisedAmountMinor: number;
  readonly fulfilledAmountMinor: number;
  readonly remainingAmountMinor: number;
  readonly dueTodayCount: number;
  readonly overdueCount: number;
  readonly partiallyFulfilledCount: number;
  readonly fulfilledCount: number;
}

export interface CustomerPromiseSummary {
  readonly customerId: string;
  readonly customerName: string;
  readonly currencies: readonly CurrencyPromiseSummary[];
}

export interface SalespersonPromiseSummary {
  readonly representativeId: string;
  readonly representativeName: string;
  readonly currencies: readonly CurrencyPromiseSummary[];
}

export interface PromiseFormAccountOption {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly currencyCode: CurrencyCode;
}

export interface PromiseFormRepresentativeOption {
  readonly id: string;
  readonly name: string;
}

export interface PromiseFormOptions {
  readonly accounts: readonly PromiseFormAccountOption[];
  readonly representatives: readonly PromiseFormRepresentativeOption[];
}

export interface ConfirmedCollectionOption {
  readonly id: string;
  readonly receiptNumber: string | null;
  readonly collectedAt: string;
  readonly amountMinor: number;
  readonly availableAmountMinor: number;
  readonly currencyCode: CurrencyCode;
}
