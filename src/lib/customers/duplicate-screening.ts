import {
  normalizeArabicName,
  normalizeCustomerNumber,
  normalizeExternalIdentifier,
  normalizePhone,
} from "./identity";

export interface CustomerIdentityInput {
  readonly tradeNameAr: string;
  readonly customerNumber?: string | undefined;
  readonly phones?: readonly string[] | undefined;
  readonly externalIdentifiers?:
    | readonly {
        sourceSystem: string;
        externalIdentifier: string;
      }[]
    | undefined;
}

export type DuplicateSignal =
  | "EXACT_EXTERNAL_IDENTIFIER"
  | "EXACT_CUSTOMER_NUMBER"
  | "EXACT_PHONE"
  | "NORMALIZED_TRADE_NAME";

export interface DuplicateScreeningResult {
  readonly score: number;
  readonly signals: readonly DuplicateSignal[];
  readonly requiresHumanReview: boolean;
  readonly automaticMergeAllowed: false;
}

const signalWeights: Readonly<Record<DuplicateSignal, number>> = {
  EXACT_EXTERNAL_IDENTIFIER: 100,
  EXACT_CUSTOMER_NUMBER: 90,
  EXACT_PHONE: 70,
  NORMALIZED_TRADE_NAME: 30,
};

export function screenPotentialDuplicate(
  incoming: CustomerIdentityInput,
  existing: CustomerIdentityInput,
): DuplicateScreeningResult {
  const signals: DuplicateSignal[] = [];

  if (hasMatchingExternalIdentifier(incoming, existing)) {
    signals.push("EXACT_EXTERNAL_IDENTIFIER");
  }

  if (
    incoming.customerNumber &&
    existing.customerNumber &&
    normalizeCustomerNumber(incoming.customerNumber) ===
      normalizeCustomerNumber(existing.customerNumber)
  ) {
    signals.push("EXACT_CUSTOMER_NUMBER");
  }

  if (hasMatchingPhone(incoming.phones, existing.phones)) {
    signals.push("EXACT_PHONE");
  }

  const incomingName = normalizeArabicName(incoming.tradeNameAr);
  const existingName = normalizeArabicName(existing.tradeNameAr);

  if (incomingName.length > 0 && incomingName === existingName) {
    signals.push("NORMALIZED_TRADE_NAME");
  }

  const score = Math.min(
    100,
    signals.reduce((total, signal) => total + signalWeights[signal], 0),
  );

  return Object.freeze({
    score,
    signals: Object.freeze(signals),
    requiresHumanReview: score >= 30,
    automaticMergeAllowed: false as const,
  });
}

function hasMatchingPhone(
  incomingPhones: readonly string[] | undefined,
  existingPhones: readonly string[] | undefined,
): boolean {
  if (!incomingPhones?.length || !existingPhones?.length) {
    return false;
  }

  const existingNormalized = new Set(
    existingPhones.map(normalizePhone).filter((value) => value.length > 0),
  );

  return incomingPhones
    .map(normalizePhone)
    .some((value) => value.length > 0 && existingNormalized.has(value));
}

function hasMatchingExternalIdentifier(
  incoming: CustomerIdentityInput,
  existing: CustomerIdentityInput,
): boolean {
  if (
    !incoming.externalIdentifiers?.length ||
    !existing.externalIdentifiers?.length
  ) {
    return false;
  }

  const existingKeys = new Set(
    existing.externalIdentifiers.map(toExternalIdentifierKey),
  );

  return incoming.externalIdentifiers.some((identifier) =>
    existingKeys.has(toExternalIdentifierKey(identifier)),
  );
}

function toExternalIdentifierKey(identifier: {
  sourceSystem: string;
  externalIdentifier: string;
}): string {
  return `${normalizeExternalIdentifier(identifier.sourceSystem)}::${normalizeExternalIdentifier(
    identifier.externalIdentifier,
  )}`;
}
