import type { Money } from "@/lib/domain/money";

export const ledgerEntryDirections = ["DEBIT", "CREDIT"] as const;
export type LedgerEntryDirection = (typeof ledgerEntryDirections)[number];

export const ledgerEntryTypes = [
  "OPENING_BALANCE",
  "INVOICE",
  "COLLECTION",
  "CREDIT_NOTE",
  "RETURN",
  "APPROVED_DISCOUNT",
  "RECONCILIATION_ADJUSTMENT",
  "REVERSAL",
] as const;
export type LedgerEntryType = (typeof ledgerEntryTypes)[number];

export interface PostedLedgerEntry {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly amount: Money;
  readonly direction: LedgerEntryDirection;
  readonly entryType: LedgerEntryType;
  readonly accountingDate: string;
  readonly postedAt: string;
  readonly postedBy: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly description?: string | undefined;
  readonly reversalOfEntryId?: string | undefined;
}

export interface CreatePostedLedgerEntryInput {
  readonly id: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly amount: Money;
  readonly direction: LedgerEntryDirection;
  readonly entryType: Exclude<LedgerEntryType, "REVERSAL">;
  readonly accountingDate: string;
  readonly postedAt: string;
  readonly postedBy: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly description?: string | undefined;
}

export interface CreateReversalInput {
  readonly id: string;
  readonly original: PostedLedgerEntry;
  readonly postedAt: string;
  readonly postedBy: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
}
