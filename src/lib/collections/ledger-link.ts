import { createPostedLedgerEntry } from "@/lib/ledger/ledger";
import type { PostedLedgerEntry } from "@/lib/ledger/types";

import { reconcileCollection } from "./workflow";
import type { CollectionRecord, TransitionCollectionResult } from "./types";

export interface CreateCollectionLedgerEntryInput {
  readonly id: string;
  readonly collection: CollectionRecord;
  readonly postedAt: string;
  readonly postedBy: string;
  readonly idempotencyKey: string;
}

export function createCollectionLedgerEntry({
  id,
  collection,
  postedAt,
  postedBy,
  idempotencyKey,
}: CreateCollectionLedgerEntryInput): PostedLedgerEntry {
  if (collection.state !== "CASH_RECEIVED") {
    throw new Error("لا يمكن ترحيل التحصيل للدفتر قبل استلام الأموال.");
  }

  return createPostedLedgerEntry({
    id,
    customerId: collection.customerId,
    customerAccountId: collection.customerAccountId,
    amount: collection.amount,
    direction: "CREDIT",
    entryType: "COLLECTION",
    accountingDate: postedAt.slice(0, 10),
    postedAt,
    postedBy,
    sourceType: "COLLECTION",
    sourceId: collection.id,
    idempotencyKey,
    description: `تحصيل العميل ${collection.customerId}`,
  });
}

export function reconcileCollectionWithLedger(
  collection: CollectionRecord,
  ledgerEntry: PostedLedgerEntry,
  actorUserId: string,
  changedAt: string,
): TransitionCollectionResult {
  if (ledgerEntry.entryType !== "COLLECTION") {
    throw new Error("حركة الدفتر المرتبطة ليست حركة تحصيل.");
  }

  if (
    ledgerEntry.sourceType !== "COLLECTION" ||
    ledgerEntry.sourceId !== collection.id
  ) {
    throw new Error("حركة الدفتر لا تشير إلى التحصيل المطلوب.");
  }

  if (
    ledgerEntry.customerId !== collection.customerId ||
    ledgerEntry.customerAccountId !== collection.customerAccountId
  ) {
    throw new Error("العميل أو حساب العميل لا يطابق حركة التحصيل.");
  }

  if (
    ledgerEntry.amount.currency !== collection.amount.currency ||
    ledgerEntry.amount.minorUnits !== collection.amount.minorUnits ||
    ledgerEntry.direction !== "CREDIT"
  ) {
    throw new Error("مبلغ أو عملة أو اتجاه حركة الدفتر لا يطابق التحصيل.");
  }

  return reconcileCollection(collection, {
    actorUserId,
    changedAt,
    ledgerEntryId: ledgerEntry.id,
  });
}
