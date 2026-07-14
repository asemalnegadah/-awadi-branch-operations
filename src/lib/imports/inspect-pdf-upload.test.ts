import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { inspectPdfUpload, UnsafePdfError } from "./inspect-pdf-upload";

function pdfBytes(body = "1 0 obj\n<< /Type /Catalog >>\nendobj"): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);
}

describe("PDF upload byte inspection", () => {
  it("يحسب الحجم والبصمة من البايتات في الخادم", () => {
    const bytes = pdfBytes();
    const result = inspectPdfUpload({
      originalName: "كشف أعمار الديون.pdf",
      bytes,
      declaredMediaType: "application/pdf",
      declaredSizeBytes: bytes.byteLength,
    });

    expect(result.mediaType).toBe("application/pdf");
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.sha256).toBe(
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
    expect(result.hasEofMarker).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("يرفض ملفًا لا يحمل توقيع PDF", () => {
    expect(() =>
      inspectPdfUpload({
        originalName: "fake.pdf",
        bytes: new TextEncoder().encode("not-a-pdf"),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<UnsafePdfError>>({
        code: "INVALID_PDF_SIGNATURE",
      }),
    );
  });

  it("يرفض اختلاف الحجم المعلن", () => {
    const bytes = pdfBytes();

    expect(() =>
      inspectPdfUpload({
        originalName: "report.pdf",
        bytes,
        declaredSizeBytes: bytes.byteLength + 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<UnsafePdfError>>({
        code: "SIZE_MISMATCH",
      }),
    );
  });

  it("يرفض JavaScript والملفات المرفقة داخل PDF", () => {
    for (const token of ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile"]) {
      expect(() =>
        inspectPdfUpload({
          originalName: "unsafe.pdf",
          bytes: pdfBytes(`1 0 obj\n<< ${token} 2 0 R >>\nendobj`),
        }),
      ).toThrowError(
        expect.objectContaining<Partial<UnsafePdfError>>({
          code: "ACTIVE_PDF_CONTENT",
        }),
      );
    }
  });

  it("يحذر من OpenAction ومن غياب EOF دون تنفيذ المحتوى", () => {
    const bytes = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<< /OpenAction 2 0 R >>\nendobj",
    );
    const result = inspectPdfUpload({ originalName: "warning.pdf", bytes });

    expect(result.hasEofMarker).toBe(false);
    expect(result.warnings).toContain(
      "يحتوي PDF على الإجراء /OpenAction ويحتاج مراجعة.",
    );
    expect(result.warnings).toContain(
      "علامة نهاية PDF غير موجودة قرب نهاية الملف.",
    );
  });

  it("يرفض امتدادًا أو نوعًا معلنًا غير PDF", () => {
    const bytes = pdfBytes();

    expect(() =>
      inspectPdfUpload({ originalName: "report.txt", bytes }),
    ).toThrowError(
      expect.objectContaining<Partial<UnsafePdfError>>({
        code: "EXTENSION_MISMATCH",
      }),
    );

    expect(() =>
      inspectPdfUpload({
        originalName: "report.pdf",
        bytes,
        declaredMediaType: "text/plain",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<UnsafePdfError>>({
        code: "MEDIA_TYPE_MISMATCH",
      }),
    );
  });
});
