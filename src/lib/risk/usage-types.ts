import type { CurrencyCode } from "@/lib/domain/currency";

import type { CreditException, CreditRestriction } from "./types";

export interface CreditExceptionUsageEntry {
  readonly id: string;
  readonly exceptionId: string;
  readonly restrictionId: string;
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly currencyCode: CurrencyCode;
  readonly direction: "CONSUME" | "REVERSE";
  readonly amountMinor: number;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly reversalOfUsageId: string | null;
  readonly occurredAt: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly requestId: string;
  readonly reason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ConsumeCreditExceptionInput {
  readonly exceptionId: string;
  readonly amountMinor: number;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ReverseCreditExceptionUsageInput {
  readonly usageId: string;
  readonly reason: string;
}

export interface CreditSaleEvaluation {
  readonly allowed: boolean;
  readonly reason: string;
  readonly restriction: CreditRestriction | null;
  readonly exception: CreditException | null;
  readonly exceptionRemainingMinor: number | null;
}
