import type {
  PdfPageGeometry,
  PdfPositionedDocument,
  PdfPositionedTextItem,
} from "./pdf-positioned-text";

const DEFAULT_MAX_PAGES = 500;
const DEFAULT_MAX_TEXT_ITEMS = 500_000;

export interface PdfJsExtractionOptions {
  readonly maxPages?: number | undefined;
  readonly maxTextItems?: number | undefined;
}

export interface PdfJsPositionedExtraction {
  readonly document: PdfPositionedDocument;
  readonly pageTexts: readonly {
    readonly pageNumber: number;
    readonly text: string;
  }[];
  readonly pageCount: number;
  readonly textItemCount: number;
  readonly visibleCharacterCount: number;
  readonly requiresOcr: boolean;
  readonly warnings: readonly string[];
}

export class PdfExtractionError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfExtractionError";
    this.code = code;
  }
}

export async function extractPositionedTextWithPdfJs(
  bytes: Uint8Array,
  options: PdfJsExtractionOptions = {},
): Promise<PdfJsPositionedExtraction> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxTextItems = options.maxTextItems ?? DEFAULT_MAX_TEXT_ITEMS;

  if (!Number.isInteger(maxPages) || maxPages <= 0) {
    throw new Error("الحد الأقصى لصفحات PDF غير صالح.");
  }

  if (!Number.isInteger(maxTextItems) || maxTextItems <= 0) {
    throw new Error("الحد الأقصى لعناصر نص PDF غير صالح.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    stopAtErrors: false,
  });

  let pdf: Awaited<typeof loadingTask.promise> | undefined;

  try {
    pdf = await loadingTask.promise;

    if (pdf.numPages > maxPages) {
      throw new PdfExtractionError(
        "PAGE_LIMIT_EXCEEDED",
        `عدد صفحات PDF (${pdf.numPages}) يتجاوز الحد المسموح (${maxPages}).`,
      );
    }

    const pages: PdfPageGeometry[] = [];
    const items: PdfPositionedTextItem[] = [];
    const pageTexts: Array<{ pageNumber: number; text: string }> = [];
    let visibleCharacterCount = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      const logicalTextParts: string[] = [];

      pages.push(
        Object.freeze({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
        }),
      );

      for (const rawItem of textContent.items) {
        if (!("str" in rawItem) || !rawItem.str.trim()) {
          continue;
        }

        if (items.length >= maxTextItems) {
          throw new PdfExtractionError(
            "TEXT_ITEM_LIMIT_EXCEEDED",
            `عدد عناصر النص في PDF يتجاوز الحد المسموح (${maxTextItems}).`,
          );
        }

        const transform = rawItem.transform;
        const height =
          rawItem.height > 0
            ? rawItem.height
            : Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
        const text = rawItem.str.trim();

        items.push(
          Object.freeze({
            pageNumber,
            text,
            x: finiteCoordinate(transform[4], "x"),
            y: finiteCoordinate(transform[5], "y"),
            width: finiteNonNegative(rawItem.width, "width"),
            height: finiteNonNegative(height, "height"),
          }),
        );
        logicalTextParts.push(text);
        visibleCharacterCount += text.replace(/\s/g, "").length;
      }

      pageTexts.push(
        Object.freeze({
          pageNumber,
          text: logicalTextParts.join("\n"),
        }),
      );
      page.cleanup();
    }

    const minimumUsefulCharacters = Math.max(5, pdf.numPages * 3);
    const requiresOcr =
      pdf.numPages > 0 &&
      (items.length === 0 || visibleCharacterCount < minimumUsefulCharacters);
    const warnings = requiresOcr
      ? ["لا يحتوي PDF على نص كافٍ؛ يحتاج إلى OCR قبل استخراج الصفوف."]
      : [];

    return Object.freeze({
      document: Object.freeze({
        pages: Object.freeze(pages),
        items: Object.freeze(items),
      }),
      pageTexts: Object.freeze(pageTexts),
      pageCount: pdf.numPages,
      textItemCount: items.length,
      visibleCharacterCount,
      requiresOcr,
      warnings: Object.freeze(warnings),
    });
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      throw error;
    }

    const errorName =
      error && typeof error === "object" && "name" in error
        ? String(error.name)
        : "";

    if (errorName === "PasswordException") {
      throw new PdfExtractionError(
        "PASSWORD_PROTECTED_PDF",
        "ملف PDF محمي بكلمة مرور ولا يمكن استخراجه تلقائيًا.",
        { cause: error },
      );
    }

    throw new PdfExtractionError(
      "PDF_PARSE_FAILED",
      "فشل PDF.js في قراءة الملف.",
      { cause: error },
    );
  } finally {
    // PDF.js 6 owns document and worker teardown through the loading task.
    // Always destroying the task also covers failures before a proxy is created.
    await loadingTask.destroy();
  }
}

function finiteCoordinate(value: number | undefined, label: string): number {
  if (!Number.isFinite(value)) {
    throw new PdfExtractionError(
      "INVALID_TEXT_GEOMETRY",
      `إحداثي ${label} غير صالح داخل PDF.`,
    );
  }

  return value as number;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new PdfExtractionError(
      "INVALID_TEXT_GEOMETRY",
      `بُعد ${label} غير صالح داخل PDF.`,
    );
  }

  return value;
}
