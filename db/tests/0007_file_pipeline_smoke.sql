BEGIN;

DO $$
DECLARE
  actor_id uuid;
  file_id uuid;
  extraction_id uuid;
  extracted_row_id uuid;
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('file.pipeline@example.test', 'مستخدم اختبار الملفات', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO uploaded_files (
    original_name,
    media_type,
    size_bytes,
    sha256,
    storage_provider,
    storage_key,
    uploaded_by,
    updated_by,
    idempotency_key
  ) VALUES (
    'كشف أعمار الديون.pdf',
    'application/pdf',
    1024,
    repeat('a', 64),
    'TEST',
    'uploads/test/debt-aging.pdf',
    actor_id,
    actor_id,
    'file-pipeline-test-001'
  ) RETURNING id INTO file_id;

  UPDATE uploaded_files
  SET status = 'UPLOADED',
      uploaded_at = now(),
      updated_by = actor_id
  WHERE id = file_id;

  UPDATE uploaded_files
  SET status = 'QUEUED',
      updated_by = actor_id
  WHERE id = file_id;

  UPDATE uploaded_files
  SET status = 'EXTRACTING',
      updated_by = actor_id
  WHERE id = file_id;

  UPDATE uploaded_files
  SET status = 'EXTRACTED',
      document_type = 'DEBT_AGING',
      page_count = 2,
      updated_by = actor_id
  WHERE id = file_id;

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
    'test-extractor',
    '1.0.0',
    'PDF_TEXT',
    'DEBT_AGING',
    0.95,
    2,
    1,
    actor_id
  ) RETURNING id INTO extraction_id;

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
    extraction_id,
    0,
    1,
    2,
    'DEBT_AGING',
    '{"customerName":"عميل تجريبي","currency":"SR","remainingAmount":"1000"}'::jsonb,
    '{"customerName":"عميل تجريبي","currency":"SR","remainingAmountMinor":100000}'::jsonb,
    0.90,
    'VALID',
    '[]'::jsonb
  ) RETURNING id INTO extracted_row_id;

  IF extracted_row_id IS NULL THEN
    RAISE EXCEPTION 'expected extracted row to be created';
  END IF;

  BEGIN
    UPDATE uploaded_files
    SET status = 'COMMITTED',
        updated_by = actor_id
    WHERE id = file_id;
    RAISE EXCEPTION 'expected invalid file status jump to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected invalid file status jump to be rejected' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM uploaded_files WHERE id = file_id;
    RAISE EXCEPTION 'expected uploaded file deletion to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected uploaded file deletion to be rejected' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM extracted_rows WHERE id = extracted_row_id;
    RAISE EXCEPTION 'expected extracted row deletion to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected extracted row deletion to be rejected' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
