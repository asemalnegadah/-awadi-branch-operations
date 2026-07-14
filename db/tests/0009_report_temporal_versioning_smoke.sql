BEGIN;

DO $$
DECLARE
  actor_id uuid;
  first_file_id uuid;
  second_file_id uuid;
  first_snapshot_id uuid;
  second_snapshot_id uuid;
  series_key text := 'ONYX|DEBT_AGING|REP:35|CUR:SR,RG|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120';
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('report.version@example.test', 'مستخدم اختبار نسخ التقارير', 'ACTIVE')
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
    report_generated_at,
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
    'debt-aging-first.pdf',
    'application/pdf',
    1024,
    repeat('c', 64),
    'TEST',
    'uploads/test/debt-aging-first.pdf',
    'DEBT_AGING',
    'ONYX',
    DATE '2026-01-01',
    DATE '2026-07-05',
    DATE '2026-07-05',
    TIMESTAMPTZ '2026-07-05 02:01:48+03',
    series_key,
    'REPRESENTATIVE',
    '35',
    'ONYX_0_30_60_90_120',
    0.99,
    'PDF_CONTENT',
    actor_id,
    actor_id,
    'report-version-first'
  ) RETURNING id INTO first_file_id;

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
    created_by
  ) VALUES (
    first_file_id,
    'DEBT_AGING',
    series_key,
    DATE '2026-01-01',
    DATE '2026-07-05',
    DATE '2026-07-05',
    TIMESTAMPTZ '2026-07-05 02:01:48+03',
    'FIRST_SNAPSHOT',
    'CURRENT',
    actor_id
  ) RETURNING id INTO first_snapshot_id;

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
    report_generated_at,
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
    'debt-aging-second.pdf',
    'application/pdf',
    2048,
    repeat('d', 64),
    'TEST',
    'uploads/test/debt-aging-second.pdf',
    'DEBT_AGING',
    'ONYX',
    DATE '2026-01-01',
    DATE '2026-07-12',
    DATE '2026-07-12',
    TIMESTAMPTZ '2026-07-12 02:01:48+03',
    series_key,
    'REPRESENTATIVE',
    '35',
    'ONYX_0_30_60_90_120',
    0.99,
    'PDF_CONTENT',
    actor_id,
    actor_id,
    'report-version-second'
  ) RETURNING id INTO second_file_id;

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
    created_by
  ) VALUES (
    second_file_id,
    'DEBT_AGING',
    series_key,
    DATE '2026-01-01',
    DATE '2026-07-12',
    DATE '2026-07-12',
    TIMESTAMPTZ '2026-07-12 02:01:48+03',
    'NEWER_SNAPSHOT',
    'CANDIDATE',
    first_snapshot_id,
    actor_id
  ) RETURNING id INTO second_snapshot_id;

  BEGIN
    UPDATE report_snapshots
    SET snapshot_status = 'CURRENT'
    WHERE id = second_snapshot_id;
    RAISE EXCEPTION 'expected second current snapshot to be rejected while first remains current';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  UPDATE report_snapshots
  SET snapshot_status = 'HISTORICAL',
      reviewed_at = now(),
      reviewed_by = actor_id,
      review_note = 'استبدلت بنسخة أحدث'
  WHERE id = first_snapshot_id;

  UPDATE report_snapshots
  SET snapshot_status = 'CURRENT',
      reviewed_at = now(),
      reviewed_by = actor_id,
      review_note = 'نسخة أحدث معتمدة'
  WHERE id = second_snapshot_id;

  IF NOT EXISTS (
    SELECT 1
    FROM report_snapshots
    WHERE id = second_snapshot_id
      AND snapshot_status = 'CURRENT'
      AND as_of_date = DATE '2026-07-12'
  ) THEN
    RAISE EXCEPTION 'expected newer report snapshot to become current';
  END IF;

  BEGIN
    DELETE FROM report_snapshots WHERE id = first_snapshot_id;
    RAISE EXCEPTION 'expected report snapshot deletion to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected report snapshot deletion to be rejected' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
