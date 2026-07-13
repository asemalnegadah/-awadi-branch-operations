import { money, type Money } from "@/lib/domain/money";
import type { CurrencyCode } from "@/lib/domain/currency";

import type {
  CreatePostedLedgerEntryInput,
  CreateReversalInput,
  PostedLedgerEntry,
} from "./types";

export function createPostedLedgerEntry(
  input: CreatePostedLedgerEntryInput,
): PostedLedgerEntry {
  assertPositiveAmount(input.amount);
  assertRequiredText(input.sourceType, "sourceType");
  assertRequiredText(input.sourceId, "sourceId");
  assertRequiredText(input.idempotencyKey, "idempotencyKey");

  return Object.freeze({ ...input });
}

export function calculateLedgerBalance(
  entries: readonly PostedLedgerEntry[],
  currency: CurrencyCode,
): Money {
  const totalMinorUnits = entries.reduce((total, entry) => {
    if (entry.amount.currency !== currency) {
      throw new Error(
        `لا يمكن حساب رصيد ${currency} باستخدام حركة ${entry.amount.currency}.`,
      );
    }

    return total + signedMinorUnits(entry);
  }, 0);

  return money(currency, totalMinorUnits);
}

export function createReversalEntry({
  original,
  reason,
  ...input
}: CreateReversalInput): PostedLedgerEntry {
  assertRequiredText(reason, "reason");

  if (original.entryType === "REVERSAL" || original.reversalOfEntryId) {
    throw new Error("لا يمكن عكس حركة عكسية مباشرة.");
  }

  return Object.freeze({
    ...input,
    customerId: original.customerId,
    customerAccountId: original.customerAccountId,
    amount: original.amount,
    direction: oppositeDirection(original.direction),
    entryType: "REVERSAL" as const,
    accountingDate: input.postedAt.slice(0, 10),
    description: reason.trim(),
    reversalOfEntryId: original.id,
  });
}

export function validateAllocationTotal(
  available: Money,
  allocations: readonly Money[],
): Money {
  assertPositiveAmount(available);

  const allocatedMinorUnits = allocations.reduce((total, allocation) => {
    assertPositiveAmount(allocation);

    if (allocation.currency !== available.currency) {
      throw new Error("لا يمكن تخصيص مبلغ بعملة مختلفة عن أصل العملية.");
    }

    return total + allocation.minorUnits;
  }, 0);

  if (allocatedMinorUnits > available.minorUnits) {
    throw new Error("إجمالي التخصيصات يتجاوز المبلغ المتاح.");
  }

  return money(available.currency, allocatedMinorUnits);
}

function signedMinorUnits(entry: PostedLedgerEntry): number {
  return entry.direction === "DEBIT"
    ? entry.amount.minorUnits
    : -entry.amount.minorUnits;
}

function oppositeDirection(
  direction: PostedLedgerEntry["direction"],
): PostedLedgerEntry["direction"] {
  return direction === "DEBIT" ? "CREDIT" : "DEBIT";
}

function assertPositiveAmount(value: Money): void {
  if (!Number.isSafeInteger(value.minorUnits) || value.minorUnits <= 0) {
    throw new Error("يجب أن يكون المبلغ عددًا صحيحًا موجبًا بالوحدة الصغرى.");
  }
}

function assertRequiredText(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`الحقل ${fieldName} إلزامي.`);
  }
}
