import { z } from "zod";

import { currencyCodeSchema } from "@/lib/domain/currency";

import {
  promiseBaseStatuses,
  promiseTemporalStatuses,
  type AddFollowUpInput,
  type AllocateCollectionInput,
  type CancelPromiseInput,
  type CreatePromiseInput,
  type EscalatePromiseInput,
  type PromiseListFilters,
  type RejectPromiseInput,
  type ReverseAllocationInput,
  type UpdatePromiseInput,
} from "./types";

const uuidSchema = z.string().uuid();
const positiveMinorSchema = z.number().int().safe().positive();
const versionSchema = z.number().int().safe().positive();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isRealDate, "التاريخ غير صالح.");
const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => !Number.isNaN(Date.parse(value)), "التاريخ والوقت غير صالحين.");
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);

const createPromiseSchema = z
  .object({
    customerId: uuidSchema,
    customerAccountId: uuidSchema,
    representativeId: uuidSchema,
    currencyCode: currencyCodeSchema,
    promisedAmountMinor: positiveMinorSchema,
    promiseDate: dateSchema,
    dueDate: dateSchema,
    nextFollowUpAt: isoDateTimeSchema.nullable().optional(),
    debtReason: requiredText(1000),
    delayReason: optionalText(1000),
    notes: optionalText(4000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dueDate < value.promiseDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "تاريخ الاستحقاق لا يجوز أن يسبق تاريخ الوعد.",
      });
    }
  });

const updatePromiseSchema = z
  .object({
    version: versionSchema,
    representativeId: uuidSchema.optional(),
    promisedAmountMinor: positiveMinorSchema.optional(),
    promiseDate: dateSchema.optional(),
    dueDate: dateSchema.optional(),
    nextFollowUpAt: isoDateTimeSchema.nullable().optional(),
    debtReason: requiredText(1000).optional(),
    delayReason: optionalText(1000),
    notes: optionalText(4000),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = Object.keys(value).filter((key) => key !== "version");
    if (keys.length === 0) {
      context.addIssue({ code: "custom", message: "لا توجد حقول لتحديثها." });
    }
    if (value.promiseDate && value.dueDate && value.dueDate < value.promiseDate) {
      context.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "تاريخ الاستحقاق لا يجوز أن يسبق تاريخ الوعد.",
      });
    }
  });

const followUpSchema = z
  .object({
    scheduledAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable().optional(),
    outcome: optionalText(1000),
    notes: optionalText(4000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.completedAt && !value.outcome) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "نتيجة المتابعة مطلوبة عند تحديد وقت إكمالها.",
      });
    }
    if (!value.completedAt && value.outcome) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "وقت الإكمال مطلوب عند إدخال نتيجة المتابعة.",
      });
    }
  });

const reasonSchema = z.object({ version: versionSchema, reason: requiredText(1000) }).strict();
const escalationSchema = z
  .object({
    version: versionSchema,
    level: z.number().int().min(1).max(5),
    reason: requiredText(1000),
  })
  .strict();
const allocationSchema = z
  .object({ collectionId: uuidSchema, amountMinor: positiveMinorSchema })
  .strict();
const reversalSchema = z.object({ reason: requiredText(1000) }).strict();

export function parseCreatePromiseInput(input: unknown): CreatePromiseInput {
  return createPromiseSchema.parse(input);
}

export function parseUpdatePromiseInput(input: unknown): UpdatePromiseInput {
  return updatePromiseSchema.parse(input);
}

export function parseAddFollowUpInput(input: unknown): AddFollowUpInput {
  return followUpSchema.parse(input);
}

export function parseRejectPromiseInput(input: unknown): RejectPromiseInput {
  return reasonSchema.parse(input);
}

export function parseCancelPromiseInput(input: unknown): CancelPromiseInput {
  return reasonSchema.parse(input);
}

export function parseEscalatePromiseInput(input: unknown): EscalatePromiseInput {
  return escalationSchema.parse(input);
}

export function parseAllocateCollectionInput(input: unknown): AllocateCollectionInput {
  return allocationSchema.parse(input);
}

export function parseReverseAllocationInput(input: unknown): ReverseAllocationInput {
  return reversalSchema.parse(input);
}

export function parsePromiseId(value: string): string {
  return uuidSchema.parse(value);
}

export function parseIdempotencyKey(value: string | null): string {
  return z
    .string()
    .trim()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)
    .parse(value);
}

export function parsePromiseListFilters(
  searchParams: URLSearchParams,
): PromiseListFilters {
  const raw = {
    dueDateFrom: emptyToUndefined(searchParams.get("dueDateFrom")),
    dueDateTo: emptyToUndefined(searchParams.get("dueDateTo")),
    customerId: emptyToUndefined(searchParams.get("customerId")),
    representativeId: emptyToUndefined(searchParams.get("representativeId")),
    currencyCode: emptyToUndefined(searchParams.get("currency")),
    baseStatus: emptyToUndefined(searchParams.get("status")),
    temporalStatus: emptyToUndefined(searchParams.get("temporalStatus")),
    escalationLevel: emptyToUndefined(searchParams.get("escalationLevel")),
    partiallyFulfilled: parseOptionalBoolean(searchParams.get("partiallyFulfilled")),
    fulfilled: parseOptionalBoolean(searchParams.get("fulfilled")),
    query: emptyToUndefined(searchParams.get("q")),
    limit: emptyToUndefined(searchParams.get("limit")),
    cursor: emptyToUndefined(searchParams.get("cursor")),
  };

  const schema = z
    .object({
      dueDateFrom: dateSchema.optional(),
      dueDateTo: dateSchema.optional(),
      customerId: uuidSchema.optional(),
      representativeId: uuidSchema.optional(),
      currencyCode: currencyCodeSchema.optional(),
      baseStatus: z.enum(promiseBaseStatuses).optional(),
      temporalStatus: z.enum(promiseTemporalStatuses).optional(),
      escalationLevel: z.coerce.number().int().min(0).max(5).optional(),
      partiallyFulfilled: z.boolean().optional(),
      fulfilled: z.boolean().optional(),
      query: z.string().trim().min(1).max(120).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z.string().max(500).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.dueDateFrom && value.dueDateTo && value.dueDateTo < value.dueDateFrom) {
        context.addIssue({
          code: "custom",
          path: ["dueDateTo"],
          message: "نهاية الفترة لا يجوز أن تسبق بدايتها.",
        });
      }
      if (value.partiallyFulfilled && value.fulfilled) {
        context.addIssue({
          code: "custom",
          message: "لا يمكن طلب المنفذ جزئيًا والمنفذ كليًا في الفلتر نفسه.",
        });
      }
    });

  return schema.parse(raw);
}

function emptyToUndefined(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === null || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new z.ZodError([
    {
      code: "custom",
      path: [],
      message: "قيمة الفلتر المنطقي غير صالحة.",
    },
  ]);
}

function isRealDate(value: string): boolean {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
