import { classifyDocumentText } from "./classify-document";
import { normalizeCustomerRow } from "./customer-row";
import { normalizeDebtAgingRow } from "./debt-aging-row";
import type { DocumentClassification } from "./document-types";
import {
  extractPdfTableCandidates,
  type PdfPageText,
} from "./pdf-table-extractor";

export interface ProcessedExtractionRow {
  readonly rowType: "CUSTOMER" | "DEBT_AGING";
  readonly sourcePage: number;
  readonly sourceRow: number;
  readonly confidence: number;
  readonly rawData: Readonly<Record<string, string | number>>;
  readonly normalizedData: Readonly<Record<string, unknown>>;
  readonly validationStatus: "VALID" | "WARNING" | "INVALID";
  readonly warnings: readonly string[];
}

export interface ProcessPdfTextResult {
  readonly classification: DocumentClassification;
  readonly pageCount: number;
  readonly rows: readonly ProcessedExtractionRow[];
  readonly warningCount: number;
  readonly invalidCount: number;
  readonly requiresOcr: boolean;
}

export function processPdfTextPages(
  pages: readonly PdfPageText[],
): ProcessPdfTextResult {
  const combinedText = pages.map((page) => page.text).join("\n");
  const classification = classifyDocumentText(combinedText);
  const visibleCharacterCount = combinedText.replace(/\s/g, "").length;
  const requiresOcr = pages.length > 0 && visibleCharacterCount < pages.length * 20;

  if (classification.documentType === "UNKNOWN" || requiresOcr) {
    return Object.freeze({
      classification,
      pageCount: pages.length,
      rows: Object.freeze([]),
      warningCount: requiresOcr ? 1 : 0,
      invalidCount: 0,
      requiresOcr,
    });
  }

  const candidates = extractPdfTableCandidates(
    pages,
    classification.documentType,
  );

  const rows = candidates.map((candidate): ProcessedExtractionRow => {
    try {
      const normalized =
        candidate.rowType === "CUSTOMER"
          ? normalizeCustomerRow({
              ...candidate.rawData,
              sourcePage: candidate.sourcePage,
              sourceRow: candidate.sourceRow,
              confidence: candidate.confidence,
            })
          : normalizeDebtAgingRow({
              ...candidate.rawData,
              sourcePage: candidate.sourcePage,
              sourceRow: candidate.sourceRow,
              confidence: candidate.confidence,
            });

      const warnings = Object.freeze([
        ...candidate.warnings,
        ...normalized.warnings,
      ]);

      return Object.freeze({
        rowType: candidate.rowType,
        sourcePage: candidate.sourcePage,
        sourceRow: candidate.sourceRow,
        confidence: candidate.confidence,
        rawData: candidate.rawData,
        normalizedData: Object.freeze({ ...normalized }),
        validationStatus: warnings.length > 0 ? "WARNING" : "VALID",
        warnings,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "فشل غير معروف أثناء تطبيع الصف.";

      return Object.freeze({
        rowType: candidate.rowType,
        sourcePage: candidate.sourcePage,
        sourceRow: candidate.sourceRow,
        confidence: candidate.confidence,
        rawData: candidate.rawData,
        normalizedData: Object.freeze({}),
        validationStatus: "INVALID" as const,
        warnings: Object.freeze([...candidate.warnings, message]),
      });
    }
  });

  return Object.freeze({
    classification,
    pageCount: pages.length,
    rows: Object.freeze(rows),
    warningCount: rows.reduce(
      (total, row) => total + (row.validationStatus === "WARNING" ? 1 : 0),
      0,
    ),
    invalidCount: rows.reduce(
      (total, row) => total + (row.validationStatus === "INVALID" ? 1 : 0),
      0,
    ),
    requiresOcr: false,
  });
}
