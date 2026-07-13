export const collectionStates = [
  "DRAFT",
  "SUBMITTED",
  "RETURNED",
  "REVIEWED",
  "CONFLICTED",
  "APPROVED",
  "CASH_RECEIVED",
  "RECONCILED",
  "CLOSED",
  "REJECTED",
  "REVERSED",
] as const;

export type CollectionState = (typeof collectionStates)[number];

const allowedTransitions: Readonly<
  Record<CollectionState, ReadonlySet<CollectionState>>
> = {
  DRAFT: new Set(["SUBMITTED"]),
  SUBMITTED: new Set(["RETURNED", "REVIEWED", "CONFLICTED", "REJECTED"]),
  RETURNED: new Set(["SUBMITTED"]),
  REVIEWED: new Set(["APPROVED", "CONFLICTED", "RETURNED", "REJECTED"]),
  CONFLICTED: new Set(["RETURNED", "REVIEWED", "REJECTED"]),
  APPROVED: new Set(["CASH_RECEIVED", "REVERSED"]),
  CASH_RECEIVED: new Set(["RECONCILED", "CONFLICTED", "REVERSED"]),
  RECONCILED: new Set(["CLOSED", "CONFLICTED", "REVERSED"]),
  CLOSED: new Set(["REVERSED"]),
  REJECTED: new Set(),
  REVERSED: new Set(),
};

export function canTransitionCollection(
  from: CollectionState,
  to: CollectionState,
): boolean {
  return allowedTransitions[from].has(to);
}

export function assertCollectionTransition(
  from: CollectionState,
  to: CollectionState,
): void {
  if (!canTransitionCollection(from, to)) {
    throw new Error(`انتقال حالة التحصيل غير مسموح: ${from} → ${to}`);
  }
}

export function isTerminalCollectionState(state: CollectionState): boolean {
  return allowedTransitions[state].size === 0;
}
