import { describe, expect, it } from "vitest";

import { extractPositionedTextWithPdfJs } from "./pdfjs-positioned-extractor";

describe("PDF.js positioned extraction", () => {
  it("يقرأ PDF حقيقيًا من البايتات ويحفظ إحداثيات النص", async () => {
    const result = await extractPositionedTextWithPdfJs(
      buildSinglePagePdf("Customer 60016 SR"),
    );

    expect(result.pageCount).toBe(1);
    expect(result.requiresOcr).toBe(false);
    expect(result.textItemCount).toBeGreaterThan(0);
    expect(result.pageTexts[0]?.text).toContain("Customer 60016 SR");
    expect(result.document.pages[0]).toMatchObject({
      pageNumber: 1,
      width: 612,
      height: 792,
    });

    const textItem = result.document.items.find((item) =>
      item.text.includes("Customer 60016 SR"),
    );
    expect(textItem).toBeDefined();
    expect(textItem?.pageNumber).toBe(1);
    expect(textItem?.x).toBeCloseTo(100, 0);
    expect(textItem?.y).toBeCloseTo(700, 0);
  });

  it("يفرض حد الصفحات قبل استهلاك الملف كاملًا", async () => {
    await expect(
      extractPositionedTextWithPdfJs(buildSinglePagePdf("Test"), {
        maxPages: 0,
      }),
    ).rejects.toThrow("الحد الأقصى لصفحات PDF غير صالح.");
  });

  it("يعيد رمز خطأ واضحًا للبايتات التالفة", async () => {
    await expect(
      extractPositionedTextWithPdfJs(new TextEncoder().encode("not a pdf")),
    ).rejects.toMatchObject({
      code: "PDF_PARSE_FAILED",
    });
  });
});

function buildSinglePagePdf(text: string): Uint8Array {
  const safeText = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT\n/F1 12 Tf\n100 700 Td\n(${safeText}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let output = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";

  for (const offset of offsets.slice(1)) {
    output += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(output);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
