import { z } from "zod";

import { normalizeArabicName, normalizeCustomerNumber, normalizePhone } from "@/lib/customers/identity";

export const rawCustomerRowSchema = z.object({
  customerNumber: z.string().trim().optional(),
  customerName: z.string().trim().min(1),
  ownerName: z.string().trim().optional(),
  representativeName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  whatsapp: z.string().trim().optional(),
  areaName: z.string().trim().optional(),
  address: z.string().trim().optional(),
  sourcePage: z.number().int().positive(),
  sourceRow: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

export type RawCustomerRow = z.infer<typeof rawCustomerRowSchema>;

export interface NormalizedCustomerRow {
  readonly customerNumber?: string | undefined;
  readonly customerName: string;
  readonly normalizedCustomerName: string;
  readonly ownerName?: string | undefined;
  readonly representativeName?: string | undefined;
  readonly phone?: string | undefined;
  readonly whatsapp?: string | undefined;
  readonly areaName?: string | undefined;
  readonly address?: string | undefined;
  readonly sourcePage: number;
  readonly sourceRow: number;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

export function normalizeCustomerRow(rawInput: unknown): NormalizedCustomerRow {
  const raw = rawCustomerRowSchema.parse(rawInput);
  const warnings: string[] = [];
  const customerNumber = raw.customerNumber
    ? normalizeCustomerNumber(raw.customerNumber)
    : undefined;
  const phone = raw.phone ? normalizePhone(raw.phone) : undefined;
  const whatsapp = raw.whatsapp ? normalizePhone(raw.whatsapp) : undefined;
  const normalizedCustomerName = normalizeArabicName(raw.customerName);

  if (!customerNumber) {
    warnings.push("رقم العميل غير موجود.");
  }

  if (!phone && !whatsapp) {
    warnings.push("لا يوجد هاتف أو واتساب للعميل.");
  }

  if (normalizedCustomerName.length < 2) {
    throw new Error("اسم العميل المستخرج غير صالح.");
  }

  return Object.freeze({
    customerNumber,
    customerName: raw.customerName.trim(),
    normalizedCustomerName,
    ownerName: normalizeOptional(raw.ownerName),
    representativeName: normalizeOptional(raw.representativeName),
    phone: phone || undefined,
    whatsapp: whatsapp || undefined,
    areaName: normalizeOptional(raw.areaName),
    address: normalizeOptional(raw.address),
    sourcePage: raw.sourcePage,
    sourceRow: raw.sourceRow,
    confidence: raw.confidence,
    warnings: Object.freeze(warnings),
  });
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
