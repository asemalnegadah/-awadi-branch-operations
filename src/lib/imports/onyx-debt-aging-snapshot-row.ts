import { currencyDefinitions, type CurrencyCode } from "@/lib/domain/currency";

import type { OnyxDebtAgingCoordinateRow } from "./onyx-coordinate-parser";
import { parseLocalizedMoneyToMinor } from "./localized-number";

export interface OnyxDebtAgingBucketAmounts {
  readonly days0To30Minor: number;
  readonly days31To60Minor: number;
  readonly days61To90Minor: number;
  readonly days91To120Minor: number;
  readonly over120Minor: number;
}

export interface NormalizedOnyxDebtAgingSnapshotRow {
  readonly customerNumber: string;
  readonly extractedCustomerName: string;
  readonly representativeCode?: string | undefined;
  readonly currency: CurrencyCode;
  readonly reportAsOfDate: string;
  readonly rowIdentity: string;
  readonly amountMinor?: number | undefined;
  readonly localAmountMinor?: number | undefined;
  readonly totalDueMinor: number;
  readonly aging: OnyxDebtAgingBucketAmounts;
  readonly sourcePage: number;
  readonly sourceY: number;
  readonly warnings: readonly string[];
}

export function normalizeOnyxDebtAgingSnapshotRow(
  row: OnyxDebtAgingCoordinateRow,
  reportAsOfDate: string,
): NormalizedOnyxDebtAgingSnapshotRow {
  assertIsoDate(reportAsOfDate);

  const decimalPlaces = currencyDefinitions[row.currency].decimalPlaces;
  const warnings = [...row.warnings];
  const amountMinor = parseOptionalAmount(row.amount, decimalPlaces);
  const localAmountMinor = parseOptionalAmount(row.localAmount, decimalPlaces);
  const aging = Object.freeze({
    days0To30Minor: parseBlankAsZero(row.days0To30, decimalPlaces),
    days31To60Minor: parseBlankAsZero(row.days31To60, decimalPlaces),
    days61To90Minor: parseBlankAsZero(row.days61To90, decimalPlaces),
    days91To120Minor: parseBlankAsZero(row.days91To120, decimalPlaces),
    over120Minor: parseBlankAsZero(row.over120, decimalPlaces),
  });
  const bucketSumMinor = sumSafeIntegers(Object.values(aging));
  const statedTotalDueMinor = parseOptionalAmount(row.totalDue, decimalPlaces);
  const totalDueMinor = statedTotalDueMinor ?? amountMinor ?? bucketSumMinor;

  if (statedTotalDueMinor !== undefined && statedTotalDueMinor !== bucketSumMinor) {
    warnings.push(
      `مجموع فئات عمر الدين (${bucketSumMinor}) لا يطابق إجمالي المستحق (${statedTotalDueMinor}).`,
    );
  }

  if (
    amountMinor !== undefined &&
    statedTotalDueMinor !== undefined &&
    amountMinor !== statedTotalDueMinor
  ) {
    warnings.push("عمود المبلغ لا يطابق إجمالي المستحق في الصف.");
  }

  if (totalDueMinor !== 0 && bucketSumMinor === 0) {
    warnings.push("إجمالي الدين موجود لكن جميع فئات الأعمار فارغة أو صفرية.");
  }

  if (totalDueMinor < 0) {
    warnings.push("إجمالي الصف سالب ويعامل كرصيد دائن يحتاج مراجعة.");
  }

  if (Object.values(aging).some((value) => value < 0)) {
    warnings.push("إحدى فئات أعمار الدين سالبة وتحتاج مراجعة.");
  }

  if (looksVisiblyTruncated(row.customerName)) {
    warnings.push(
      "اسم العميل يبدو مقطوعًا في PDF؛ تتم المطابقة برقم العميل والعملة.",
    );
  }

  return Object.freeze({
    customerNumber: row.customerNumber,
    extractedCustomerName: row.customerName,
    representativeCode: row.representativeCode,
    currency: row.currency,
    reportAsOfDate,
    rowIdentity: `${row.customerNumber}|${row.currency}|${reportAsOfDate}`,
    amountMinor,
    localAmountMinor,
    totalDueMinor,
    aging,
    sourcePage: row.sourcePage,
    sourceY: row.sourceY,
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

function parseOptionalAmount(
  value: string | undefined,
  decimalPlaces: number,
): number | undefined {
  const normalized = value?.trim();
  return normalized
    ? parseLocalizedMoneyToMinor(normalized, decimalPlaces)
    : undefined;
}

function parseBlankAsZero(
  value: string | undefined,
  decimalPlaces: number,
): number {
  return parseOptionalAmount(value, decimalPlaces) ?? 0;
}

function sumSafeIntegers(values: readonly number[]): number {
  let total = 0;

  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new Error("مجموع أعمار الدين يتجاوز النطاق الرقمي الآمن.");
    }
  }

  return total;
}

function looksVisiblyTruncated(value: string): boolean {
  const trimmed = value.trim();
  return /(?:\.{2,}|…|ـ)$/.test(trimmed);
}

function assertIsoDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("تاريخ قطع التقرير غير صالح.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("تاريخ قطع التقرير غير صالح.");
  }
}
