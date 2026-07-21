import { z } from "zod";

import { currencyCodeSchema } from "@/lib/domain/currency";

import {
  creditDecisionStates,
  creditExceptionScopes,
  creditRestrictionDecisionTypes,
  creditRestrictionReasonCodes,
  creditRiskLevels,
  type CreateCreditExceptionInput,
  type CreateCreditRestrictionInput,
  type CreditRiskListFilters,
  type DecisionTransitionInput,
  type RecalculateCreditRiskInput,
} from "./types";

const uuidSchema = z.string().uuid();
const positiveMinorSchema = z.number().int().safe().positive();
const versionSchema = z.number().int().safe().positive();
const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => !Number.isNaN(Date.parse(value)), "التاريخ والوقت غير صالحين.");
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalDateTime = isoDateTimeSchema.nullable().optional();

const recalculateSchema = z.object({ customerAccountId: uuidSchema }).strict();

const restrictionSchema = z
  .object({
    customerAccountId: uuidSchema,
    decisionType: z.enum(creditRestrictionDecisionTypes),
    limitAmountMinor: positiveMinorSchema.nullable().optional(),
    reasonCode: z.enum(creditRestrictionReasonCodes),
    reasonText: requiredText(1000),
    sourceAssessmentId: uuidSchema.nullable().optional(),
    effectiveFrom: isoDateTimeSchema,
    reviewDueAt: optionalDateTime,
    expiresAt: optionalDateTime,
    restorationConditions: requiredText(2000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decisionType === "LIMIT" && !value.limitAmountMinor) {
      context.addIssue({
        code: "custom",
        path: ["limitAmountMinor"],
        message: "مبلغ الحد الائتماني مطلوب عند اختيار التحديد.",
      });
    }
    if (value.decisionType !== "LIMIT" && value.limitAmountMinor != null) {
      context.addIssue({
        code: "custom",
        path: ["limitAmountMinor"],
        message: "لا يرسل مبلغ حد مع التعليق أو المنع الكامل.",
      });
    }
    if (value.reviewDueAt && value.reviewDueAt < value.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["reviewDueAt"],
        message: "موعد المراجعة لا يجوز أن يسبق بداية القرار.",
      });
    }
    if (value.expiresAt && value.expiresAt <= value.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "نهاية القرار يجب أن تكون بعد بدايته.",
      });
    }
  });

const exceptionSchema = z
  .object({
    restrictionId: uuidSchema,
    scope: z.enum(creditExceptionScopes),
    maxAmountMinor: positiveMinorSchema,
    validFrom: isoDateTimeSchema,
    validUntil: isoDateTimeSchema,
    reason: requiredText(1000),
    conditions: requiredText(2000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.validUntil <= value.validFrom) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "نهاية الاستثناء يجب أن تكون بعد بدايته.",
      });
    }
  });

const transitionSchema = z
  .object({ version: versionSchema, reason: requiredText(1000).optional() })
  .strict();

export function parseRecalculateCreditRiskInput(input: unknown): RecalculateCreditRiskInput {
  return recalculateSchema.parse(input);
}

export function parseCreateCreditRestrictionInput(input: unknown): CreateCreditRestrictionInput {
  return restrictionSchema.parse(input);
}

export function parseCreateCreditExceptionInput(input: unknown): CreateCreditExceptionInput {
  return exceptionSchema.parse(input);
}

export function parseDecisionTransitionInput(input: unknown): DecisionTransitionInput {
  return transitionSchema.parse(input);
}

export function parseRiskId(value: string): string {
  return uuidSchema.parse(value);
}

export function parseRiskIdempotencyKey(value: string | null): string {
  return z
    .string()
    .trim()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
    .parse(value);
}

export function parseCreditRiskListFilters(searchParams: URLSearchParams): CreditRiskListFilters {
  return z
    .object({
      currencyCode: z.enum(["SR", "RG"]).optional(),
      riskLevel: z.enum(creditRiskLevels).optional(),
      decisionState: z.enum(creditDecisionStates).optional(),
      query: z.string().trim().min(1).max(160).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: uuidSchema.optional(),
    })
    .strict()
    .parse({
      currencyCode: emptyToUndefined(searchParams.get("currency")),
      riskLevel: emptyToUndefined(searchParams.get("riskLevel")),
      decisionState: emptyToUndefined(searchParams.get("decisionState")),
      query: emptyToUndefined(searchParams.get("q")),
      limit: emptyToUndefined(searchParams.get("limit")) ?? 30,
      cursor: emptyToUndefined(searchParams.get("cursor")),
    });
}

export function parseCurrencyCode(value: string): "SR" | "RG" {
  return currencyCodeSchema.parse(value);
}

function emptyToUndefined(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
