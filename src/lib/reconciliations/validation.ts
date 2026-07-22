import { z } from "zod";

import {
  reconciliationReasonCodes,
  reconciliationSourceKinds,
  reconciliationStates,
  type CreateReconciliationInput,
  type ReconciliationListFilters,
  type ReconciliationTransitionInput,
} from "./types";

const uuidSchema = z.string().uuid();
const safeMinorSchema = z.number().int().safe();
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

const createSchema = z
  .object({
    customerAccountId: uuidSchema,
    sourceKind: z.enum(reconciliationSourceKinds),
    sourceType: requiredText(80),
    sourceId: requiredText(160),
    cutoffDate: isoDateSchema,
    expectedAmountMinor: safeMinorSchema,
    observedAmountMinor: safeMinorSchema,
    reasonCode: z.enum(reconciliationReasonCodes).nullable().optional(),
    reasonText: optionalReasonText,
  })
  .strict()
  .superRefine((value, context) => {
    const hasCode = value.reasonCode != null;
    const hasText = value.reasonText != null;
    if (hasCode !== hasText) {
      context.addIssue({
        code: "custom",
        path: hasCode ? ["reasonText"] : ["reasonCode"],
        message: "رمز السبب ووصفه يجب أن يرسلا معًا.",
      });
    }
  });

const transitionSchema = z
  .object({
    version: versionSchema,
    reason: requiredText(2000).optional(),
    reasonCode: z.enum(reconciliationReasonCodes).optional(),
    reasonText: requiredText(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.reasonCode == null) !== (value.reasonText == null)) {
      context.addIssue({
        code: "custom",
        path: value.reasonCode == null ? ["reasonCode"] : ["reasonText"],
        message: "تصنيف الفرق ووصفه يجب أن يرسلا معًا.",
      });
    }
  });

export function parseCreateReconciliationInput(input: unknown): CreateReconciliationInput {
  return createSchema.parse(input);
}

export function parseReconciliationTransitionInput(input: unknown): ReconciliationTransitionInput {
  return transitionSchema.parse(input);
}

export function parseReconciliationId(value: string): string {
  return uuidSchema.parse(value);
}

export function parseReconciliationIdempotencyKey(value: string | null): string {
  return z
    .string()
    .trim()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
    .parse(value);
}

export function parseReconciliationListFilters(
  searchParams: URLSearchParams,
): ReconciliationListFilters {
  return z
    .object({
      currencyCode: z.enum(["SR", "RG"]).optional(),
      state: z.enum(reconciliationStates).optional(),
      query: z.string().trim().min(1).max(160).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: uuidSchema.optional(),
    })
    .strict()
    .parse({
      currencyCode: emptyToUndefined(searchParams.get("currency")),
      state: emptyToUndefined(searchParams.get("state")),
      query: emptyToUndefined(searchParams.get("q")),
      limit: emptyToUndefined(searchParams.get("limit")) ?? 30,
      cursor: emptyToUndefined(searchParams.get("cursor")),
    });
}

function emptyToUndefined(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
