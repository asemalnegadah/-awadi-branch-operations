import type { Sql, TransactionSql } from "postgres";

type SqlExecutor = Sql | TransactionSql;

import type { ProcessedOnyxDebtAgingPdf } from "./process-onyx-debt-aging-pdf";
import {
  classifyReportVersion,
  type ReportVersionIdentity,
  type ReportVersionRelation,
} from "./report-versioning";

export interface PersistOnyxExtractionContext {
  readonly storageProvider: string;
  readonly storageKey: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly extractorName?: string | undefined;
  readonly extractorVersion?: string | undefined;
  readonly rawTextStorageKey?: string | undefined;
}

export interface PersistedOnyxExtraction {
  readonly uploadedFileId: string;
  readonly extractionId: string;
  readonly snapshotId: string;
  readonly relationToCurrent: ReportVersionRelation;
  readonly fileStatus: "REVIEW_REQUIRED";
  readonly rowCount: number;
  readonly replayed: boolean;
}

export class ExtractionIdempotencyConflictError extends Error {
  constructor() {
    super("تم استخدام مفتاح منع التكرار أو بصمة الملف لعملية مختلفة.");
    this.name = "ExtractionIdempotencyConflictError";
  }
}

type ReviewReadyProcessed = ProcessedOnyxDebtAgingPdf & {
  readonly status: "REVIEW_REQUIRED";
  readonly metadata: NonNullable<ProcessedOnyxDebtAgingPdf["metadata"]>;
};

interface ExistingPersistenceRow {
  uploaded_file_id: string;
  original_name: string;
  media_type: string;
  size_bytes: string | number;
  sha256: string;
  storage_provider: string;
  storage_key: string;
  status: string;
  idempotency_key: string;
  extraction_id: string | null;
  snapshot_id: string | null;
  relation_to_current: ReportVersionRelation | null;
  row_count: string | number | null;
}

interface CurrentSnapshotRow {
  snapshot_id: string;
  report_series_key: string;
  period_start: Date | string;
  period_end: Date | string;
  as_of_date: Date | string;
  sha256: string;
}

export async function persistProcessedOnyxDebtAgingPostgres(
  sql: Sql,
  processed: ProcessedOnyxDebtAgingPdf,
  context: PersistOnyxExtractionContext,
): Promise<PersistedOnyxExtraction> {
  assertReviewReady(processed);
  assertContext(context);

  const extractorName =
    context.extractorName?.trim() || "awadi-onyx-coordinate-parser";
  const extractorVersion = context.extractorVersion?.trim() || "1.0.0";

  return sql.begin(async (transaction) => {
    await transaction`
      SELECT set_config('app.request_id', ${context.requestId}, true)
    `;
    await transaction.unsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`pdf:${processed.inspection.sha256}:${context.idempotencyKey}`],
    );

    const existing = await findExistingPersistence(
      transaction,
      context.idempotencyKey,
      processed.inspection.sha256,
    );
    if (existing) {
      return replayExisting(existing, processed, context);
    }

    const uploadedFileId = await insertRegisteredFile(
      transaction,
      processed,
      context,
    );
    await transitionFile(transaction, uploadedFileId, context.actorId, "UPLOADED", true);
    await transitionFile(transaction, uploadedFileId, context.actorId, "QUEUED");
    await transitionFile(transaction, uploadedFileId, context.actorId, "EXTRACTING");

    const current = await findCurrentSnapshot(
      transaction,
      processed.metadata.reportSeriesKey,
    );
    const versionDecision = classifyReportVersion(
      reportIdentityFromProcessed(processed),
      current ? reportIdentityFromCurrent(current) : null,
    );

    await markFileExtracted(transaction, uploadedFileId, processed, context.actorId);
    const extractionId = await insertExtraction(
      transaction,
      uploadedFileId,
      processed,
      context,
      extractorName,
      extractorVersion,
    );
    await insertExtractedRows(transaction, extractionId, processed);
    const snapshotId = await insertSnapshot(
      transaction,
      uploadedFileId,
      processed,
      context.actorId,
      versionDecision,
      current?.snapshot_id,
    );
    await transitionFile(
      transaction,
      uploadedFileId,
      context.actorId,
      "REVIEW_REQUIRED",
    );

    return Object.freeze({
      uploadedFileId,
      extractionId,
      snapshotId,
      relationToCurrent: versionDecision.relation,
      fileStatus: "REVIEW_REQUIRED" as const,
      rowCount: processed.rows.length,
      replayed: false,
    });
  });
}

async function insertRegisteredFile(
  sql: SqlExecutor,
  processed: ReviewReadyProcessed,
  context: PersistOnyxExtractionContext,
): Promise<string> {
  const rows = await sql.unsafe<{ id: string }[]>(
    `
      INSERT INTO uploaded_files (
        original_name,
        media_type,
        size_bytes,
        sha256,
        storage_provider,
        storage_key,
        status,
        uploaded_by,
        updated_by,
        idempotency_key
      ) VALUES (
        $1, 'application/pdf', $2, $3, $4, $5,
        'REGISTERED', $6, $6, $7
      )
      RETURNING id
    `,
    [
      processed.inspection.originalName,
      processed.inspection.sizeBytes,
      processed.inspection.sha256,
      context.storageProvider,
      context.storageKey,
      context.actorId,
      context.idempotencyKey,
    ],
  );
  return requiredFirst(rows, "uploaded file").id;
}

async function findCurrentSnapshot(
  sql: SqlExecutor,
  reportSeriesKey: string,
): Promise<CurrentSnapshotRow | undefined> {
  const rows = await sql.unsafe<CurrentSnapshotRow[]>(
    `
      SELECT
        snapshot.id AS snapshot_id,
        snapshot.report_series_key,
        snapshot.period_start,
        snapshot.period_end,
        snapshot.as_of_date,
        file.sha256
      FROM report_snapshots AS snapshot
      JOIN uploaded_files AS file
        ON file.id = snapshot.uploaded_file_id
      WHERE snapshot.report_series_key = $1
        AND snapshot.snapshot_status = 'CURRENT'
      FOR UPDATE OF snapshot
    `,
    [reportSeriesKey],
  );
  return rows[0];
}

async function markFileExtracted(
  sql: SqlExecutor,
  uploadedFileId: string,
  processed: ReviewReadyProcessed,
  actorId: string,
): Promise<void> {
  const metadata = processed.metadata;
  const rows = await sql.unsafe<{ id: string }[]>(
    `
      UPDATE uploaded_files
      SET
        status = 'EXTRACTED',
        document_type = 'DEBT_AGING',
        page_count = $2,
        source_system = 'ONYX',
        document_period_start = $3::date,
        document_period_end = $4::date,
        data_as_of_date = $5::date,
        report_generated_at = $6::timestamptz,
        report_series_key = $7,
        coverage_scope_type = $8,
        coverage_scope_identifier = $9,
        aging_scheme_code = $10,
        metadata_confidence = $11,
        metadata_source = 'PDF_CONTENT',
        updated_by = $12
      WHERE id = $1
      RETURNING id
    `,
    [
      uploadedFileId,
      processed.extraction.pageCount,
      metadata.periodStart,
      metadata.periodEnd,
      metadata.asOfDate,
      metadata.generatedAt ?? null,
      metadata.reportSeriesKey,
      metadata.representativeCode ? "REPRESENTATIVE" : "UNKNOWN",
      metadata.representativeCode ?? null,
      metadata.agingScheme,
      metadata.warnings.length === 0 ? 1 : 0.85,
      actorId,
    ],
  );
  requiredFirst(rows, "file extraction transition");
}

async function insertExtraction(
  sql: SqlExecutor,
  uploadedFileId: string,
  processed: ReviewReadyProcessed,
  context: PersistOnyxExtractionContext,
  extractorName: string,
  extractorVersion: string,
): Promise<string> {
  const metadata = processed.metadata;
  const rows = await sql.unsafe<{ id: string }[]>(
    `
      INSERT INTO document_extractions (
        uploaded_file_id,
        extractor_name,
        extractor_version,
        extraction_method,
        document_type,
        classification_confidence,
        raw_text_storage_key,
        page_count,
        row_count,
        warning_count,
        metadata,
        created_by
      ) VALUES (
        $1, $2, $3, 'PDF_TEXT', 'DEBT_AGING', 1,
        $4, $5, $6, $7, $8::jsonb, $9
      )
      RETURNING id
    `,
    [
      uploadedFileId,
      extractorName,
      extractorVersion,
      context.rawTextStorageKey ?? null,
      processed.extraction.pageCount,
      processed.rows.length,
      processed.warningCount + processed.conflictCount + processed.warnings.length,
      JSON.stringify({
        fileWarnings: processed.warnings,
        currencies: metadata.currencies,
        representativeCode: metadata.representativeCode ?? null,
        reportSeriesKey: metadata.reportSeriesKey,
        periodStart: metadata.periodStart,
        periodEnd: metadata.periodEnd,
        asOfDate: metadata.asOfDate,
        generatedAt: metadata.generatedAt ?? null,
        textItemCount: processed.extraction.textItemCount,
        visibleCharacterCount: processed.extraction.visibleCharacterCount,
        counts: {
          valid: processed.validCount,
          warning: processed.warningCount,
          invalid: processed.invalidCount,
          conflict: processed.conflictCount,
        },
      }),
      context.actorId,
    ],
  );
  return requiredFirst(rows, "document extraction").id;
}

async function insertExtractedRows(
  sql: SqlExecutor,
  extractionId: string,
  processed: ReviewReadyProcessed,
): Promise<void> {
  for (const row of processed.rows) {
    await sql.unsafe(
      `
        INSERT INTO extracted_rows (
          extraction_id,
          row_index,
          source_page,
          source_line,
          row_type,
          raw_data,
          normalized_data,
          confidence,
          validation_status,
          warnings
        ) VALUES (
          $1, $2, $3, NULL, 'DEBT_AGING',
          $4::jsonb, $5::jsonb, $6, $7, $8::jsonb
        )
      `,
      [
        extractionId,
        row.rowIndex,
        row.raw.sourcePage,
        JSON.stringify(row.raw),
        JSON.stringify(row.normalized ?? {}),
        confidenceForStatus(row.status),
        row.status,
        JSON.stringify(row.warnings),
      ],
    );
  }
}

async function insertSnapshot(
  sql: SqlExecutor,
  uploadedFileId: string,
  processed: ReviewReadyProcessed,
  actorId: string,
  versionDecision: ReturnType<typeof classifyReportVersion>,
  currentSnapshotId: string | undefined,
): Promise<string> {
  const metadata = processed.metadata;
  const snapshotStatus =
    versionDecision.relation === "SAME_SNAPSHOT_CONFLICT"
      ? "CONFLICT"
      : "CANDIDATE";
  const supersedesSnapshotId =
    versionDecision.relation === "NEWER_SNAPSHOT"
      ? currentSnapshotId ?? null
      : null;
  const rows = await sql.unsafe<{ id: string }[]>(
    `
      INSERT INTO report_snapshots (
        uploaded_file_id,
        report_type,
        report_series_key,
        period_start,
        period_end,
        as_of_date,
        generated_at,
        relation_to_current,
        snapshot_status,
        supersedes_snapshot_id,
        metadata,
        created_by
      ) VALUES (
        $1, 'DEBT_AGING', $2, $3::date, $4::date, $5::date,
        $6::timestamptz, $7, $8, $9, $10::jsonb, $11
      )
      RETURNING id
    `,
    [
      uploadedFileId,
      metadata.reportSeriesKey,
      metadata.periodStart,
      metadata.periodEnd,
      metadata.asOfDate,
      metadata.generatedAt ?? null,
      versionDecision.relation,
      snapshotStatus,
      supersedesSnapshotId,
      JSON.stringify({
        reason: versionDecision.reason,
        mayBecomeCurrent: versionDecision.mayBecomeCurrent,
        requiresReview: versionDecision.requiresReview,
        validCount: processed.validCount,
        warningCount: processed.warningCount,
        invalidCount: processed.invalidCount,
        conflictCount: processed.conflictCount,
      }),
      actorId,
    ],
  );
  return requiredFirst(rows, "report snapshot").id;
}

async function findExistingPersistence(
  sql: SqlExecutor,
  idempotencyKey: string,
  sha256: string,
): Promise<ExistingPersistenceRow | undefined> {
  const rows = await sql.unsafe<ExistingPersistenceRow[]>(
    `
      SELECT
        file.id AS uploaded_file_id,
        file.original_name,
        file.media_type,
        file.size_bytes,
        file.sha256,
        file.storage_provider,
        file.storage_key,
        file.status,
        file.idempotency_key,
        extraction.id AS extraction_id,
        snapshot.id AS snapshot_id,
        snapshot.relation_to_current,
        extraction.row_count
      FROM uploaded_files AS file
      LEFT JOIN LATERAL (
        SELECT id, row_count
        FROM document_extractions
        WHERE uploaded_file_id = file.id
        ORDER BY created_at DESC
        LIMIT 1
      ) AS extraction ON true
      LEFT JOIN report_snapshots AS snapshot
        ON snapshot.uploaded_file_id = file.id
      WHERE file.idempotency_key = $1 OR file.sha256 = $2
      FOR UPDATE OF file
    `,
    [idempotencyKey, sha256],
  );

  if (rows.length > 1) {
    throw new ExtractionIdempotencyConflictError();
  }
  return rows[0];
}

function replayExisting(
  existing: ExistingPersistenceRow,
  processed: ReviewReadyProcessed,
  context: PersistOnyxExtractionContext,
): PersistedOnyxExtraction {
  if (!samePersistenceRequest(existing, processed, context)) {
    throw new ExtractionIdempotencyConflictError();
  }
  if (
    !existing.extraction_id ||
    !existing.snapshot_id ||
    !existing.relation_to_current ||
    existing.status !== "REVIEW_REQUIRED"
  ) {
    throw new Error(
      "وجد ملف مطابق لكنه لا يمثل عملية استخراج مكتملة قابلة للإعادة.",
    );
  }

  return Object.freeze({
    uploadedFileId: existing.uploaded_file_id,
    extractionId: existing.extraction_id,
    snapshotId: existing.snapshot_id,
    relationToCurrent: existing.relation_to_current,
    fileStatus: "REVIEW_REQUIRED" as const,
    rowCount: parseNonNegativeInteger(existing.row_count, "row_count"),
    replayed: true,
  });
}

function samePersistenceRequest(
  existing: ExistingPersistenceRow,
  processed: ReviewReadyProcessed,
  context: PersistOnyxExtractionContext,
): boolean {
  return (
    existing.idempotency_key === context.idempotencyKey &&
    existing.sha256 === processed.inspection.sha256 &&
    existing.original_name === processed.inspection.originalName &&
    existing.media_type === "application/pdf" &&
    Number(existing.size_bytes) === processed.inspection.sizeBytes &&
    existing.storage_provider === context.storageProvider &&
    existing.storage_key === context.storageKey
  );
}

async function transitionFile(
  sql: SqlExecutor,
  uploadedFileId: string,
  actorId: string,
  status: "UPLOADED" | "QUEUED" | "EXTRACTING" | "REVIEW_REQUIRED",
  setUploadedAt = false,
): Promise<void> {
  const rows = await sql.unsafe<{ id: string }[]>(
    `
      UPDATE uploaded_files
      SET
        status = $2,
        uploaded_at = CASE WHEN $3 THEN now() ELSE uploaded_at END,
        updated_by = $4
      WHERE id = $1
      RETURNING id
    `,
    [uploadedFileId, status, setUploadedAt, actorId],
  );
  requiredFirst(rows, `file transition to ${status}`);
}

function reportIdentityFromProcessed(
  processed: ReviewReadyProcessed,
): ReportVersionIdentity {
  return Object.freeze({
    reportSeriesKey: processed.metadata.reportSeriesKey,
    periodStart: processed.metadata.periodStart,
    periodEnd: processed.metadata.periodEnd,
    asOfDate: processed.metadata.asOfDate,
    sha256: processed.inspection.sha256,
  });
}

function reportIdentityFromCurrent(
  current: CurrentSnapshotRow,
): ReportVersionIdentity {
  return Object.freeze({
    reportSeriesKey: current.report_series_key,
    periodStart: toDateOnly(current.period_start),
    periodEnd: toDateOnly(current.period_end),
    asOfDate: toDateOnly(current.as_of_date),
    sha256: current.sha256,
  });
}

function confidenceForStatus(
  status: "VALID" | "WARNING" | "INVALID" | "CONFLICT",
): number {
  switch (status) {
    case "VALID":
      return 0.98;
    case "WARNING":
      return 0.85;
    case "CONFLICT":
      return 0.5;
    case "INVALID":
      return 0.2;
  }
}

function assertReviewReady(
  processed: ProcessedOnyxDebtAgingPdf,
): asserts processed is ReviewReadyProcessed {
  if (processed.status !== "REVIEW_REQUIRED" || !processed.metadata) {
    throw new Error(
      "لا يمكن حفظ نتيجة Onyx قبل اكتمال النص والبيانات الزمنية؛ ملفات OCR تسلك طابورًا منفصلًا.",
    );
  }
}

function assertContext(context: PersistOnyxExtractionContext): void {
  assertUuid(context.actorId, "actorId");
  assertUuid(context.requestId, "requestId");
  assertRequiredText(context.storageProvider, "storageProvider");
  assertRequiredText(context.storageKey, "storageKey");
  assertRequiredText(context.idempotencyKey, "idempotencyKey");
}

function parseNonNegativeInteger(
  value: string | number | null,
  label: string,
): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${label} المخزن غير صالح.`);
  }
  return numberValue;
}

function toDateOnly(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!direct) {
    throw new Error("تاريخ snapshot المخزن غير صالح.");
  }
  return direct;
}

function requiredFirst<T>(rows: readonly T[], label: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`لم تُرجع قاعدة البيانات سجل ${label}.`);
  }
  return row;
}

function assertRequiredText(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new Error(`الحقل ${fieldName} إلزامي.`);
  }
}

function assertUuid(value: string, fieldName: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`الحقل ${fieldName} يجب أن يكون UUID صالحًا.`);
  }
}
