import type { DocumentType } from "./document-types";
import { normalizeExtractionText } from "./classify-document";

export interface PdfPageText {
  readonly pageNumber: number;
  readonly text: string;
}

export interface ExtractedTableCandidate {
  readonly rowType: "CUSTOMER" | "DEBT_AGING";
  readonly sourcePage: number;
  readonly sourceRow: number;
  readonly confidence: number;
  readonly rawData: Readonly<Record<string, string | number>>;
  readonly warnings: readonly string[];
}

type CanonicalField =
  | "customerNumber"
  | "customerName"
  | "ownerName"
  | "representativeName"
  | "phone"
  | "whatsapp"
  | "areaName"
  | "address"
  | "currency"
  | "originalAmount"
  | "remainingAmount"
  | "invoiceNumber"
  | "invoiceDate"
  | "dueDate"
  | "ageDays"
  | "agingBucket";

const headerAliases: Readonly<Record<CanonicalField, readonly string[]>> = {
  customerNumber: ["رقم العميل", "كود العميل", "رقم الحساب", "customer no"],
  customerName: ["اسم العميل", "العميل", "customer name"],
  ownerName: ["اسم المالك", "المالك"],
  representativeName: ["اسم المندوب", "المندوب", "مندوب المبيعات"],
  phone: ["رقم الهاتف", "الهاتف", "تلفون", "جوال"],
  whatsapp: ["واتساب", "رقم الواتساب"],
  areaName: ["المنطقه", "المنطقة", "الحي"],
  address: ["العنوان", "الموقع"],
  currency: ["العمله", "العملة", "currency"],
  originalAmount: ["المبلغ الاصلي", "اصل الدين", "اجمالي الفاتوره"],
  remainingAmount: ["الرصيد المتبقي", "المتبقي", "الرصيد", "المديونيه", "المديونية"],
  invoiceNumber: ["رقم الفاتوره", "رقم الفاتورة", "الفاتوره", "الفاتورة"],
  invoiceDate: ["تاريخ الفاتوره", "تاريخ الفاتورة"],
  dueDate: ["تاريخ الاستحقاق", "الاستحقاق"],
  ageDays: ["عمر الدين", "عدد الايام", "الأيام", "الايام"],
  agingBucket: ["فئه العمر", "فئة العمر", "اعمار الديون", "أعمار الديون"],
};

const customerRequiredFields: readonly CanonicalField[] = ["customerName"];
const debtRequiredFields: readonly CanonicalField[] = [
  "customerName",
  "currency",
  "remainingAmount",
];

export function extractPdfTableCandidates(
  pages: readonly PdfPageText[],
  documentType: DocumentType,
): readonly ExtractedTableCandidate[] {
  if (documentType !== "CUSTOMER_LIST" && documentType !== "DEBT_AGING") {
    return Object.freeze([]);
  }

  const results: ExtractedTableCandidate[] = [];

  for (const page of pages) {
    const lines = page.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    let headerMap: ReadonlyMap<number, CanonicalField> | undefined;

    lines.forEach((line, lineIndex) => {
      const cells = splitTableLine(line);
      if (cells.length < 2) {
        return;
      }

      const possibleHeader = buildHeaderMap(cells);
      const requiredFields =
        documentType === "DEBT_AGING" ? debtRequiredFields : customerRequiredFields;

      if (containsRequiredFields(possibleHeader, requiredFields)) {
        headerMap = possibleHeader;
        return;
      }

      if (!headerMap || isSummaryLine(line)) {
        return;
      }

      const rawData: Record<string, string | number> = {
        sourcePage: page.pageNumber,
        sourceRow: lineIndex + 1,
      };

      for (const [columnIndex, field] of headerMap.entries()) {
        const value = cells[columnIndex]?.trim();
        if (value) {
          rawData[field] = value;
        }
      }

      if (!hasText(rawData.customerName)) {
        return;
      }

      const warnings: string[] = [];
      const populatedFields = Object.keys(rawData).length - 2;
      const mappedFields = headerMap.size;
      const completeness = mappedFields === 0 ? 0 : populatedFields / mappedFields;

      if (cells.length < mappedFields) {
        warnings.push("عدد خلايا الصف أقل من عدد أعمدة العنوان.");
      }

      if (documentType === "DEBT_AGING") {
        if (!hasText(rawData.currency)) {
          warnings.push("العملة غير موجودة في صف الدين.");
        }
        if (!hasText(rawData.remainingAmount)) {
          warnings.push("الرصيد المتبقي غير موجود في صف الدين.");
        }
      }

      results.push(
        Object.freeze({
          rowType: documentType === "DEBT_AGING" ? "DEBT_AGING" : "CUSTOMER",
          sourcePage: page.pageNumber,
          sourceRow: lineIndex + 1,
          confidence: round4(Math.max(0.25, Math.min(0.98, completeness))),
          rawData: Object.freeze(rawData),
          warnings: Object.freeze(warnings),
        }),
      );
    });
  }

  return Object.freeze(results);
}

function buildHeaderMap(cells: readonly string[]): ReadonlyMap<number, CanonicalField> {
  const map = new Map<number, CanonicalField>();

  cells.forEach((cell, index) => {
    const normalizedCell = normalizeExtractionText(cell);

    for (const [field, aliases] of Object.entries(headerAliases)) {
      if (aliases.some((alias) => normalizedCell === normalizeExtractionText(alias))) {
        map.set(index, field as CanonicalField);
        break;
      }
    }
  });

  return map;
}

function containsRequiredFields(
  map: ReadonlyMap<number, CanonicalField>,
  requiredFields: readonly CanonicalField[],
): boolean {
  const mapped = new Set(map.values());
  return requiredFields.every((field) => mapped.has(field));
}

function splitTableLine(line: string): readonly string[] {
  if (line.includes("\t")) {
    return line.split(/\t+/).map((cell) => cell.trim());
  }

  if (line.includes("|")) {
    return line.split("|").map((cell) => cell.trim()).filter(Boolean);
  }

  return line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function isSummaryLine(line: string): boolean {
  const normalized = normalizeExtractionText(line);
  return (
    normalized.startsWith("الاجمالي") ||
    normalized.startsWith("المجموع") ||
    normalized.startsWith("اجمالي")
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
