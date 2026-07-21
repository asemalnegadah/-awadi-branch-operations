BEGIN;

DO $$
DECLARE
  manager_id uuid;
  branch_manager_role_id uuid;
  customer_id_value uuid;
  account_id_value uuid;
  restriction_id_value uuid;
  exception_id_value uuid;
  usage_id_value uuid;
  reversal_id_value uuid;
  usage_count integer;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('credit.usage.manager@example.test', 'مدير اختبار استهلاك الاستثناء', 'ACTIVE')
  RETURNING id INTO manager_id;

  SELECT id INTO branch_manager_role_id FROM roles WHERE code = 'BRANCH_MANAGER';
  INSERT INTO user_roles (user_id, role_id, granted_by)
  VALUES (manager_id, branch_manager_role_id, manager_id);

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('RISK-USAGE-001', 'عميل اختبار استهلاك الاستثناء', manager_id, manager_id)
  RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (customer_id, currency_code, credit_limit_minor, created_by)
  VALUES (customer_id_value, 'SR', 100000, manager_id)
  RETURNING id INTO account_id_value;

  INSERT INTO credit_restrictions (
    customer_id,
    customer_account_id,
    currency_code,
    decision_type,
    reason_code,
    reason_text,
    effective_from,
    expires_at,
    restoration_conditions,
    proposed_by,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_id_value,
    'SR',
    'BLOCK',
    'OLD_DEBT',
    'دين قديم يحتاج منعًا ائتمانيًا.',
    now() - interval '1 hour',
    now() + interval '30 days',
    'سداد الدين واعتماد المدير.',
    manager_id,
    'risk-usage-restriction-001'
  ) RETURNING id INTO restriction_id_value;

  UPDATE credit_restrictions
  SET state = 'PENDING_APPROVAL', submitted_by = manager_id, submitted_at = now()
  WHERE id = restriction_id_value;

  UPDATE credit_restrictions
  SET state = 'ACTIVE', approved_by = manager_id, approved_at = now()
  WHERE id = restriction_id_value;

  INSERT INTO credit_exceptions (
    restriction_id,
    customer_id,
    customer_account_id,
    currency_code,
    scope,
    max_amount_minor,
    valid_from,
    valid_until,
    reason,
    conditions,
    proposed_by,
    idempotency_key
  ) VALUES (
    restriction_id_value,
    customer_id_value,
    account_id_value,
    'SR',
    'SINGLE_TRANSACTION',
    10000,
    now() - interval '5 minutes',
    now() + interval '1 day',
    'عملية استثنائية واحدة.',
    'عملية واحدة وبحد أقصى 100.00 SR.',
    manager_id,
    'risk-usage-exception-001'
  ) RETURNING id INTO exception_id_value;

  UPDATE credit_exceptions
  SET state = 'PENDING_APPROVAL', submitted_by = manager_id, submitted_at = now()
  WHERE id = exception_id_value;

  UPDATE credit_exceptions
  SET state = 'ACTIVE', approved_by = manager_id, approved_at = now()
  WHERE id = exception_id_value;

  INSERT INTO credit_exception_usage_entries (
    exception_id,
    amount_minor,
    source_type,
    source_id,
    actor_user_id,
    request_id,
    idempotency_key,
    metadata
  ) VALUES (
    exception_id_value,
    7500,
    'CREDIT_SALE',
    'SALE-RISK-USAGE-001',
    manager_id,
    gen_random_uuid(),
    'risk-usage-consume-001',
    '{"document":"SALE-RISK-USAGE-001"}'::jsonb
  ) RETURNING id INTO usage_id_value;

  IF NOT EXISTS (
    SELECT 1
    FROM credit_exception_usage_entries
    WHERE id = usage_id_value
      AND restriction_id = restriction_id_value
      AND customer_id = customer_id_value
      AND customer_account_id = account_id_value
      AND currency_code = 'SR'
      AND direction = 'CONSUME'
  ) THEN
    RAISE EXCEPTION 'credit exception usage did not derive its governed identity';
  END IF;

  BEGIN
    INSERT INTO credit_exception_usage_entries (
      exception_id,
      amount_minor,
      source_type,
      source_id,
      actor_user_id,
      request_id,
      idempotency_key
    ) VALUES (
      exception_id_value,
      1000,
      'CREDIT_SALE',
      'SALE-RISK-USAGE-002',
      manager_id,
      gen_random_uuid(),
      'risk-usage-consume-002'
    );
    RAISE EXCEPTION 'expected single transaction reuse to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected single transaction reuse to fail' THEN RAISE; END IF;
    IF position('single-transaction credit exception has already been consumed' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected single transaction reuse error: %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO usage_count
  FROM credit_exception_usage_entries
  WHERE exception_id = exception_id_value;
  IF usage_count <> 1 THEN
    RAISE EXCEPTION 'failed consume attempt left an unexpected row';
  END IF;

  INSERT INTO credit_exception_usage_entries (
    exception_id,
    restriction_id,
    customer_id,
    customer_account_id,
    currency_code,
    direction,
    amount_minor,
    source_type,
    source_id,
    reversal_of_usage_id,
    actor_user_id,
    request_id,
    idempotency_key,
    reason
  ) SELECT
    exception_id,
    restriction_id,
    customer_id,
    customer_account_id,
    currency_code,
    'REVERSE',
    amount_minor,
    source_type,
    source_id,
    id,
    manager_id,
    gen_random_uuid(),
    'risk-usage-reverse-001',
    'إلغاء العملية الأصلية.'
  FROM credit_exception_usage_entries
  WHERE id = usage_id_value
  RETURNING id INTO reversal_id_value;

  BEGIN
    UPDATE credit_exception_usage_entries
    SET reason = 'تعديل غير مسموح'
    WHERE id = reversal_id_value;
    RAISE EXCEPTION 'expected credit exception usage update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected credit exception usage update to fail' THEN RAISE; END IF;
  END;

  INSERT INTO credit_exception_usage_entries (
    exception_id,
    amount_minor,
    source_type,
    source_id,
    actor_user_id,
    request_id,
    idempotency_key
  ) VALUES (
    exception_id_value,
    5000,
    'CREDIT_SALE',
    'SALE-RISK-USAGE-003',
    manager_id,
    gen_random_uuid(),
    'risk-usage-consume-003'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM permissions AS permission
    JOIN role_permissions AS grant_row ON grant_row.permission_id = permission.id
    WHERE permission.code = 'credit_exceptions.consume'
      AND grant_row.role_id = branch_manager_role_id
  ) THEN
    RAISE EXCEPTION 'BRANCH_MANAGER credit exception consume permission is missing';
  END IF;
END;
$$;

ROLLBACK;
