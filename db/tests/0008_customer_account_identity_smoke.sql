BEGIN;

DO $$
DECLARE
  actor_id uuid;
  customer_id_value uuid;
  second_customer_id uuid;
  sr_account_id uuid;
  rg_account_id uuid;
  file_id uuid;
  extraction_id uuid;
  row_id uuid;
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('identity.match@example.test', 'مستخدم اختبار الهوية', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO customers (
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    '60001',
    'مؤسسة عبدالله محمد للتجارة',
    actor_id,
    actor_id
  ) RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    account_number,
    account_number_source,
    created_by
  ) VALUES (
    customer_id_value,
    'SR',
    '60 001',
    'IMPORT',
    actor_id
  ) RETURNING id INTO sr_account_id;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    account_number,
    account_number_source,
    created_by
  ) VALUES (
    customer_id_value,
    'RG',
    '60 001',
    'IMPORT',
    actor_id
  ) RETURNING id INTO rg_account_id;

  IF sr_account_id IS NULL OR rg_account_id IS NULL THEN
    RAISE EXCEPTION 'expected same customer number to be allowed across SR and RG';
  END IF;

  INSERT INTO customers (
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    '60002',
    'عميل آخر',
    actor_id,
    actor_id
  ) RETURNING id INTO second_customer_id;

  BEGIN
    INSERT INTO customer_accounts (
      customer_id,
      currency_code,
      account_number,
      account_number_source,
      created_by
    ) VALUES (
      second_customer_id,
      'SR',
      '60001',
      'IMPORT',
      actor_id
    );
    RAISE EXCEPTION 'expected duplicate SR customer number to be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

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
    'كشف أعمار ديون.pdf',
    'application/pdf',
    2048,
    repeat('b', 64),
    'TEST',
    'uploads/test/truncated-name.pdf',
    actor_id,
    actor_id,
    'identity-file-001'
  ) RETURNING id INTO file_id;

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
    'identity-test-extractor',
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
    '{"customerNumber":"60001","customerName":"مؤسسة عبدالله محمد","currency":"SR"}'::jsonb,
    '{}'::jsonb,
    0.95,
    'VALID'
  ) RETURNING id INTO row_id;

  INSERT INTO extracted_customer_identity_matches (
    extracted_row_id,
    extracted_customer_number,
    extracted_currency,
    extracted_customer_name,
    matched_customer_id,
    matched_customer_account_id,
    canonical_customer_name,
    name_relationship,
    match_status,
    confidence,
    auto_link_allowed,
    signals,
    warnings,
    resolver_name,
    resolver_version,
    created_by
  ) VALUES (
    row_id,
    '60 001',
    'SR',
    'مؤسسة عبدالله محمد',
    customer_id_value,
    sr_account_id,
    'مؤسسة عبدالله محمد للتجارة',
    'TRUNCATED_PREFIX',
    'MATCHED_BY_CUSTOMER_NUMBER',
    0.99,
    true,
    '["EXACT_CUSTOMER_NUMBER_AND_CURRENCY","TRUNCATED_NAME_PREFIX"]'::jsonb,
    '["اسم العميل مقطوع وتم استخدام الاسم الكامل من السجل الرئيسي"]'::jsonb,
    'customer-account-resolver',
    '1.0.0',
    actor_id
  );

  BEGIN
    INSERT INTO extracted_customer_identity_matches (
      extracted_row_id,
      extracted_customer_number,
      extracted_currency,
      extracted_customer_name,
      matched_customer_id,
      matched_customer_account_id,
      canonical_customer_name,
      name_relationship,
      match_status,
      confidence,
      auto_link_allowed,
      resolver_name,
      resolver_version,
      created_by
    ) VALUES (
      row_id,
      '99999',
      'SR',
      'مؤسسة عبدالله محمد',
      customer_id_value,
      sr_account_id,
      'مؤسسة عبدالله محمد للتجارة',
      'TRUNCATED_PREFIX',
      'MATCHED_BY_CUSTOMER_NUMBER',
      0.99,
      true,
      'customer-account-resolver',
      '1.0.0',
      actor_id
    );
    RAISE EXCEPTION 'expected mismatched customer account number to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected mismatched customer account number to be rejected' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
