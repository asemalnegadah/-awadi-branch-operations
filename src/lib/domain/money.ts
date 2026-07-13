import { z } from "zod";

import { currencyCodeSchema, type CurrencyCode } from "@/lib/domain/currency";

const minorUnitSchema = z.number().int().safe();

export const moneySchema = z.object({
  currency: currencyCodeSchema,
  minorUnits: minorUnitSchema,
});

export type Money = Readonly<z.infer<typeof moneySchema>>;

export function money(currency: CurrencyCode, minorUnits: number): Money {
  return Object.freeze(moneySchema.parse({ currency, minorUnits }));
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error("لا يمكن جمع مبالغ بعملتين مختلفتين.");
  }

  return money(left.currency, left.minorUnits + right.minorUnits);
}

export function subtractMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error("لا يمكن طرح مبالغ بعملتين مختلفتين.");
  }

  return money(left.currency, left.minorUnits - right.minorUnits);
}

export function isZero(amount: Money): boolean {
  return amount.minorUnits === 0;
}
