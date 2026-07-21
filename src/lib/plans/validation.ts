import { z } from "zod";

import { currencyCodeSchema } from "@/lib/domain/currency";

import {
  dailyPlanStates,
  type DailyPlanListFilters,
  type DailyPlanTransitionInput,
  type GenerateDailyPlanInput,
} from "./types";

const uuidSchema = z.string().uuid();
const versionSchema = z.number().int().safe().positive();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isRealDate, "التاريخ غير صالح.");
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).transform((value) => value || null).nullable().optional();
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);

const generateSchema = z
  .object({
    representativeId: uuidSchema,
    planDate: dateSchema,
    maxItems: z.number().int().min(1).max(100).default(12),
    workMinutesBudget: z.number().int().min(30).max(1440).default(480),
    fuelBudgetCurrencyCode: currencyCodeSchema.nullable().optional(),
    fuelBudgetMinor: z.number().int().safe().nonnegative().nullable().optional(),
    notes: optionalText(4000),
  })
  .strict()
  .superRefine((value, context) => {
    const hasCurrency = value.fuelBudgetCurrencyCode != null;
    const hasAmount = value.fuelBudgetMinor != null;
    if (hasCurrency !== hasAmount) {
      context.addIssue({
        code: "custom",
        path: hasCurrency ? ["fuelBudgetMinor"] : ["fuelBudgetCurrencyCode"],
        message: "عملة ميزانية الوقود ومبلغها يجب أن يرسلا معًا.",
      });
    }
  });

const transitionSchema = z
  .object({
    version: versionSchema,
    reason: requiredText(1000).optional(),
  })
  .strict();

export function parseGenerateDailyPlanInput(input: unknown): GenerateDailyPlanInput {
  return generateSchema.parse(input);
}

export function parseDailyPlanTransitionInput(input: unknown): DailyPlanTransitionInput {
  return transitionSchema.parse(input);
}

export function parseDailyPlanId(value: string): string {
  return uuidSchema.parse(value);
}

export function parseDailyPlanIdempotencyKey(value: string | null): string {
  return z
    .string()
    .trim()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
    .parse(value);
}

export function parseDailyPlanListFilters(
  searchParams: URLSearchParams,
): DailyPlanListFilters {
  return z
    .object({
      representativeId: uuidSchema.optional(),
      planDateFrom: dateSchema.optional(),
      planDateTo: dateSchema.optional(),
      state: z.enum(dailyPlanStates).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: uuidSchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.planDateFrom && value.planDateTo && value.planDateTo < value.planDateFrom) {
        context.addIssue({
          code: "custom",
          path: ["planDateTo"],
          message: "نهاية الفترة لا يجوز أن تسبق بدايتها.",
        });
      }
    })
    .parse({
      representativeId: emptyToUndefined(searchParams.get("representativeId")),
      planDateFrom: emptyToUndefined(searchParams.get("planDateFrom")),
      planDateTo: emptyToUndefined(searchParams.get("planDateTo")),
      state: emptyToUndefined(searchParams.get("state")),
      limit: emptyToUndefined(searchParams.get("limit")) ?? 30,
      cursor: emptyToUndefined(searchParams.get("cursor")),
    });
}

function emptyToUndefined(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isRealDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
