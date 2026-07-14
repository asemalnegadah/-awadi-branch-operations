import { createHash } from "node:crypto";

import { sanitizeFileName } from "./register-upload";

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

const rejectedPdfTokens = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
] as const;

const warnedPdfTokens = ["/OpenAction", "/AA"] as const;

export interface InspectPdfUploadInput {
  readonly originalName: string;
  readonly bytes: Uint8Array;
  readonly declaredMediaType?: string | undefined;
  readonly declaredSizeBytes?: number | undefined;
}

export interface InspectedPdfUpload {
  readonly originalName: string;
  readonly safeName: string;
  readonly mediaType: "application/pdf";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly headerOffset: number;
  readonly hasEofMarker: boolean;
  readonly warnings: readonly string[];
}

export class UnsafePdfError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UnsafePdfError";
    this.code = code;
  }
}

export function inspectPdfUpload(
  input: InspectPdfUploadInput,
): InspectedPdfUpload {
  const safeName = sanitizeFileName(input.originalName);
  const sizeBytes = input.bytes.byteLength;

  if (sizeBytes === 0) {
    throw new UnsafePdfError("EMPTY_FILE", "ملف PDF فارغ.");
  }

  if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    throw new UnsafePdfError(
      "FILE_TOO_LARGE",
      "حجم ملف PDF يتجاوز الحد المسموح وهو 25 ميجابايت.",
    );
  }

  if (
    input.declaredSizeBytes !== undefined &&
    input.declaredSizeBytes !== sizeBytes
  ) {
    throw new UnsafePdfError(
      "SIZE_MISMATCH",
      "حجم الملف المعلن لا يطابق عدد البايتات المستلمة.",
    );
  }

  if (
    input.declaredMediaType &&
    input.declaredMediaType.toLowerCase() !== "application/pdf"
  ) {
    throw new UnsafePdfError(
      "MEDIA_TYPE_MISMATCH",
      "نوع الملف المعلن ليس application/pdf.",
    );
  }

  if (!safeName.toLowerCase().endsWith(".pdf")) {
    throw new UnsafePdfError(
      "EXTENSION_MISMATCH",
      "امتداد الملف يجب أن يكون PDF.",
    );
  }

  const headerProbe = Buffer.from(
    input.bytes.buffer,
    input.bytes.byteOffset,
    Math.min(input.bytes.byteLength, 1024),
  ).toString("latin1");
  const headerOffset = headerProbe.indexOf("%PDF-");

  if (headerOffset < 0) {
    throw new UnsafePdfError(
      "INVALID_PDF_SIGNATURE",
      "توقيع PDF غير موجود في بداية الملف.",
    );
  }

  const fullBuffer = Buffer.from(
    input.bytes.buffer,
    input.bytes.byteOffset,
    input.bytes.byteLength,
  );
  const rawLatin1 = fullBuffer.toString("latin1");

  for (const token of rejectedPdfTokens) {
    if (containsPdfNameToken(rawLatin1, token)) {
      throw new UnsafePdfError(
        "ACTIVE_PDF_CONTENT",
        `يحتوي PDF على مكون نشط غير مسموح: ${token}.`,
      );
    }
  }

  const warnings: string[] = [];
  if (headerOffset > 0) {
    warnings.push("يوجد محتوى قبل توقيع PDF؛ سيبقى الملف للمراجعة الأمنية.");
  }

  for (const token of warnedPdfTokens) {
    if (containsPdfNameToken(rawLatin1, token)) {
      warnings.push(`يحتوي PDF على الإجراء ${token} ويحتاج مراجعة.`);
    }
  }

  const trailerProbe = fullBuffer
    .subarray(Math.max(0, fullBuffer.length - 2048))
    .toString("latin1");
  const hasEofMarker = trailerProbe.includes("%%EOF");
  if (!hasEofMarker) {
    warnings.push("علامة نهاية PDF غير موجودة قرب نهاية الملف.");
  }

  return Object.freeze({
    originalName: input.originalName,
    safeName,
    mediaType: "application/pdf" as const,
    sizeBytes,
    sha256: createHash("sha256").update(fullBuffer).digest("hex"),
    headerOffset,
    hasEofMarker,
    warnings: Object.freeze(warnings),
  });
}

function containsPdfNameToken(raw: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?=[\\s/<>{}\\[\\]()]|$)`, "i").test(raw);
}
