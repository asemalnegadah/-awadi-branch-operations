BEGIN;

DO $$
DECLARE
  manager_id uuid;
  system_admin_role_id uuid;
  branch_manager_role_id uuid;
  customer_id_value uuid;
  account_sr_id uuid;
  account_rg_id uuid;
  first_assessment_id uuid;
  second_assessment_id uuid;
  current_assessment_id uuid;
  restriction_id_value uuid;
  second_restriction_id uuid;
  restriction_event_id uuid;
  exception_id_value uuid;
  exception_event_id uuid;
  permission_count integer;
  system_admin_grant_count integer;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('credit.risk.manager@example.test', 'مدير اختبار المخاطر', 'ACTIVE')
  RETURNING id INTO manager_id;

  SELECT id INTO branch_manager_role_id FROM roles WHERE code = 'BRANCH_MANAGER';
  SELECT id INTO system_admin_role_id FROM roles WHERE code = 'SYSTEM_ADMIN';

  IF branch_manager_role_id IS NULL OR system_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'required system roles are missing';
  END IF;

  INSERT INTO user_roles (user_id, role_id, granted_by)
  VALUES (manager_id, branch_manager_role_id, manager_id);

  INSERT INTO customers (
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    'RISK-SMOKE-001',
    'عميل اختبار المخاطر والمنع',
    manager_id,
    manager_id
  ) RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    credit_limit_minor,
    created_by
  ) VALUES (
    customer_id_value,
    'SR',
    100000,
    manager_id
  ) RETURNING id INTO account_sr_id;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    credit_limit_minor,
    created_by
  ) VALUES (
    customer_id_value,
    'RG',
    50000,
    manager_id
  ) RETURNING id INTO account_rg_id;

  INSERT INTO credit_risk_assessments (
    customer_id,
    customer_account_id,
    currency_code,
    cutoff_at,
    ruleset_version,
    score,
    risk_level,
    recommended_action,
    automatic_block_recommended,
    data_quality_score,
    factors,
    missing_inputs,
    source_snapshot,
    input_fingerprint,
    assessed_by,
    request_id,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_sr_id,
    'SR',
    TIMESTAMPTZ '2026-07-20 23:00:00+03',
    'credit-risk-v1',
    55,
    'HIGH',
    'LIMIT',
    false,
    90,
    '[{"code":"BROKEN_PROMISES","points":16}]'::jsonb,
    ARRAY['daysSinceLastVisit'],
    '{"outstandingMinor":150000,"currencyCode":"SR"}'::jsonb,
    repeat('a', 64),
    manager_id,
    gen_random_uuid(),
    'risk-smoke-assessment-001'
  ) RETURNING id INTO first_assessment_id;

  INSERT INTO credit_risk_assessments (
    customer_id,
    customer_account_id,
    currency_code,
    cutoff_at,
    ruleset_version,
    score,
    risk_level,
    recommended_action,
    automatic_block_recommended,
    data_quality_score,
    factors,
    source_snapshot,
    input_fingerprint,
    supersedes_assessment_id,
    assessed_by,
    request_id,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_sr_id,
    'SR',
    TIMESTAMPTZ '2026-07-21 08:00:00+03',
    'credit-risk-v1',
    80,
    'CRITICAL',
    'BLOCK',
    true,
    100,
    '[{"code":"AGING_OVER_180","points":25},{"code":"BROKEN_PROMISES","points":24}]'::jsonb,
    '{"outstandingMinor":250000,"currencyCode":"SR"}'::jsonb,
    repeat('b', 64),
    first_assessment_id,
    manager_id,
    gen_random_uuid(),
    'risk-smoke-assessment-002'
  ) RETURNING id INTO second_assessment_id;

  SELECT id
  INTO current_assessment_id
  FROM current_credit_risk_assessments
  WHERE customer_account_id = account_sr_id;

  IF current_assessment_id IS DISTINCT FROM second_assessment_id THEN
    RAISE EXCEPTION 'current credit risk view did not select newest assessment';
  END IF;

  BEGIN
    UPDATE credit_risk_assessments
    SET score = 10
    WHERE id = first_assessment_id;
    RAISE EXCEPTION 'expected assessment update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected assessment update to fail' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM credit_risk_assessments WHERE id = first_assessment_id;
    RAISE EXCEPTION 'expected assessment delete to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected assessment delete to fail' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO credit_risk_assessments (
      customer_id,
      customer_account_id,
      currency_code,
      cutoff_at,
      ruleset_version,
      score,
      risk_level,
      recommended_action,
      automatic_block_recommended,
      data_quality_score,
      factors,
      source_snapshot,
      input_fingerprint,
      assessed_by,
      request_id,
      idempotency_key
    ) VALUES (
      customer_id_value,
      account_sr_id,
      'RG',
      now(),
      'credit-risk-v1',
      0,
      'LOW',
      'NONE',
      false,
      100,
      '[]'::jsonb,
      '{}'::jsonb,
      repeat('c', 64),
      manager_id,
      gen_random_uuid(),
      'risk-smoke-invalid-currency'
    );
    RAISE EXCEPTION 'expected assessment currency mismatch to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected assessment currency mismatch to fail' THEN RAISE; END IF;
    IF position('credit risk currency does not match customer account' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected assessment mismatch error: %', SQLERRM;
    END IF;
  END;

  INSERT INTO credit_restrictions (
    customer_id,
    customer_account_id,
    currency_code,
    decision_type,
    state,
    reason_code,
    reason_text,
    source_assessment_id,
    effective_from,
    review_due_at,
    expires_at,
    restoration_conditions,
    proposed_by,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_sr_id,
    'SR',
    'BLOCK',
    'DRAFT',
    'BROKEN_PROMISE',
    'وعود مكسورة ودين متقادم.',
    second_assessment_id,
    now(),
    now() + interval '15 days',
    now() + interval '30 days',
    'سداد المتأخرات واعتماد مراجعة مدير الفرع.',
    manager_id,
    'risk-smoke-restriction-001'
  ) RETURNING id INTO restriction_id_value;

  BEGIN
    UPDATE credit_restrictions
    SET state = 'ACTIVE',
        submitted_by = manager_id,
        submitted_at = now(),
        approved_by = manager_id,
        approved_at = now()
    WHERE id = restriction_id_value;
    RAISE EXCEPTION 'expected direct draft-to-active transition to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected direct draft-to-active transition to fail' THEN RAISE; END IF;
    IF position('invalid credit restriction transition' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected direct transition error: %', SQLERRM;
    END IF;
  END;

  UPDATE credit_restrictions
  SET state = 'PENDING_APPROVAL',
      submitted_by = manager_id,
      submitted_at = now()
  WHERE id = restriction_id_value;

  UPDATE credit_restrictions
  SET state = 'ACTIVE',
      approved_by = manager_id,
      approved_at = now()
  WHERE id = restriction_id_value;

  INSERT INTO credit_restrictions (
    customer_id,
    customer_account_id,
    currency_code,
    decision_type,
    limit_amount_minor,
    state,
    reason_code,
    reason_text,
    effective_from,
    expires_at,
    restoration_conditions,
    proposed_by,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_sr_id,
    'SR',
    'LIMIT',
    10000,
    'DRAFT',
    'CREDIT_LIMIT_EXCEEDED',
    'اختبار منع وجود قرارين نافذين.',
    now(),
    now() + interval '10 days',
    'مراجعة الرصيد.',
    manager_id,
    'risk-smoke-restriction-002'
  ) RETURNING id INTO second_restriction_id;

  UPDATE credit_restrictions
  SET state = 'PENDING_APPROVAL',
      submitted_by = manager_id,
      submitted_at = now()
  WHERE id = second_restriction_id;

  BEGIN
    UPDATE credit_restrictions
    SET state = 'ACTIVE',
        approved_by = manager_id,
        approved_at = now()
    WHERE id = second_restriction_id;
    RAISE EXCEPTION 'expected duplicate active restriction to fail';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO credit_restriction_events (
    restriction_id,
    event_type,
    actor_user_id,
    request_id,
    new_values,
    reason,
    idempotency_key
  ) VALUES (
    restriction_id_value,
    'APPROVED',
    manager_id,
    gen_random_uuid(),
    jsonb_build_object('state', 'ACTIVE'),
    'اعتماد قرار المنع للاختبار.',
    'risk-smoke-restriction-event-001'
  ) RETURNING id INTO restriction_event_id;

  BEGIN
    UPDATE credit_restriction_events
    SET reason = 'تعديل غير مسموح'
    WHERE id = restriction_event_id;
    RAISE EXCEPTION 'expected restriction event update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected restriction event update to fail' THEN RAISE; END IF;
  END;

  INSERT INTO credit_exceptions (
    restriction_id,
    customer_id,
    customer_account_id,
    currency_code,
    scope,
    max_amount_minor,
    valid_from,
    valid_until,
    state,
    reason,
    conditions,
    proposed_by,
    idempotency_key
  ) VALUES (
    restriction_id_value,
    customer_id_value,
    account_sr_id,
    'SR',
    'SINGLE_TRANSACTION',
    5000,
    now() + interval '1 hour',
    now() + interval '1 day',
    'DRAFT',
    'طلب استثنائي موثق.',
    'عملية واحدة وبحد أقصى 50.00 SR.',
    manager_id,
    'risk-smoke-exception-001'
  ) RETURNING id INTO exception_id_value;

  UPDATE credit_exceptions
  SET state = 'PENDING_APPROVAL',
      submitted_by = manager_id,
      submitted_at = now()
  WHERE id = exception_id_value;

  UPDATE credit_exceptions
  SET state = 'ACTIVE',
      approved_by = manager_id,
      approved_at = now()
  WHERE id = exception_id_value;

  INSERT INTO credit_exception_events (
    exception_id,
    event_type,
    actor_user_id,
    request_id,
    new_values,
    reason,
    idempotency_key
  ) VALUES (
    exception_id_value,
    'APPROVED',
    manager_id,
    gen_random_uuid(),
    jsonb_build_object('state', 'ACTIVE'),
    'اعتماد الاستثناء للاختبار.',
    'risk-smoke-exception-event-001'
  ) RETURNING id INTO exception_event_id;

  BEGIN
    DELETE FROM credit_exception_events WHERE id = exception_event_id;
    RAISE EXCEPTION 'expected exception event delete to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected exception event delete to fail' THEN RAISE; END IF;
  END;

  SELECT COUNT(*)
  INTO permission_count
  FROM permissions
  WHERE code IN (
    'risk.read',
    'risk.recalculate',
    'risk.view_history',
    'credit_restrictions.propose',
    'credit_restrictions.approve',
    'credit_restrictions.revoke',
    'credit_exceptions.propose',
    'credit_exceptions.approve',
    'credit_exceptions.revoke'
  );

  IF permission_count <> 9 THEN
    RAISE EXCEPTION 'expected 9 credit risk permissions, got %', permission_count;
  END IF;

  SELECT COUNT(*)
  INTO system_admin_grant_count
  FROM role_permissions AS grant_row
  JOIN permissions AS permission ON permission.id = grant_row.permission_id
  WHERE grant_row.role_id = system_admin_role_id
    AND (
      permission.code LIKE 'risk.%'
      OR permission.code LIKE 'credit_restrictions.%'
      OR permission.code LIKE 'credit_exceptions.%'
    );

  IF system_admin_grant_count <> 0 THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN must not receive credit risk business permissions by default';
  END IF;

  IF account_rg_id IS NULL THEN
    RAISE EXCEPTION 'RG account fixture was not created';
  END IF;
END;
$$;

ROLLBACK;
