import { z } from "zod";

import { currencyCodes } from "@/lib/domain/currency";

import { FieldVisitInputError } from "./errors";
import {
  dailyPlanItemResultTypes,
  fieldVisitOutcomeTypes,
  fieldVisitResults,
  fieldVisitStates,
  fieldVisitTypes,
  type AddFieldVisitEvidenceInput,
  type AddFieldVisitOutcomeInput,
  type CreateFieldVisitInput,
  type FieldVisitListFilters,
  type FieldVisitLocationInput,
  type FieldVisitTransitionInput,
  type RecordPlanItemResultInput,
  type SubmitFieldVisitInput,
} from "./types";

const uuid = z.string().uuid("المعرف غير صالح.");
const nonEmpty = z.string().trim().min(2, "النص المطلوب قصير أو فارغ.").max(2_000);
const optionalText = z.string().trim().min(2).max(2_000).nullable().optional();
const safeMinorAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const createSchema = z.object({
  customerId: uuid,
  representativeId: uuid.nullable().optional(),
  planId: uuid.nullable().optional(),
  planItemId: uuid.nullable().optional(),
  visitType: z.enum(fieldVisitTypes),
  objective: nonEmpty,
  outOfPlanReason: optionalText,
}).strict().superRefine((value, context) => {
  const hasPlan = value.planId !== null && value.planId !== undefined;
  const hasItem = value.planItemId !== null && value.planItemId !== undefined;
  if (hasPlan !== hasItem) {
    context.addIssue({
      code: "custom",
      path: ["planItemId"],
      message: "يجب إرسال معرف الخطة وعنصرها معًا أو تركهما معًا.",
    });
  }
  if (!hasPlan && !value.outOfPlanReason) {
    context.addIssue({
      code: "custom",
      path: ["outOfPlanReason"],
      message: "سبب الزيارة خارج الخطة مطلوب.",
    });
  }
  if (hasPlan && value.outOfPlanReason) {
    context.addIssue({
      code: "custom",
      path: ["outOfPlanReason"],
      message: "الزيارة المرتبطة بالخطة لا تقبل سببًا خارج الخطة.",
    });
  }
  if (hasPlan && value.representativeId) {
    context.addIssue({
      code: "custom",
      path: ["representativeId"],
      message: "مندوب الزيارة المرتبطة بالخطة يُستخرج من عنصر الخطة ولا يُرسل يدويًا.",
    });
  }
});

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracyMeters: z.number().nonnegative().max(100_000).nullable().optional(),
  deviceAt: z.string().datetime({ offset: true }).nullable().optional(),
  syncStatus: z.enum(["ONLINE", "PENDING_UPLOAD", "SYNCED", "CONFLICT"]).optional(),
}).strict().superRefine((value, context) => {
  const hasLatitude = value.latitude !== null && value.latitude !== undefined;
  const hasLongitude = value.longitude !== null && value.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: "custom",
      path: ["longitude"],
      message: "خطا الطول والعرض يجب أن يرسلا معًا.",
    });
  }
  if (value.accuracyMeters !== null && value.accuracyMeters !== undefined && !hasLatitude) {
    context.addIssue({
      code: "custom",
      path: ["accuracyMeters"],
      message: "دقة الموقع لا تقبل دون إحداثيات.",
    });
  }
});

const transitionSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(2).max(2_000).optional(),
}).strict();

const submitSchema = z.object({
  version: z.number().int().positive(),
  result: z.enum(fieldVisitResults),
  summary: nonEmpty,
}).strict();

const outcomeSchema = z.object({
  outcomeType: z.enum(fieldVisitOutcomeTypes),
  collectionId: uuid.nullable().optional(),
  promiseId: uuid.nullable().optional(),
  referenceId: z.string().trim().min(1).max(200).nullable().optional(),
  currencyCode: z.enum(currencyCodes).nullable().optional(),
  amountMinor: safeMinorAmount.nullable().optional(),
  summary: nonEmpty,
  details: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  const collection = value.collectionId ?? null;
  const promise = value.promiseId ?? null;
  if (value.outcomeType === "COLLECTION" && !collection) {
    context.addIssue({ code: "custom", path: ["collectionId"], message: "معرف التحصيل مطلوب." });
  }
  if (value.outcomeType === "PAYMENT_PROMISE" && !promise) {
    context.addIssue({ code: "custom", path: ["promiseId"], message: "معرف الوعد مطلوب." });
  }
  if (value.outcomeType !== "COLLECTION" && collection) {
    context.addIssue({ code: "custom", path: ["collectionId"], message: "معرف التحصيل لا يخص هذه النتيجة." });
  }
  if (value.outcomeType !== "PAYMENT_PROMISE" && promise) {
    context.addIssue({ code: "custom", path: ["promiseId"], message: "معرف الوعد لا يخص هذه النتيجة." });
  }
  const hasCurrency = value.currencyCode !== null && value.currencyCode !== undefined;
  const hasAmount = value.amountMinor !== null && value.amountMinor !== undefined;
  if (hasCurrency !== hasAmount) {
    context.addIssue({ code: "custom", path: ["amountMinor"], message: "العملة والمبلغ يجب أن يرسلا معًا." });
  }
  if (value.outcomeType === "NO_RESULT" && (hasCurrency || value.referenceId)) {
    context.addIssue({ code: "custom", path: ["outcomeType"], message: "نتيجة عدم الإنجاز لا تقبل مبلغًا أو مرجعًا." });
  }
});

const evidenceSchema = z.object({
  uploadedFileId: uuid,
  evidenceType: z.enum([
    "RECEIPT",
    "CUSTOMER_LOCATION",
    "SHOP_FRONT",
    "DOCUMENT",
    "SIGNATURE",
    "OTHER",
  ]),
  caption: z.string().trim().min(2).max(500).nullable().optional(),
}).strict();

const planItemResultSchema = z.object({
  planItemId: uuid,
  visitId: uuid.nullable().optional(),
  resultType: z.enum(dailyPlanItemResultTypes),
  reason: nonEmpty,
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  supersedesResultId: uuid.nullable().optional(),
}).strict().superRefine((value, context) => {
  const visited = ["VISITED_SUCCESS", "VISITED_PARTIAL", "VISITED_FAILED"].includes(value.resultType);
  if (visited && !value.visitId) {
    context.addIssue({ code: "custom", path: ["visitId"], message: "النتيجة الميدانية تتطلب زيارة مرتبطة." });
  }
  if (!visited && value.visitId) {
    context.addIssue({ code: "custom", path: ["visitId"], message: "هذه النتيجة لا تقبل زيارة مرتبطة." });
  }
  if (["RESCHEDULED", "CUSTOMER_ABSENT", "REFUSED"].includes(value.resultType) && !value.nextActionAt) {
    context.addIssue({ code: "custom", path: ["nextActionAt"], message: "الإجراء التالي مطلوب لهذه النتيجة." });
  }
});

export function parseCreateFieldVisit(value: unknown): CreateFieldVisitInput {
  return createSchema.parse(value);
}

export function parseFieldVisitLocation(value: unknown): FieldVisitLocationInput {
  return locationSchema.parse(value);
}

export function parseFieldVisitTransition(value: unknown): FieldVisitTransitionInput {
  return transitionSchema.parse(value);
}

export function parseSubmitFieldVisit(value: unknown): SubmitFieldVisitInput {
  return submitSchema.parse(value);
}

export function parseFieldVisitOutcome(value: unknown): AddFieldVisitOutcomeInput {
  return outcomeSchema.parse(value);
}

export function parseFieldVisitEvidence(value: unknown): AddFieldVisitEvidenceInput {
  return evidenceSchema.parse(value);
}

export function parsePlanItemResult(value: unknown): RecordPlanItemResultInput {
  return planItemResultSchema.parse(value);
}

export function parseFieldVisitIdempotencyKey(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length < 8 || normalized.length > 200) {
    throw new FieldVisitInputError("مفتاح منع التكرار مطلوب ويجب أن يكون بين 8 و200 حرف.");
  }
  return normalized;
}

export function parseFieldVisitListFilters(search: URLSearchParams): FieldVisitListFilters {
  const limitRaw = search.get("limit") ?? "50";
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new FieldVisitInputError("حد الصفحة يجب أن يكون بين 1 و100.");
  }
  const state = search.get("state") ?? undefined;
  if (state && !(fieldVisitStates as readonly string[]).includes(state)) {
    throw new FieldVisitInputError("حالة الزيارة غير صالحة.");
  }
  return Object.freeze({
    representativeId: optionalUuid(search.get("representativeId")),
    customerId: optionalUuid(search.get("customerId")),
    state: state as FieldVisitListFilters["state"],
    visitDateFrom: optionalDate(search.get("visitDateFrom")),
    visitDateTo: optionalDate(search.get("visitDateTo")),
    limit,
    cursor: search.get("cursor")?.trim() || undefined,
  });
}

function optionalUuid(value: string | null): string | undefined {
  if (!value) return undefined;
  const result = uuid.safeParse(value);
  if (!result.success) throw new FieldVisitInputError("معرف الفلتر غير صالح.");
  return result.data;
}

function optionalDate(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FieldVisitInputError("تاريخ الفلتر غير صالح.");
  }
  return value;
}
