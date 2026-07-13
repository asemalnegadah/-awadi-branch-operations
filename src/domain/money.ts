import type { CurrencyCode } from "@/domain/currency";

export interface Money {
  readonly currency: CurrencyCode;
  readonly minorUnits: bigint;
}

export function money(currency: CurrencyCode, minorUnits: bigint): Money {
  return Object.freeze({ currency, minorUnits });
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.currency, left.minorUnits + right.minorUnits);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.currency, left.minorUnits - right.minorUnits);
}

export function negateMoney(value: Money): Money {
  return money(value.currency, -value.minorUnits);
}

export function isZeroMoney(value: Money): boolean {
  return value.minorUnits === 0n;
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(
      `Currency mismatch: ${left.currency} cannot be combined with ${right.currency}`,
    );
  }
}
