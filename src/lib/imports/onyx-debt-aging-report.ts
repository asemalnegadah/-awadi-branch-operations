import type { CurrencyCode } from "@/lib/domain/currency";

import type { AgingSchemeCode } from "./aging-scheme";

export interface OnyxDebtAgingReportMetadata {
  readonly reportType: "DEBT_AGING";
  readonly sourceSystem: "ONYX";
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOfDate: string;
  readonly generatedAt?: string | undefined;
  readonly declaredPageCount?: number | undefined;
  readonly representativeCode?: string | undefined;
  readonly currencies: readonly CurrencyCode[];
  readonly agingScheme: AgingSchemeCode;
  readonly reportSeriesKey: string;
  readonly warnings: readonly string[];
}

export function parseOnyxDebtAgingReportMetadata(
  rawText: string,
): OnyxDebtAgingReportMetadata {
  const normalizedDigits = normalizeArabicDigits(rawText).normalize("NFKC");
  const warnings: string[] = [];

  if (!/اعمار\s+الديون\s+للعملاء|أعمار\s+الديون\s+للعملاء/.test(normalizedDigits)) {
    throw new Error("المستند لا يحمل عنوان كشف أعمار الديون للعملاء.");
  }

  const period = extractPeriod(normalizedDigits);
  const generatedAt = extractGeneratedAt(normalizedDigits);
  const declaredPageCount = extractDeclaredPageCount(normalizedDigits);
  const representativeCode = extractRepresentativeCode(normalizedDigits);
  const currencies = extractCurrencies(normalizedDigits);
  const agingScheme = detectAgingScheme(normalizedDigits);

  if (!generatedAt) {
    warnings.push("تعذر استخراج تاريخ ووقت طباعة التقرير.");
  }

  if (!declaredPageCount) {
    warnings.push("تعذر استخراج عدد صفحات التقرير.");
  }

  if (!representativeCode) {
    warnings.push("تعذر تحديد كود مندوب واحد من التقرير.");
  }

  if (currencies.length === 0) {
    warnings.push("لم يتم العثور على عملة SR أو RG في التقرير.");
  }

  const scopePart = representativeCode
    ? `REP:${representativeCode}`
    : "REP:UNKNOWN";
  const currencyPart = currencies.length
    ? `CUR:${currencies.join(",")}`
    : "CUR:UNKNOWN";

  return Object.freeze({
    reportType: "DEBT_AGING",
    sourceSystem: "ONYX",
    periodStart: period.start,
    periodEnd: period.end,
    asOfDate: period.end,
    generatedAt,
    declaredPageCount,
    representativeCode,
    currencies: Object.freeze(currencies),
    agingScheme,
    reportSeriesKey: [
      "ONYX",
      "DEBT_AGING",
      scopePart,
      currencyPart,
      `START:${period.start}`,
      `SCHEME:${agingScheme}`,
    ].join("|"),
    warnings: Object.freeze(warnings),
  });
}

function extractPeriod(text: string): { start: string; end: string } {
  const match = text.match(
    /من\s*تاريخ\s*[:：]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\s*(?:الى|إلى)\s*تاريخ\s*[:：]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/,
  );

  if (!match?.[1] || !match[2]) {
    throw new Error("تعذر استخراج بداية ونهاية فترة كشف أعمار الديون.");
  }

  const start = parseDayFirstDate(match[1]);
  const end = parseDayFirstDate(match[2]);

  if (start > end) {
    throw new Error("بداية فترة كشف الديون تقع بعد نهايتها.");
  }

  return { start, end };
}

function extractGeneratedAt(text: string): string | undefined {
  const dateTimeMatches = Array.from(
    text.matchAll(
      /(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\s+(\d{1,2}:\d{2}:\d{2})\s*(AM|PM|ص|م)?/gi,
    ),
  );

  const candidate = dateTimeMatches.at(-1);
  if (!candidate?.[1] || !candidate[2]) {
    return undefined;
  }

  const date = parseDayFirstDate(candidate[1]);
  const time = convertTo24Hour(candidate[2], candidate[3]);
  return `${date}T${time}+03:00`;
}

function extractDeclaredPageCount(text: string): number | undefined {
  const matches = Array.from(text.matchAll(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g));
  const totals = matches
    .map((match) => {
      const left = Number(match[1]);
      const right = Number(match[2]);
      return Math.max(left, right);
    })
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 1000);

  return totals.length ? Math.max(...totals) : undefined;
}

function extractRepresentativeCode(text: string): string | undefined {
  const shortNumericLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{1,4}$/.test(line));

  if (shortNumericLines.length === 0) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const value of shortNumericLines) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (!winner || winner[1] < 2) {
    return undefined;
  }

  if (runnerUp && runnerUp[1] === winner[1]) {
    return undefined;
  }

  return winner[0];
}

function extractCurrencies(text: string): CurrencyCode[] {
  const found = new Set<CurrencyCode>();

  for (const line of text.split(/\r?\n/)) {
    const value = line.trim().toUpperCase();
    if (value === "SR" || value === "RG") {
      found.add(value);
    }
  }

  return ["SR", "RG"].filter((currency): currency is CurrencyCode =>
    found.has(currency as CurrencyCode),
  );
}

function detectAgingScheme(text: string): AgingSchemeCode {
  const compact = text.replace(/\s+/g, " ");
  const hasRange = (left: number, right: number): boolean =>
    new RegExp(`(?:${left}\\s*-\\s*${right}|${right}\\s*-\\s*${left})`).test(
      compact,
    );

  const has120 =
    hasRange(0, 30) &&
    hasRange(31, 60) &&
    hasRange(61, 90) &&
    hasRange(91, 120) &&
    /(?:>\s*120|120\s*<)/.test(compact);

  return has120
    ? "ONYX_0_30_60_90_120"
    : "STANDARD_0_30_60_90_180";
}

function parseDayFirstDate(value: string): string {
  const [dayText, monthText, yearText] = value.split(/[\/-]/);
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error(`تاريخ غير صالح داخل التقرير: ${value}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`تاريخ غير صالح داخل التقرير: ${value}`);
  }

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function convertTo24Hour(time: string, marker: string | undefined): string {
  const [hourText, minuteText, secondText] = time.split(":");
  let hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new Error(`وقت غير صالح داخل التقرير: ${time}`);
  }

  const normalizedMarker = marker?.toUpperCase();
  if (normalizedMarker === "PM" || marker === "م") {
    if (hour < 12) hour += 12;
  } else if (normalizedMarker === "AM" || marker === "ص") {
    if (hour === 12) hour = 0;
  }

  if (hour < 0 || hour > 23) {
    throw new Error(`وقت غير صالح داخل التقرير: ${time}`);
  }

  return `${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}:${second.toString().padStart(2, "0")}`;
}

function normalizeArabicDigits(value: string): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";

  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)));
}
