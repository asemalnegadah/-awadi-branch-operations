export const COLLECTION_STATES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "RETURNED",
  "REVIEWED",
  "HANDED_OVER",
  "CASH_RECEIVED",
  "RECONCILED",
  "POSTED",
  "REJECTED",
  "CANCELLED",
  "REVERSED",
] as const;

export type CollectionState = (typeof COLLECTION_STATES)[number];

const ALLOWED_TRANSITIONS: Readonly<Record<CollectionState, readonly CollectionState[]>> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "RETURNED"],
  UNDER_REVIEW: ["REVIEWED", "RETURNED", "REJECTED"],
  RETURNED: ["DRAFT"],
  REVIEWED: ["HANDED_OVER"],
  HANDED_OVER: ["CASH_RECEIVED"],
  CASH_RECEIVED: ["RECONCILED"],
  RECONCILED: ["POSTED"],
  POSTED: ["REVERSED"],
  REJECTED: [],
  CANCELLED: [],
  REVERSED: [],
};

export function canTransitionCollection(
  currentState: CollectionState,
  nextState: CollectionState,
): boolean {
  return ALLOWED_TRANSITIONS[currentState].includes(nextState);
}

export function assertCollectionTransition(
  currentState: CollectionState,
  nextState: CollectionState,
): void {
  if (!canTransitionCollection(currentState, nextState)) {
    throw new Error(`Invalid collection transition: ${currentState} -> ${nextState}`);
  }
}

export function isCollectionFinalState(state: CollectionState): boolean {
  return ALLOWED_TRANSITIONS[state].length === 0;
}
