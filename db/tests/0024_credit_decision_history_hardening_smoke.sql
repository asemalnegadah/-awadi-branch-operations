BEGIN;

DO $$
DECLARE
  manager_id uuid;
  second_actor_id uuid;
  customer_id_value uuid;
  account_id_value uuid;
  assessment_id_value uuid;
  restriction_id_value uuid;
  exception_id_value uuid;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('credit.history.manager@example.test', 'مدير حماية قرارات الائتمان', 'ACTIVE')
  RETURNING id INTO manager_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('credit.history.other@example.test', 'مستخدم آخر لحماية التاريخ', 'ACTIVE')
  RETURNING id INTO second_actor_id;

  INSERT INTO customers (
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    'RISK-HISTORY-001',
    'عميل اختبار حماية تاريخ الائتمان',
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
  ) RETURNING id INTO account_id_value;

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
    account_id_value,
    'SR',
    now(),
    'credit-risk-v1',
    80,
    'CRITICAL',
    'BLOCK',
    true,
    100,
    '[{"code":"AGING_OVER_180","points":25}]'::jsonb,
    '{"currencyCode":"SR"}'::jsonb,
    repeat('d', 64),
    manager_id,
    gen_random_uuid(),
    'risk-history-assessment-001'
  ) RETURNING id INTO assessment_id_value;

  INSERT INTO credit_restrictions (
    customer_id,
    customer_account_id,
    currency_code,
    decision_type,
    reason_code,
    reason_text,
    source_assessment_id,
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
    'BROKEN_PROMISE',
    'حماية سجل المرسل والمعتمد.',
    assessment_id_value,
    now(),
    now() + interval '30 days',
    'سداد المتأخرات ومراجعة مدير الفرع.',
    manager_id,
    'risk-history-restriction-001'
  ) RETURNING id INTO restriction_id_value;

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

  BEGIN
    UPDATE credit_restrictions
    SET state = 'REVOKED',
        submitted_by = second_actor_id,
        submitted_at = now(),
        revoked_by = manager_id,
        revoked_at = now(),
        revocation_reason = 'محاولة تغيير المرسل التاريخي.'
    WHERE id = restriction_id_value;
    RAISE EXCEPTION 'expected restriction submission actor mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected restriction submission actor mutation to fail' THEN RAISE; END IF;
    IF position('credit restriction submission actor is immutable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected restriction actor protection error: %', SQLERRM;
    END IF;
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
    5000,
    now(),
    now() + interval '1 day',
    'استثناء مؤقت للاختبار.',
    'عملية واحدة موثقة.',
    manager_id,
    'risk-history-exception-001'
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

  BEGIN
    UPDATE credit_restrictions
    SET state = 'REVOKED',
        revoked_by = manager_id,
        revoked_at = now(),
        revocation_reason = 'لا يجوز قبل إنهاء الاستثناء.'
    WHERE id = restriction_id_value;
    RAISE EXCEPTION 'expected restriction ending with active exception to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected restriction ending with active exception to fail' THEN RAISE; END IF;
    IF position('active credit exceptions must be revoked or expired before ending the restriction' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected active exception parent guard error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    UPDATE credit_exceptions
    SET state = 'REVOKED',
        approved_by = second_actor_id,
        approved_at = now(),
        revoked_by = manager_id,
        revoked_at = now(),
        revocation_reason = 'محاولة تغيير المعتمد التاريخي.'
    WHERE id = exception_id_value;
    RAISE EXCEPTION 'expected exception approval actor mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected exception approval actor mutation to fail' THEN RAISE; END IF;
    IF position('credit exception approval actor is immutable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected exception actor protection error: %', SQLERRM;
    END IF;
  END;

  UPDATE credit_exceptions
  SET state = 'REVOKED',
      revoked_by = manager_id,
      revoked_at = now(),
      revocation_reason = 'إنهاء الاستثناء قبل القرار الأب.'
  WHERE id = exception_id_value;

  UPDATE credit_restrictions
  SET state = 'REVOKED',
      revoked_by = manager_id,
      revoked_at = now(),
      revocation_reason = 'إنهاء القرار بعد إنهاء الاستثناء.'
  WHERE id = restriction_id_value;

  IF NOT EXISTS (
    SELECT 1 FROM credit_restrictions
    WHERE id = restriction_id_value
      AND state = 'REVOKED'
      AND submitted_by = manager_id
      AND approved_by = manager_id
  ) THEN
    RAISE EXCEPTION 'restriction history was not preserved after valid revocation';
  END IF;
END;
$$;

ROLLBACK;
