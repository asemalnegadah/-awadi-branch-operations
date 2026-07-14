BEGIN;

DO $$
DECLARE
  actor_id uuid;
  reviewer_id uuid;
  role_id_value uuid;
  customer_id_value uuid;
  representative_id_value uuid;
  account_id_value uuid;
  file_id uuid;
  extraction_id uuid;
  row_id uuid;
  snapshot_id uuid;
  series_key text := 'ONYX|DEBT_AGING|REP:35|CUR:SR|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120';
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('integrity.actor@example.test', 'مستخدم اختبار السلامة', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('integrity.reviewer@example.test', 'مراجع اختبار السلامة', 'ACTIVE')
  RETURNING id INTO reviewer_id;

  SELECT id INTO role_id_value
  FROM roles
  WHERE code = 'SALES_REP';

  INSERT INTO user_roles (user_id, role_id, granted_by)
  VALUES (actor_id, role_id_value, reviewer_id);

  BEGIN
    INSERT INTO user_roles (user_id, role_id, granted_by)
    VALUES (actor_id, role_id_value, reviewer_id);
    RAISE EXCEPTION 'expected duplicate unrevoked role assignment to be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO customers (
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    'INT-60001',
    'عميل اختبار السلامة',
    actor_id,
    actor_id
  ) RETURNING id INTO customer_id_value;

  INSERT INTO sales_representatives (
    employee_code,
    full_name_ar,
    user_id,
    created_by,
    updated_by
  ) VALUES (
    'INT-REP-35',
    'مندوب اختبار السلامة',
    actor_id,
    reviewer_id,
    reviewer_id
  ) RETURNING id INTO representative_id_value;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    account_number,
    account_number_source,
    created_by
  ) VALUES (
    customer_id_value,
    'SR',
    'INT-60001',
    'IMPORT',
    actor_id
  ) RETURNING id INTO account_id_value;

  BEGIN
    INSERT INTO collections (
      customer_id,
      customer_account_id,
      representative_id,
      currency_code,
      amount_minor,
      payment_method,
      collected_at,
      state,
      created_by,
      updated_by,
      idempotency_key
    ) VALUES (
      customer_id_value,
      account_id_value,
      representative_id_value,
      'SR',
      10000,
      'CASH',
      now(),
      'CLOSED',
      actor_id,
      actor_id,
      'integrity-invalid-closed-collection'
    );
    RAISE EXCEPTION 'expected direct non-draft collection insert to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected direct non-draft collection insert to be rejected' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO uploaded_files (
      original_name,
      media_type,
      size_bytes,
      sha256,
      storage_provider,
      storage_key,
      status,
      uploaded_at,
      uploaded_by,
      updated_by,
      idempotency_key
    ) VALUES (
      'invalid-direct-upload.pdf',
      'application/pdf',
      1024,
      repeat('e', 64),
      'TEST',
      'uploads/test/invalid-direct-upload.pdf',
      'UPLOADED',
      now(),
      actor_id,
      actor_id,
      'integrity-invalid-direct-upload'
    );
    RAISE EXCEPTION 'expected direct uploaded state insert to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected direct uploaded state insert to be rejected' THEN
      RAISE;
    END IF;
  END;

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
    'valid-aging.pdf',
    'application/pdf',
    4096,
    repeat('f', 64),
    'TEST',
    'uploads/test/valid-aging.pdf',
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
    'integrity-valid-aging-file'
  ) RETURNING id INTO file_id;

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
  ) RETURNING id INTO snapshot_id;

  BEGIN
    UPDATE report_snapshots
    SET period_end = DATE '2026-07-06',
        as_of_date = DATE '2026-07-06'
    WHERE id = snapshot_id;
    RAISE EXCEPTION 'expected snapshot identity mutation to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected snapshot identity mutation to be rejected' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE report_snapshots
    SET snapshot_status = 'CURRENT'
    WHERE id = snapshot_id;
    RAISE EXCEPTION 'expected unresolved snapshot promotion to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected unresolved snapshot promotion to be rejected' THEN
      RAISE;
    END IF;
  END;

  UPDATE report_snapshots
  SET snapshot_status = 'CURRENT',
      reviewed_at = now(),
      reviewed_by = reviewer_id,
      review_note = 'اعتماد اختبار'
  WHERE id = snapshot_id;

  BEGIN
    UPDATE report_snapshots
    SET snapshot_status = 'CANDIDATE'
    WHERE id = snapshot_id;
    RAISE EXCEPTION 'expected reverse snapshot transition to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected reverse snapshot transition to be rejected' THEN
      RAISE;
    END IF;
  END;

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
    'integrity-test-extractor',
    '1.0.0',
    'PDF_TEXT',
    'DEBT_AGING',
    0.99,
    1,
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
    validation_status
  ) VALUES (
    extraction_id,
    0,
    1,
    2,
    'DEBT_AGING',
    '{"customerNumber":"INT-60001","currency":"SR"}'::jsonb,
    '{"customerNumber":"INT-60001","currency":"SR"}'::jsonb,
    0.95,
    'INVALID'
  ) RETURNING id INTO row_id;

  BEGIN
    UPDATE extracted_rows
    SET review_decision = 'ACCEPT',
        reviewed_at = now(),
        reviewed_by = actor_id
    WHERE id = row_id;
    RAISE EXCEPTION 'expected invalid extracted row acceptance to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected invalid extracted row acceptance to be rejected' THEN
      RAISE;
    END IF;
  END;

  UPDATE extracted_rows
  SET validation_status = 'VALID',
      review_decision = 'ACCEPT',
      reviewed_at = now(),
      reviewed_by = actor_id
  WHERE id = row_id;

  BEGIN
    UPDATE extracted_rows
    SET approved_at = now(),
        approved_by = actor_id
    WHERE id = row_id;
    RAISE EXCEPTION 'expected same reviewer and approver to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected same reviewer and approver to be rejected' THEN
      RAISE;
    END IF;
  END;

  UPDATE extracted_rows
  SET approved_at = now(),
      approved_by = reviewer_id
  WHERE id = row_id;
END;
$$;

ROLLBACK;
