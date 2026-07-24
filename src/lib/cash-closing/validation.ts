import { z } from "zod";

import {
  cashClosingStates,
  type CashClosingListFilters,
  type CashClosingTransitionInput,
  type CreateCashClosingInput,
  type CreateCashHandoverInput,
  type ReviseCashClosingInput,
} from "./types";

const uuidSchema = z.string().uuid();
const currencySchema = z.enum(["SR", "RG"]);
const safeNonNegativeMinorSchema = z.number().int().safe().nonnegative();
const safePositiveMinorSchema = z.number().int().safe().positive();
const versionSchema = z.number().int().safe().positive();
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalReasonText = z.string().trim().min(3).max(2000).nullable().optional();
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "التاريخ يجب أن يكون بالصيغة YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "التاريخ غير صالح.");
const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "التاريخ والوقت يجب أن يتضمنا المنطقة الزمنية." });

const createHandoverSchema = z
  .object({
    representativeId: uuidSchema,
    currencyCode: currencySchema,
    amountMinor: safePositiveMinorSchema,
    handedOverAt: isoDateTimeSchema,
    receivedBy: uuidSchema,
    reference: requiredText(120),
    note: z.string().trim().min(3).max(1000).nullable().optional(),
  })
  .strict();

const createClosingSchema = z
  .object({
    representativeId: uuidSchema,
    businessDate: isoDateSchema,
    currencyCode: currencySchema,
    declaredCashMinor: safeNonNegativeMinorSchema,
    varianceReason: optionalReasonText,
  })
  .strict();

const reviseClosingSchema = z
  .object({
    version: versionSchema,
    declaredCashMinor: safeNonNegativeMinorSchema,
    varianceReason: optionalReasonText,
  })
  .strict();

const transitionSchema = z
  .object({
    version: versionSchema,
    reason: requiredText(2000).optional(),
  })
  .strict();

export function parseCreateCashHandoverInput(input: unknown): CreateCashHandoverInput {
  return createHandoverSchema.parse(input);
}

export function parseCreateCashClosingInput(input: unknown): CreateCashClosingInput {
  return createClosingSchema.parse(input);
}

export function parseReviseCashClosingInput(input: unknown): ReviseCashClosingInput {
  return reviseClosingSchema.parse(input);
}

export function parseCashClosingTransitionInput(input: unknown): CashClosingTransitionInput {
  return transitionSchema.parse(input);
}

export function parseCashClosingId(value: string): string {
  return uuidSchema.parse(value);
}

export function parseCashClosingIdempotencyKey(value: string | null): string {
  return z
    .string()
    .trim()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
    .parse(value);
}

export function parseCashClosingListFilters(
  searchParams: URLSearchParams,
): CashClosingListFilters {
  return z
    .object({
      representativeId: uuidSchema.optional(),
      currencyCode: currencySchema.optional(),
      state: z.enum(cashClosingStates).optional(),
      businessDate: isoDateSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: uuidSchema.optional(),
    })
    .strict()
    .parse({
      representativeId: emptyToUndefined(searchParams.get("representative")),
      currencyCode: emptyToUndefined(searchParams.get("currency")),
      state: emptyToUndefined(searchParams.get("state")),
      businessDate: emptyToUndefined(searchParams.get("date")),
      limit: emptyToUndefined(searchParams.get("limit")) ?? 30,
      cursor: emptyToUndefined(searchParams.get("cursor")),
    });
}

function emptyToUndefined(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
