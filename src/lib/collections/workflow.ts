import { money } from "@/lib/domain/money";

import { assertCollectionTransition } from "./state-machine";
import type {
  CollectionEvidence,
  CollectionPaymentMethod,
  CollectionRecord,
  TransitionCollectionResult,
} from "./types";

export interface CreateCollectionDraftInput {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly representativeId: string;
  readonly currency: "SR" | "RG";
  readonly amountMinor: number;
  readonly paymentMethod: CollectionPaymentMethod;
  readonly collectedAt: string;
  readonly evidence?: CollectionEvidence | undefined;
  readonly createdAt: string;
  readonly createdBy: string;
}

interface TransitionContext {
  readonly actorUserId: string;
  readonly changedAt: string;
  readonly reason?: string | undefined;
}

interface ReconcileContext extends TransitionContext {
  readonly ledgerEntryId: string;
}

export function createCollectionDraft(
  input: CreateCollectionDraftInput,
): CollectionRecord {
  assertRequiredText(input.id, "id");
  assertRequiredText(input.customerId, "customerId");
  assertRequiredText(input.customerAccountId, "customerAccountId");
  assertRequiredText(input.representativeId, "representativeId");
  assertRequiredText(input.createdBy, "createdBy");
  assertIsoDateTime(input.collectedAt, "collectedAt");
  assertIsoDateTime(input.createdAt, "createdAt");

  return Object.freeze({
    id: input.id,
    customerId: input.customerId,
    customerAccountId: input.customerAccountId,
    representativeId: input.representativeId,
    amount: money(input.currency, input.amountMinor),
    paymentMethod: input.paymentMethod,
    collectedAt: input.collectedAt,
    state: "DRAFT" as const,
    evidence: normalizeEvidence(input.evidence),
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
}

export function submitCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  if (!hasEvidence(collection.evidence)) {
    throw new Error("لا يمكن إرسال التحصيل دون رقم سند أو دليل مرفق.");
  }

  return transition(collection, "SUBMITTED", context);
}

export function reviewCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  if (context.actorUserId === collection.createdBy) {
    throw new Error("منشئ التحصيل لا يجوز أن يراجعه بنفسه.");
  }

  return transition(collection, "REVIEWED", context, {
    reviewedBy: context.actorUserId,
  });
}

export function approveCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  if (!collection.reviewedBy) {
    throw new Error("لا يمكن اعتماد التحصيل قبل المراجعة.");
  }

  if (context.actorUserId === collection.createdBy) {
    throw new Error("منشئ التحصيل لا يجوز أن يعتمد تحصيله.");
  }

  return transition(collection, "APPROVED", context, {
    approvedBy: context.actorUserId,
  });
}

export function receiveCollectionFunds(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  if (context.actorUserId === collection.createdBy) {
    throw new Error("لا يجوز اعتبار منشئ التحصيل مستلمًا نهائيًا للأموال.");
  }

  return transition(collection, "CASH_RECEIVED", context, {
    cashReceivedBy: context.actorUserId,
  });
}

export function reconcileCollection(
  collection: CollectionRecord,
  context: ReconcileContext,
): TransitionCollectionResult {
  assertRequiredText(context.ledgerEntryId, "ledgerEntryId");

  return transition(collection, "RECONCILED", context, {
    ledgerEntryId: context.ledgerEntryId,
  });
}

export function closeCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  if (!collection.ledgerEntryId) {
    throw new Error("لا يمكن إغلاق التحصيل قبل ربطه بحركة دفتر مالي.");
  }

  return transition(collection, "CLOSED", context, {
    closedAt: context.changedAt,
  });
}

export function returnCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  assertReason(context.reason);
  return transition(collection, "RETURNED", context);
}

export function flagCollectionConflict(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  assertReason(context.reason);
  return transition(collection, "CONFLICTED", context);
}

export function rejectCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  assertReason(context.reason);
  return transition(collection, "REJECTED", context);
}

export function reverseCollection(
  collection: CollectionRecord,
  context: TransitionContext,
): TransitionCollectionResult {
  assertReason(context.reason);

  return transition(collection, "REVERSED", context, {
    reversedAt: context.changedAt,
    reversalReason: context.reason?.trim(),
  });
}

function transition(
  collection: CollectionRecord,
  toState: CollectionRecord["state"],
  context: TransitionContext,
  updates: Partial<CollectionRecord> = {},
): TransitionCollectionResult {
  assertRequiredText(context.actorUserId, "actorUserId");
  assertIsoDateTime(context.changedAt, "changedAt");
  assertCollectionTransition(collection.state, toState);

  return Object.freeze({
    collection: Object.freeze({
      ...collection,
      ...updates,
      state: toState,
    }),
    event: Object.freeze({
      collectionId: collection.id,
      fromState: collection.state,
      toState,
      changedAt: context.changedAt,
      changedBy: context.actorUserId,
      reason: context.reason?.trim(),
    }),
  });
}

function normalizeEvidence(
  evidence: CollectionEvidence | undefined,
): CollectionEvidence {
  return Object.freeze({
    receiptNumber: normalizeOptionalText(evidence?.receiptNumber),
    evidenceDocumentId: normalizeOptionalText(evidence?.evidenceDocumentId),
    note: normalizeOptionalText(evidence?.note),
  });
}

function hasEvidence(evidence: CollectionEvidence): boolean {
  return Boolean(evidence.receiptNumber || evidence.evidenceDocumentId);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function assertReason(reason: string | undefined): void {
  if (!reason?.trim()) {
    throw new Error("سبب الانتقال إلزامي لهذه الحالة.");
  }
}

function assertRequiredText(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new Error(`الحقل ${fieldName} إلزامي.`);
  }
}

function assertIsoDateTime(value: string, fieldName: string): void {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`الحقل ${fieldName} يجب أن يكون تاريخًا ووقتًا صالحين.`);
  }
}
