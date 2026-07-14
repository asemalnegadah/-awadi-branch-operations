import { z } from "zod";

import { assertCurrencyCode, type CurrencyCode } from "@/lib/domain/currency";

import {
  agingBucketCodes,
  deriveAgingBucketForScheme,
  parseAgingBucketForScheme,
  type AgingBucketCode,
  type AgingSchemeCode,
} from "./aging-scheme";
import { parseLocalizedMoneyToMinor } from "./localized-number";

export const agingBuckets = agingBucketCodes;
export type AgingBucket = AgingBucketCode;

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
  readonly agingScheme: AgingSchemeCode;
  readonly sourcePage: number;
  readonly sourceRow: number;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

export function normalizeDebtAgingRow(
  rawInput: unknown,
  decimalPlaces = 2,
  agingScheme: AgingSchemeCode = "STANDARD_0_30_60_90_180",
): NormalizedDebtAgingRow {
  const raw = rawDebtAgingRowSchema.parse(rawInput);
  const warnings: string[] = [];
  const currency = assertCurrencyCode(raw.currency.toUpperCase());
  const ageDays = parseOptionalAgeDays(raw.ageDays);
  const derivedBucket = deriveAgingBucketForScheme(ageDays, agingScheme);
  const statedBucket = parseAgingBucketForScheme(raw.agingBucket, agingScheme);

  if (
    statedBucket !== "UNKNOWN" &&
    derivedBucket !== "UNKNOWN" &&
    statedBucket !== derivedBucket
  ) {
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

  const invoiceDate = parseOptionalIsoDate(
    raw.invoiceDate,
    "تاريخ الفاتورة",
    warnings,
  );
  const dueDate = parseOptionalIsoDate(
    raw.dueDate,
    "تاريخ الاستحقاق",
    warnings,
  );

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
    agingScheme,
    sourcePage: raw.sourcePage,
    sourceRow: raw.sourceRow,
    confidence: raw.confidence,
    warnings: Object.freeze(warnings),
  });
}

export function deriveAgingBucket(
  ageDays: number | undefined,
  agingScheme: AgingSchemeCode = "STANDARD_0_30_60_90_180",
): AgingBucket {
  return deriveAgingBucketForScheme(ageDays, agingScheme);
}

function parseOptionalAgeDays(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number(value.replace(/\s+/g, ""));
  if (!Number.isInteger(parsed) || parsed < -3650 || parsed > 36500) {
    throw new Error("عمر الدين المستخرج غير صالح.");
  }

  return parsed;
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
