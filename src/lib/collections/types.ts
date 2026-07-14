import type { Money } from "@/lib/domain/money";

import type { CollectionState } from "./state-machine";

export const collectionPaymentMethods = [
  "CASH",
  "BANK_TRANSFER",
  "CHECK",
  "OTHER",
] as const;

export type CollectionPaymentMethod =
  (typeof collectionPaymentMethods)[number];

export interface CollectionEvidence {
  readonly receiptNumber?: string | undefined;
  readonly evidenceDocumentId?: string | undefined;
  readonly note?: string | undefined;
}

export interface CollectionRecord {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly representativeId: string;
  readonly amount: Money;
  readonly paymentMethod: CollectionPaymentMethod;
  readonly collectedAt: string;
  readonly state: CollectionState;
  readonly evidence: CollectionEvidence;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly reviewedBy?: string | undefined;
  readonly approvedBy?: string | undefined;
  readonly cashReceivedBy?: string | undefined;
  readonly ledgerEntryId?: string | undefined;
  readonly closedAt?: string | undefined;
  readonly reversedAt?: string | undefined;
  readonly reversalReason?: string | undefined;
}

export interface CollectionTransitionEvent {
  readonly collectionId: string;
  readonly fromState: CollectionState;
  readonly toState: CollectionState;
  readonly changedAt: string;
  readonly changedBy: string;
  readonly reason?: string | undefined;
}

export interface TransitionCollectionResult {
  readonly collection: CollectionRecord;
  readonly event: CollectionTransitionEvent;
}
