import { inspectPdfUpload, type InspectedPdfUpload } from "./inspect-pdf-upload";
import {
  normalizeOnyxDebtAgingSnapshotRow,
  type NormalizedOnyxDebtAgingSnapshotRow,
} from "./onyx-debt-aging-snapshot-row";
import {
  extractOnyxDebtRowsFromCoordinates,
  type OnyxDebtAgingCoordinateRow,
} from "./onyx-coordinate-parser";
import {
  parseOnyxDebtAgingReportMetadata,
  type OnyxDebtAgingReportMetadata,
} from "./onyx-debt-aging-report";
import {
  extractPositionedTextWithPdfJs,
  type PdfJsPositionedExtraction,
} from "./pdfjs-positioned-extractor";
import type { PdfPositionedTextItem } from "./pdf-positioned-text";

export type ProcessedOnyxRowStatus =
  | "VALID"
  | "WARNING"
  | "INVALID"
  | "CONFLICT";

export interface ProcessedOnyxDebtAgingRow {
  readonly rowIndex: number;
  readonly status: ProcessedOnyxRowStatus;
  readonly raw: OnyxDebtAgingCoordinateRow;
  readonly normalized?: NormalizedOnyxDebtAgingSnapshotRow | undefined;
  readonly warnings: readonly string[];
}

export interface ProcessOnyxDebtAgingPdfInput {
  readonly originalName: string;
  readonly bytes: Uint8Array;
  readonly declaredMediaType?: string | undefined;
  readonly declaredSizeBytes?: number | undefined;
}

export interface ProcessedOnyxDebtAgingPdf {
  readonly status: "REVIEW_REQUIRED" | "OCR_REQUIRED";
  readonly inspection: InspectedPdfUpload;
  readonly extraction: PdfJsPositionedExtraction;
  readonly metadata?: OnyxDebtAgingReportMetadata | undefined;
  readonly rows: readonly ProcessedOnyxDebtAgingRow[];
  readonly validCount: number;
  readonly warningCount: number;
  readonly invalidCount: number;
  readonly conflictCount: number;
  readonly warnings: readonly string[];
}

export async function processOnyxDebtAgingPdfBytes(
  input: ProcessOnyxDebtAgingPdfInput,
): Promise<ProcessedOnyxDebtAgingPdf> {
  const inspection = inspectPdfUpload(input);
  const extraction = await extractPositionedTextWithPdfJs(input.bytes);

  if (extraction.requiresOcr) {
    return Object.freeze({
      status: "OCR_REQUIRED" as const,
      inspection,
      extraction,
      rows: Object.freeze([]),
      validCount: 0,
      warningCount: 0,
      invalidCount: 0,
      conflictCount: 0,
      warnings: Object.freeze([
        ...inspection.warnings,
        ...extraction.warnings,
      ]),
    });
  }

  const metadata = parseMetadataFromAvailableText(extraction);
  const rawRows = extractOnyxDebtRowsFromCoordinates(extraction.document.items);

  if (rawRows.length === 0) {
    throw new Error(
      "تم التعرف على كشف Onyx، لكن لم يمكن إعادة تكوين أي صف مديونية من الإحداثيات.",
    );
  }

  const processedRows = rawRows.map(
    (raw, rowIndex): ProcessedOnyxDebtAgingRow => {
      try {
        const normalized = normalizeOnyxDebtAgingSnapshotRow(
          raw,
          metadata.asOfDate,
        );
        const warnings = collectRowWarnings(raw, normalized, metadata);

        return Object.freeze({
          rowIndex,
          status: warnings.length > 0 ? "WARNING" : "VALID",
          raw,
          normalized,
          warnings: Object.freeze(warnings),
        });
      } catch (error) {
        return Object.freeze({
          rowIndex,
          status: "INVALID" as const,
          raw,
          warnings: Object.freeze([
            error instanceof Error
              ? error.message
              : "فشل غير معروف أثناء تطبيع صف أعمار الديون.",
          ]),
        });
      }
    },
  );

  const rowsWithConflicts = markDuplicateRowIdentities(processedRows);
  const fileWarnings = [
    ...inspection.warnings,
    ...extraction.warnings,
    ...metadata.warnings,
  ];

  if (
    metadata.declaredPageCount !== undefined &&
    metadata.declaredPageCount !== extraction.pageCount
  ) {
    fileWarnings.push(
      `عدد صفحات التقرير المعلن (${metadata.declaredPageCount}) لا يطابق الصفحات المقروءة (${extraction.pageCount}).`,
    );
  }

  const extractedCurrencies = new Set(
    rowsWithConflicts
      .map((row) => row.normalized?.currency)
      .filter((currency): currency is "SR" | "RG" => Boolean(currency)),
  );
  const missingDeclaredCurrencies = metadata.currencies.filter(
    (currency) => !extractedCurrencies.has(currency),
  );

  if (missingDeclaredCurrencies.length > 0) {
    fileWarnings.push(
      `لم يتم تكوين صفوف للعملات الموجودة في رأس التقرير: ${missingDeclaredCurrencies.join(", ")}.`,
    );
  }

  return Object.freeze({
    status: "REVIEW_REQUIRED" as const,
    inspection,
    extraction,
    metadata,
    rows: Object.freeze(rowsWithConflicts),
    validCount: countStatus(rowsWithConflicts, "VALID"),
    warningCount: countStatus(rowsWithConflicts, "WARNING"),
    invalidCount: countStatus(rowsWithConflicts, "INVALID"),
    conflictCount: countStatus(rowsWithConflicts, "CONFLICT"),
    warnings: Object.freeze([...new Set(fileWarnings)]),
  });
}

function parseMetadataFromAvailableText(
  extraction: PdfJsPositionedExtraction,
): OnyxDebtAgingReportMetadata {
  const candidates = [
    extraction.pageTexts.map((page) => page.text).join("\n"),
    renderPositionedLines(extraction.document.items, "DESCENDING_X"),
    renderPositionedLines(extraction.document.items, "ASCENDING_X"),
  ];
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      return parseOnyxDebtAgingReportMetadata(candidate);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "فشل تحليل بيانات التقرير.");
    }
  }

  throw new Error(
    `تعذر استخراج بيانات فترة كشف Onyx من جميع طرق ترتيب النص: ${[
      ...new Set(errors),
    ].join(" | ")}`,
  );
}

function renderPositionedLines(
  items: readonly PdfPositionedTextItem[],
  xOrder: "ASCENDING_X" | "DESCENDING_X",
): string {
  const tolerance = 3;
  const sorted = [...items].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      right.y - left.y ||
      (xOrder === "ASCENDING_X" ? left.x - right.x : right.x - left.x),
  );
  const lines: Array<{
    pageNumber: number;
    y: number;
    items: PdfPositionedTextItem[];
  }> = [];

  for (const item of sorted) {
    const candidate = lines.at(-1);
    if (
      candidate &&
      candidate.pageNumber === item.pageNumber &&
      Math.abs(candidate.y - item.y) <= tolerance
    ) {
      candidate.items.push(item);
      candidate.y =
        candidate.items.reduce((total, current) => total + current.y, 0) /
        candidate.items.length;
      continue;
    }

    lines.push({ pageNumber: item.pageNumber, y: item.y, items: [item] });
  }

  return lines
    .map((line) =>
      [...line.items]
        .sort((left, right) =>
          xOrder === "ASCENDING_X" ? left.x - right.x : right.x - left.x,
        )
        .map((item) => item.text)
        .join(" "),
    )
    .join("\n");
}

function collectRowWarnings(
  raw: OnyxDebtAgingCoordinateRow,
  normalized: NormalizedOnyxDebtAgingSnapshotRow,
  metadata: OnyxDebtAgingReportMetadata,
): string[] {
  const warnings = [...normalized.warnings];

  if (
    metadata.representativeCode &&
    raw.representativeCode &&
    metadata.representativeCode !== raw.representativeCode
  ) {
    warnings.push(
      `كود مندوب الصف (${raw.representativeCode}) يختلف عن كود التقرير (${metadata.representativeCode}).`,
    );
  }

  if (!metadata.currencies.includes(raw.currency)) {
    warnings.push(`عملة الصف ${raw.currency} غير معلنة في نطاق التقرير.`);
  }

  return [...new Set(warnings)];
}

function markDuplicateRowIdentities(
  rows: readonly ProcessedOnyxDebtAgingRow[],
): ProcessedOnyxDebtAgingRow[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const identity = row.normalized?.rowIdentity;
    if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }

  return rows.map((row) => {
    const identity = row.normalized?.rowIdentity;
    if (!identity || (counts.get(identity) ?? 0) <= 1) {
      return row;
    }

    return Object.freeze({
      ...row,
      status: "CONFLICT" as const,
      warnings: Object.freeze([
        ...row.warnings,
        "تكرر رقم العميل والعملة في تاريخ القطع نفسه؛ يجب مراجعة الصفوف المتعارضة.",
      ]),
    });
  });
}

function countStatus(
  rows: readonly ProcessedOnyxDebtAgingRow[],
  status: ProcessedOnyxRowStatus,
): number {
  return rows.reduce((total, row) => total + (row.status === status ? 1 : 0), 0);
}
