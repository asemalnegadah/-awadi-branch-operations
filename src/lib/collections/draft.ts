import { money } from "@/lib/domain/money";

import type {
  CollectionEvidence,
  CollectionPaymentMethod,
  CollectionRecord,
} from "./types";

export interface UpdateCollectionDraftInput {
  readonly customerId?: string;
  readonly customerAccountId?: string;
  readonly representativeId?: string;
  readonly currency?: "SR" | "RG";
  readonly amountMinor?: number;
  readonly paymentMethod?: CollectionPaymentMethod;
  readonly collectedAt?: string;
  readonly evidence?: CollectionEvidence;
}

export function updateCollectionDraft(
  collection: CollectionRecord,
  updates: UpdateCollectionDraftInput,
): CollectionRecord {
  if (collection.state !== "DRAFT") {
    throw new Error("لا يمكن تعديل التحصيل بعد إرساله للمراجعة.");
  }

  const amount =
    updates.currency !== undefined || updates.amountMinor !== undefined
      ? money(
          updates.currency ?? collection.amount.currency,
          updates.amountMinor ?? collection.amount.minorUnits,
        )
      : collection.amount;

  if (amount.minorUnits <= 0) {
    throw new Error("يجب أن يكون مبلغ التحصيل موجبًا.");
  }

  return Object.freeze({
    ...collection,
    customerId: normalizeRequired(updates.customerId, collection.customerId),
    customerAccountId: normalizeRequired(
      updates.customerAccountId,
      collection.customerAccountId,
    ),
    representativeId: normalizeRequired(
      updates.representativeId,
      collection.representativeId,
    ),
    amount,
    paymentMethod: updates.paymentMethod ?? collection.paymentMethod,
    collectedAt: normalizeDateTime(updates.collectedAt, collection.collectedAt),
    evidence: updates.evidence
      ? Object.freeze({
          receiptNumber: normalizeOptional(updates.evidence.receiptNumber),
          evidenceDocumentId: normalizeOptional(
            updates.evidence.evidenceDocumentId,
          ),
          note: normalizeOptional(updates.evidence.note),
        })
      : collection.evidence,
  });
}

function normalizeRequired(value: string | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error("لا يمكن تفريغ حقل إلزامي في مسودة التحصيل.");
  }

  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeDateTime(value: string | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new Error("تاريخ التحصيل غير صالح.");
  }

  return value;
}
