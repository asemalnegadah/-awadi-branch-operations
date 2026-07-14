import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDatabaseClient,
  getDatabaseClient,
} from "@/lib/db/client";

import type { ProcessedOnyxDebtAgingPdf } from "./process-onyx-debt-aging-pdf";
import {
  ExtractionIdempotencyConflictError,
  persistProcessedOnyxDebtAgingPostgres,
} from "./postgres-extraction-repository";

const actorId = "20000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const sql = getDatabaseClient();

beforeAll(async () => {
  await sql`
    INSERT INTO users (id, email, full_name, status)
    VALUES (
      ${actorId},
      'pdf.persistence@example.test',
      'مستخدم اختبار حفظ PDF',
      'ACTIVE'
    )
  `;
});

afterAll(async () => {
  await closeDatabaseClient();
});

describe("PostgreSQL Onyx extraction persistence", () => {
  it("يحفظ الملف والاستخراج والصفوف ونسخة التقرير في معاملة واحدة", async () => {
    const processed = buildProcessedResult();
    const result = await persistProcessedOnyxDebtAgingPostgres(sql, processed, {
      storageProvider: "TEST",
      storageKey: "uploads/integration/onyx-aging-2026-07-05.pdf",
      actorId,
      requestId,
      idempotencyKey: "integration-onyx-persistence-001",
    });

    expect(result).toMatchObject({
      relationToCurrent: "FIRST_SNAPSHOT",
      fileStatus: "REVIEW_REQUIRED",
      rowCount: 2,
      replayed: false,
    });

    const fileRows = await sql<
      {
        status: string;
        document_type: string;
        data_as_of_date: string;
        report_series_key: string;
      }[]
    >`
      SELECT
        status,
        document_type,
        data_as_of_date::text,
        report_series_key
      FROM uploaded_files
      WHERE id = ${result.uploadedFileId}
    `;
    expect(fileRows[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      document_type: "DEBT_AGING",
      data_as_of_date: "2026-07-05",
      report_series_key:
        "ONYX|DEBT_AGING|REP:35|CUR:SR,RG|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120",
    });

    const extractionRows = await sql<
      { row_count: number; persisted_rows: string }[]
    >`
      SELECT
        extraction.row_count,
        COUNT(row.id)::text AS persisted_rows
      FROM document_extractions AS extraction
      JOIN extracted_rows AS row
        ON row.extraction_id = extraction.id
      WHERE extraction.id = ${result.extractionId}
      GROUP BY extraction.row_count
    `;
    expect(Number(extractionRows[0]?.row_count)).toBe(2);
    expect(extractionRows[0]?.persisted_rows).toBe("2");

    const snapshotRows = await sql<
      { snapshot_status: string; relation_to_current: string }[]
    >`
      SELECT snapshot_status, relation_to_current
      FROM report_snapshots
      WHERE id = ${result.snapshotId}
    `;
    expect(snapshotRows[0]).toEqual({
      snapshot_status: "CANDIDATE",
      relation_to_current: "FIRST_SNAPSHOT",
    });
  });

  it("يعيد العملية المكتملة نفسها عند تكرار الطلب المطابق", async () => {
    const result = await persistProcessedOnyxDebtAgingPostgres(
      sql,
      buildProcessedResult(),
      {
        storageProvider: "TEST",
        storageKey: "uploads/integration/onyx-aging-2026-07-05.pdf",
        actorId,
        requestId,
        idempotencyKey: "integration-onyx-persistence-001",
      },
    );

    expect(result.replayed).toBe(true);
    expect(result.rowCount).toBe(2);
  });

  it("يرفض استخدام بصمة الملف نفسها بمفتاح مختلف", async () => {
    await expect(
      persistProcessedOnyxDebtAgingPostgres(sql, buildProcessedResult(), {
        storageProvider: "TEST",
        storageKey: "uploads/integration/onyx-aging-copy.pdf",
        actorId,
        requestId,
        idempotencyKey: "integration-onyx-persistence-conflict",
      }),
    ).rejects.toBeInstanceOf(ExtractionIdempotencyConflictError);
  });
});

function buildProcessedResult(): ProcessedOnyxDebtAgingPdf {
  const reportSeriesKey =
    "ONYX|DEBT_AGING|REP:35|CUR:SR,RG|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120";

  return Object.freeze({
    status: "REVIEW_REQUIRED" as const,
    inspection: Object.freeze({
      originalName: "كشف أعمار الديون.pdf",
      safeName: "كشف-أعمار-الديون.pdf",
      mediaType: "application/pdf" as const,
      sizeBytes: 4096,
      sha256: "2".repeat(64),
      headerOffset: 0,
      hasEofMarker: true,
      warnings: Object.freeze([]),
    }),
    extraction: Object.freeze({
      document: Object.freeze({
        pages: Object.freeze([{ pageNumber: 1, width: 1000, height: 800 }]),
        items: Object.freeze([]),
      }),
      pageTexts: Object.freeze([{ pageNumber: 1, text: "أعمار الديون للعملاء" }]),
      pageCount: 1,
      textItemCount: 120,
      visibleCharacterCount: 900,
      requiresOcr: false,
      warnings: Object.freeze([]),
    }),
    metadata: Object.freeze({
      reportType: "DEBT_AGING" as const,
      sourceSystem: "ONYX" as const,
      periodStart: "2026-01-01",
      periodEnd: "2026-07-05",
      asOfDate: "2026-07-05",
      generatedAt: "2026-07-05T02:01:48+03:00",
      declaredPageCount: 1,
      representativeCode: "35",
      currencies: Object.freeze(["SR", "RG"] as const),
      agingScheme: "ONYX_0_30_60_90_120" as const,
      reportSeriesKey,
      warnings: Object.freeze([]),
    }),
    rows: Object.freeze([
      buildRow(0, "60016", "SR", 700),
      buildRow(1, "60017", "RG", 675),
    ]),
    validCount: 2,
    warningCount: 0,
    invalidCount: 0,
    conflictCount: 0,
    warnings: Object.freeze([]),
  });
}

function buildRow(
  rowIndex: number,
  customerNumber: string,
  currency: "SR" | "RG",
  sourceY: number,
) {
  const raw = Object.freeze({
    customerNumber,
    customerName: `عميل ${customerNumber}`,
    representativeCode: "35",
    currency,
    amount: "125,000.00",
    localAmount: "125,000.00",
    days0To30: "25,000.00",
    days31To60: undefined,
    days61To90: undefined,
    days91To120: undefined,
    over120: "100,000.00",
    totalDue: "125,000.00",
    sourcePage: 1,
    sourceY,
    warnings: Object.freeze([]),
  });
  const normalized = Object.freeze({
    customerNumber,
    extractedCustomerName: raw.customerName,
    representativeCode: "35",
    currency,
    reportAsOfDate: "2026-07-05",
    rowIdentity: `${customerNumber}|${currency}|2026-07-05`,
    amountMinor: 12_500_000,
    localAmountMinor: 12_500_000,
    totalDueMinor: 12_500_000,
    aging: Object.freeze({
      days0To30Minor: 2_500_000,
      days31To60Minor: 0,
      days61To90Minor: 0,
      days91To120Minor: 0,
      over120Minor: 10_000_000,
    }),
    sourcePage: 1,
    sourceY,
    warnings: Object.freeze([]),
  });

  return Object.freeze({
    rowIndex,
    status: "VALID" as const,
    raw,
    normalized,
    warnings: Object.freeze([]),
  });
}
