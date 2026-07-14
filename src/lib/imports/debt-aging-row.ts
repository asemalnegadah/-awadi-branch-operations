import { z } from "zod";

import { assertCurrencyCode, type CurrencyCode } from "@/lib/domain/currency";

import { parseLocalizedMoneyToMinor } from "./localized-number";

export const agingBuckets = [
  "NOT_DUE",
  "DAYS_1_30",
  "DAYS_31_60",
  "DAYS_61_90",
  "DAYS_91_180",
  "OVER_180",
  "UNKNOWN",
] as const;

export type AgingBucket = (typeof agingBuckets)[number];

export const rawDebtAgingRowSchema = z.object({
  customerNumber: z.string().trim().optional(),
  customerName: z.string().trim().min(1),
  representativeName: z.string().trim().optional(),
  currency: z.string().trim().min(1),
  originalAmount: z.string().trim().optional(),
  remainingAmount: z.string().trim().min(1),
  invoiceNumber: z.string().trim().optional(),
  invoiceDate: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
  ageDays: z.union([z.string(), z.number().int()]).optional(),
  agingBucket: z.string().trim().optional(),
  sourcePage: z.number().int().positive(),
  sourceRow: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

export type RawDebtAgingRow = z.infer<typeof rawDebtAgingRowSchema>;

export interface NormalizedDebtAgingRow {
  readonly customerNumber?: string | undefined;
  readonly customerName: string;
  readonly representativeName?: string | undefined;
  readonly currency: CurrencyCode;
  readonly originalAmountMinor?: number | undefined;
  readonly remainingAmountMinor: number;
  readonly invoiceNumber?: string | undefined;
  readonly invoiceDate?: string | undefined;
  readonly dueDate?: string | undefined;
  readonly ageDays?: number | undefined;
  readonly agingBucket: AgingBucket;
  readonly sourcePage: number;
  readonly sourceRow: number;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

export function normalizeDebtAgingRow(
  rawInput: unknown,
  decimalPlaces = 2,
): NormalizedDebtAgingRow {
  const raw = rawDebtAgingRowSchema.parse(rawInput);
  const warnings: string[] = [];
  const currency = assertCurrencyCode(raw.currency.toUpperCase());
  const ageDays = parseOptionalAgeDays(raw.ageDays);
  const derivedBucket = deriveAgingBucket(ageDays);
  const statedBucket = parseAgingBucket(raw.agingBucket);

  if (statedBucket !== "UNKNOWN" && derivedBucket !== "UNKNOWN" && statedBucket !== derivedBucket) {
    warnings.push("تصنيف عمر الدين في الملف لا يطابق العمر المحسوب.");
  }

  const remainingAmountMinor = parseLocalizedMoneyToMinor(
    raw.remainingAmount,
    decimalPlaces,
  );

  if (remainingAmountMinor < 0) {
    warnings.push("الرصيد المتبقي سالب ويحتاج مراجعة.");
  }

  const originalAmountMinor = raw.originalAmount
    ? parseLocalizedMoneyToMinor(raw.originalAmount, decimalPlaces)
    : undefined;

  if (
    originalAmountMinor !== undefined &&
    originalAmountMinor >= 0 &&
    remainingAmountMinor > originalAmountMinor
  ) {
    warnings.push("الرصيد المتبقي أكبر من المبلغ الأصلي.");
  }

  const invoiceDate = parseOptionalIsoDate(raw.invoiceDate, "تاريخ الفاتورة", warnings);
  const dueDate = parseOptionalIsoDate(raw.dueDate, "تاريخ الاستحقاق", warnings);

  return Object.freeze({
    customerNumber: normalizeOptional(raw.customerNumber),
    customerName: raw.customerName.trim(),
    representativeName: normalizeOptional(raw.representativeName),
    currency,
    originalAmountMinor,
    remainingAmountMinor,
    invoiceNumber: normalizeOptional(raw.invoiceNumber),
    invoiceDate,
    dueDate,
    ageDays,
    agingBucket: derivedBucket !== "UNKNOWN" ? derivedBucket : statedBucket,
    sourcePage: raw.sourcePage,
    sourceRow: raw.sourceRow,
    confidence: raw.confidence,
    warnings: Object.freeze(warnings),
  });
}

export function deriveAgingBucket(ageDays: number | undefined): AgingBucket {
  if (ageDays === undefined) {
    return "UNKNOWN";
  }

  if (ageDays <= 0) {
    return "NOT_DUE";
  }

  if (ageDays <= 30) {
    return "DAYS_1_30";
  }

  if (ageDays <= 60) {
    return "DAYS_31_60";
  }

  if (ageDays <= 90) {
    return "DAYS_61_90";
  }

  if (ageDays <= 180) {
    return "DAYS_91_180";
  }

  return "OVER_180";
}

function parseOptionalAgeDays(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value.replace(/\s+/g, ""));
  if (!Number.isInteger(parsed) || parsed < -3650 || parsed > 36500) {
    throw new Error("عمر الدين المستخرج غير صالح.");
  }

  return parsed;
}

function parseAgingBucket(value: string | undefined): AgingBucket {
  if (!value) {
    return "UNKNOWN";
  }

  const normalized = value
    .normalize("NFKC")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

  if (normalized.includes("غير مستحق")) return "NOT_DUE";
  if (normalized.includes("1 30") || normalized.includes("1-30")) return "DAYS_1_30";
  if (normalized.includes("31 60") || normalized.includes("31-60")) return "DAYS_31_60";
  if (normalized.includes("61 90") || normalized.includes("61-90")) return "DAYS_61_90";
  if (normalized.includes("91 180") || normalized.includes("91-180")) return "DAYS_91_180";
  if (normalized.includes("اكثر من 180") || normalized.includes("180+")) return "OVER_180";

  return "UNKNOWN";
}

function parseOptionalIsoDate(
  value: string | undefined,
  label: string,
  warnings: string[],
): string | undefined {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    warnings.push(`${label} غير قابل للتحويل تلقائيًا.`);
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
