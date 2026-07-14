BEGIN;

DO $$
DECLARE
  actor_id uuid;
  file_id uuid;
  extraction_id uuid;
  series_key text := 'ONYX|DEBT_AGING|REP:35|CUR:SR|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120';
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('insert.guard@example.test', 'مستخدم اختبار حواجز الإدخال', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO uploaded_files (
    original_name,
    media_type,
    size_bytes,
    sha256,
    storage_provider,
    storage_key,
    document_type,
    source_system,
    document_period_start,
    document_period_end,
    data_as_of_date,
    report_series_key,
    coverage_scope_type,
    coverage_scope_identifier,
    aging_scheme_code,
    metadata_confidence,
    metadata_source,
    uploaded_by,
    updated_by,
    idempotency_key
  ) VALUES (
    'insert-guard.pdf',
    'application/pdf',
    2048,
    repeat('1', 64),
    'TEST',
    'uploads/test/insert-guard.pdf',
    'DEBT_AGING',
    'ONYX',
    DATE '2026-01-01',
    DATE '2026-07-05',
    DATE '2026-07-05',
    series_key,
    'REPRESENTATIVE',
    '35',
    'ONYX_0_30_60_90_120',
    0.99,
    'PDF_CONTENT',
    actor_id,
    actor_id,
    'insert-guard-file'
  ) RETURNING id INTO file_id;

  BEGIN
    INSERT INTO report_snapshots (
      uploaded_file_id,
      report_type,
      report_series_key,
      period_start,
      period_end,
      as_of_date,
      relation_to_current,
      snapshot_status,
      reviewed_at,
      reviewed_by,
      created_by
    ) VALUES (
      file_id,
      'DEBT_AGING',
      series_key,
      DATE '2026-01-01',
      DATE '2026-07-05',
      DATE '2026-07-05',
      'FIRST_SNAPSHOT',
      'CURRENT',
      now(),
      actor_id,
      actor_id
    );
    RAISE EXCEPTION 'expected pre-approved snapshot insert to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected pre-approved snapshot insert to be rejected' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO report_snapshots (
    uploaded_file_id,
    report_type,
    report_series_key,
    period_start,
    period_end,
    as_of_date,
    relation_to_current,
    snapshot_status,
    created_by
  ) VALUES (
    file_id,
    'DEBT_AGING',
    series_key,
    DATE '2026-01-01',
    DATE '2026-07-05',
    DATE '2026-07-05',
    'FIRST_SNAPSHOT',
    'CANDIDATE',
    actor_id
  );

  INSERT INTO document_extractions (
    uploaded_file_id,
    extractor_name,
    extractor_version,
    extraction_method,
    document_type,
    classification_confidence,
    page_count,
    row_count,
    created_by
  ) VALUES (
    file_id,
    'insert-guard-extractor',
    '1.0.0',
    'PDF_TEXT',
    'DEBT_AGING',
    0.99,
    1,
    1,
    actor_id
  ) RETURNING id INTO extraction_id;

  BEGIN
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
      review_decision,
      reviewed_at,
      reviewed_by,
      approved_at,
      approved_by
    ) VALUES (
      extraction_id,
      0,
      1,
      2,
      'DEBT_AGING',
      '{"customerNumber":"60001"}'::jsonb,
      '{"customerNumber":"60001"}'::jsonb,
      0.95,
      'VALID',
      'ACCEPT',
      now(),
      actor_id,
      now(),
      actor_id
    );
    RAISE EXCEPTION 'expected pre-reviewed extracted row insert to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected pre-reviewed extracted row insert to be rejected' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO extracted_rows (
    extraction_id,
    row_index,
    source_page,
    source_line,
    row_type,
    raw_data,
    normalized_data,
    confidence,
    validation_status
  ) VALUES (
    extraction_id,
    0,
    1,
    2,
    'DEBT_AGING',
    '{"customerNumber":"60001"}'::jsonb,
    '{"customerNumber":"60001"}'::jsonb,
    0.95,
    'VALID'
  );
END;
$$;

ROLLBACK;
