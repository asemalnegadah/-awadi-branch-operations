import type {
  DocumentClassification,
  DocumentType,
} from "./document-types";

interface SignalDefinition {
  readonly phrase: string;
  readonly weight: number;
}

const signals: Readonly<Record<Exclude<DocumentType, "UNKNOWN">, readonly SignalDefinition[]>> = {
  CUSTOMER_LIST: [
    { phrase: "رقم العميل", weight: 3 },
    { phrase: "اسم العميل", weight: 3 },
    { phrase: "العميل", weight: 1 },
    { phrase: "الهاتف", weight: 2 },
    { phrase: "المندوب", weight: 2 },
    { phrase: "المنطقه", weight: 2 },
    { phrase: "العنوان", weight: 1 },
  ],
  DEBT_AGING: [
    { phrase: "اعمار الديون", weight: 6 },
    { phrase: "عمر الدين", weight: 5 },
    { phrase: "المديونيه", weight: 4 },
    { phrase: "الرصيد", weight: 3 },
    { phrase: "تاريخ الاستحقاق", weight: 4 },
    { phrase: "غير مستحق", weight: 3 },
    { phrase: "اكثر من 180", weight: 4 },
    { phrase: "91 180", weight: 3 },
    { phrase: "61 90", weight: 3 },
    { phrase: "31 60", weight: 3 },
    { phrase: "1 30", weight: 3 },
    { phrase: "الفاتوره", weight: 2 },
    { phrase: "المتبقي", weight: 3 },
  ],
  COLLECTIONS: [
    { phrase: "التحصيلات", weight: 5 },
    { phrase: "سند قبض", weight: 4 },
    { phrase: "رقم السند", weight: 4 },
    { phrase: "المبلغ المحصل", weight: 4 },
  ],
  SALES: [
    { phrase: "المبيعات", weight: 5 },
    { phrase: "فاتوره بيع", weight: 4 },
    { phrase: "الصنف", weight: 3 },
    { phrase: "الكميه", weight: 3 },
  ],
  PROMISES: [
    { phrase: "وعود السداد", weight: 5 },
    { phrase: "وعد السداد", weight: 5 },
    { phrase: "تاريخ الوعد", weight: 4 },
  ],
  INVENTORY: [
    { phrase: "المخزون", weight: 5 },
    { phrase: "رصيد الصنف", weight: 4 },
    { phrase: "المستودع", weight: 3 },
  ],
  RECONCILIATION: [
    { phrase: "المطابقه", weight: 5 },
    { phrase: "رصيد العميل", weight: 4 },
    { phrase: "رصيد النظام", weight: 4 },
    { phrase: "الفرق", weight: 2 },
  ],
};

export function classifyDocumentText(text: string): DocumentClassification {
  const normalized = normalizeExtractionText(text);

  if (!normalized) {
    return Object.freeze({
      documentType: "UNKNOWN",
      confidence: 0,
      matchedSignals: Object.freeze([]),
    });
  }

  const scored = Object.entries(signals).map(([documentType, definitions]) => {
    const matchedSignals: string[] = [];
    let score = 0;
    let possible = 0;

    for (const definition of definitions) {
      possible += definition.weight;
      if (normalized.includes(definition.phrase)) {
        score += definition.weight;
        matchedSignals.push(definition.phrase);
      }
    }

    return {
      documentType: documentType as Exclude<DocumentType, "UNKNOWN">,
      score,
      possible,
      matchedSignals,
    };
  });

  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 4) {
    return Object.freeze({
      documentType: "UNKNOWN",
      confidence: 0,
      matchedSignals: Object.freeze([]),
    });
  }

  const coverage = best.score / best.possible;
  const separation = second ? Math.max(0, best.score - second.score) / best.score : 1;
  const confidence = clamp(coverage * 0.7 + separation * 0.3, 0, 1);

  return Object.freeze({
    documentType: best.documentType,
    confidence: round4(confidence),
    matchedSignals: Object.freeze(best.matchedSignals),
  });
}

export function normalizeExtractionText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
