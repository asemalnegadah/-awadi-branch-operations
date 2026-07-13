import { z } from "zod";

export const currencyCodes = ["SR", "RG"] as const;

export const currencyCodeSchema = z.enum(currencyCodes);

export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const currencyDefinitions: Readonly<
  Record<
    CurrencyCode,
    {
      code: CurrencyCode;
      nameAr: string;
      decimalPlaces: number;
    }
  >
> = {
  SR: {
    code: "SR",
    nameAr: "حساب SR",
    decimalPlaces: 2,
  },
  RG: {
    code: "RG",
    nameAr: "حساب RG",
    decimalPlaces: 2,
  },
};

export function assertCurrencyCode(value: unknown): CurrencyCode {
  return currencyCodeSchema.parse(value);
}
