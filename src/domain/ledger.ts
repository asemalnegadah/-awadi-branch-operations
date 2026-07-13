import type { CurrencyCode } from "@/domain/currency";
import type { Money } from "@/domain/money";
import { money } from "@/domain/money";

export const LEDGER_ENTRY_TYPES = [
  "OPENING_BALANCE",
  "INVOICE",
  "COLLECTION",
  "CREDIT_NOTE",
  "RETURN",
  "DISCOUNT",
  "RECONCILIATION_ADJUSTMENT",
  "REVERSAL",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
export type LedgerDirection = "DEBIT" | "CREDIT";
export type LedgerStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "POSTED" | "REVERSED";

export interface LedgerEntry {
  readonly id: string;
  readonly customerAccountId: string;
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
  readonly direction: LedgerDirection;
  readonly entryType: LedgerEntryType;
  readonly status: LedgerStatus;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly postedAt: Date | null;
  readonly reversedEntryId: string | null;
}

export function calculatePostedBalance(
  currency: CurrencyCode,
  entries: readonly LedgerEntry[],
): Money {
  const balanceMinor = entries.reduce((total, entry) => {
    if (entry.status !== "POSTED" || entry.currency !== currency) {
      return total;
    }

    const signedAmount = entry.direction === "DEBIT" ? entry.amountMinor : -entry.amountMinor;
    return total + signedAmount;
  }, 0n);

  return money(currency, balanceMinor);
}

export function validateLedgerEntry(entry: LedgerEntry): void {
  if (entry.amountMinor <= 0n) {
    throw new Error("Ledger entry amount must be greater than zero");
  }

  if (entry.status === "POSTED" && entry.postedAt === null) {
    throw new Error("Posted ledger entries require postedAt");
  }

  if (entry.entryType === "REVERSAL" && entry.reversedEntryId === null) {
    throw new Error("Reversal entries require the reversed entry identifier");
  }
}

export function validateReversal(original: LedgerEntry, reversal: LedgerEntry): void {
  validateLedgerEntry(original);
  validateLedgerEntry(reversal);

  if (original.status !== "POSTED") {
    throw new Error("Only posted entries can be reversed");
  }

  if (reversal.entryType !== "REVERSAL") {
    throw new Error("The compensating entry must be a reversal");
  }

  if (reversal.reversedEntryId !== original.id) {
    throw new Error("The reversal must reference the original entry");
  }

  if (reversal.currency !== original.currency || reversal.amountMinor !== original.amountMinor) {
    throw new Error("The reversal currency and amount must match the original entry");
  }

  if (reversal.direction === original.direction) {
    throw new Error("The reversal direction must oppose the original entry");
  }
}
