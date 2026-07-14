import { money, type Money } from "@/lib/domain/money";
import type { CurrencyCode } from "@/lib/domain/currency";
import type { CollectionRecord } from "@/lib/collections/types";

import type { CashCustodyEvent } from "./types";

interface CommonCustodyEventInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly idempotencyKey: string;
}

interface CreateCollectionCustodyEventInput extends CommonCustodyEventInput {
  readonly collection: CollectionRecord;
}

interface CreateCashHandoverEventInput extends CommonCustodyEventInput {
  readonly representativeId: string;
  readonly amount: Money;
  readonly availableBalance: Money;
  readonly receivedBy: string;
  readonly handoverReference: string;
}

interface CreateCustodyReversalInput extends CommonCustodyEventInput {
  readonly original: CashCustodyEvent;
  readonly reason: string;
}

export function createCollectionCustodyEvent({
  collection,
  ...input
}: CreateCollectionCustodyEventInput): CashCustodyEvent {
  assertCommonInput(input);

  if (collection.paymentMethod !== "CASH") {
    throw new Error("عهدة المندوب النقدية تقبل التحصيلات النقدية فقط.");
  }

  if (collection.state !== "APPROVED") {
    throw new Error("لا تسجل عهدة التحصيل قبل اعتماده.");
  }

  assertPositiveAmount(collection.amount);

  return Object.freeze({
    ...input,
    representativeId: collection.representativeId,
    amount: collection.amount,
    direction: "IN" as const,
    eventType: "COLLECTION_IN" as const,
    sourceType: "COLLECTION",
    sourceId: collection.id,
  });
}

export function createCashHandoverEvent({
  representativeId,
  amount,
  availableBalance,
  receivedBy,
  handoverReference,
  ...input
}: CreateCashHandoverEventInput): CashCustodyEvent {
  assertCommonInput(input);
  assertRequiredText(representativeId, "representativeId");
  assertRequiredText(receivedBy, "receivedBy");
  assertRequiredText(handoverReference, "handoverReference");
  assertPositiveAmount(amount);

  if (amount.currency !== availableBalance.currency) {
    throw new Error("عملة التسليم لا تطابق عملة رصيد العهدة.");
  }

  if (amount.minorUnits > availableBalance.minorUnits) {
    throw new Error("مبلغ التسليم يتجاوز رصيد عهدة المندوب.");
  }

  return Object.freeze({
    ...input,
    representativeId,
    amount,
    direction: "OUT" as const,
    eventType: "HANDOVER_OUT" as const,
    sourceType: "CASH_HANDOVER",
    sourceId: handoverReference.trim(),
    receivedBy: receivedBy.trim(),
  });
}

export function createCustodyReversalEvent({
  original,
  reason,
  ...input
}: CreateCustodyReversalInput): CashCustodyEvent {
  assertCommonInput(input);
  assertRequiredText(reason, "reason");

  if (original.eventType === "REVERSAL" || original.reversalOfEventId) {
    throw new Error("لا يمكن عكس حركة عهدة عكسية مباشرة.");
  }

  return Object.freeze({
    ...input,
    representativeId: original.representativeId,
    amount: original.amount,
    direction: original.direction === "IN" ? ("OUT" as const) : ("IN" as const),
    eventType: "REVERSAL" as const,
    sourceType: "CUSTODY_REVERSAL",
    sourceId: original.id,
    reason: reason.trim(),
    reversalOfEventId: original.id,
  });
}

export function calculateCustodyBalance(
  events: readonly CashCustodyEvent[],
  representativeId: string,
  currency: CurrencyCode,
): Money {
  assertRequiredText(representativeId, "representativeId");

  const minorUnits = events.reduce((total, event) => {
    if (event.representativeId !== representativeId) {
      throw new Error("لا يمكن حساب عهدة مندوب باستخدام حركة مندوب آخر.");
    }

    if (event.amount.currency !== currency) {
      throw new Error(
        `لا يمكن حساب عهدة ${currency} باستخدام حركة ${event.amount.currency}.`,
      );
    }

    return total +
      (event.direction === "IN"
        ? event.amount.minorUnits
        : -event.amount.minorUnits);
  }, 0);

  if (minorUnits < 0) {
    throw new Error("رصيد عهدة المندوب أصبح سالبًا؛ توجد حركة غير متوازنة.");
  }

  return money(currency, minorUnits);
}

function assertCommonInput(input: CommonCustodyEventInput): void {
  assertRequiredText(input.id, "id");
  assertRequiredText(input.recordedBy, "recordedBy");
  assertRequiredText(input.idempotencyKey, "idempotencyKey");
  assertIsoDateTime(input.occurredAt, "occurredAt");
  assertIsoDateTime(input.recordedAt, "recordedAt");
}

function assertPositiveAmount(value: Money): void {
  if (!Number.isSafeInteger(value.minorUnits) || value.minorUnits <= 0) {
    throw new Error("يجب أن يكون مبلغ العهدة عددًا صحيحًا موجبًا.");
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
