import type { Money } from "@/lib/domain/money";

export const custodyEventTypes = [
  "COLLECTION_IN",
  "HANDOVER_OUT",
  "REVERSAL",
] as const;

export type CustodyEventType = (typeof custodyEventTypes)[number];
export type CustodyDirection = "IN" | "OUT";

export interface CashCustodyEvent {
  readonly id: string;
  readonly representativeId: string;
  readonly amount: Money;
  readonly direction: CustodyDirection;
  readonly eventType: CustodyEventType;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly receivedBy?: string | undefined;
  readonly reason?: string | undefined;
  readonly reversalOfEventId?: string | undefined;
}
