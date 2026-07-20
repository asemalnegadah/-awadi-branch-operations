BEGIN;

DO $$
DECLARE
  actor_id uuid;
  representative_id_value uuid;
  customer_id_value uuid;
  account_id_value uuid;
  promise_id_value uuid;
  event_id_value uuid;
  followup_id_value uuid;
  remaining_value bigint;
  next_followup_value timestamptz;
  permission_count integer;
  manager_grant_count integer;
  has_branch_id boolean;
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('promise.smoke.actor@example.test', 'مستخدم اختبار الوعود', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO sales_representatives (
    full_name_ar,
    user_id,
    representative_type,
    status
  ) VALUES (
    'مندوب اختبار الوعود',
    actor_id,
    'RETAIL',
    'ACTIVE'
  ) RETURNING id INTO representative_id_value;

  INSERT INTO customers (
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    'PROMISE-SMOKE-001',
    'عميل اختبار وعود السداد',
    actor_id,
    actor_id
  ) RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    created_by
  ) VALUES (
    customer_id_value,
    'SR',
    actor_id
  ) RETURNING id INTO account_id_value;

  INSERT INTO payment_promises (
    customer_id,
    customer_account_id,
    representative_id,
    currency_code,
    promised_amount_minor,
    promise_date,
    due_date,
    debt_reason,
    created_by,
    updated_by,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_id_value,
    representative_id_value,
    'SR',
    10000,
    current_date,
    current_date + 1,
    'اختبار سلامة نموذج الوعود',
    actor_id,
    actor_id,
    'promise-smoke-create-001'
  ) RETURNING id, remaining_amount_minor
    INTO promise_id_value, remaining_value;

  IF remaining_value <> 10000 THEN
    RAISE EXCEPTION 'expected remaining promise amount 10000, got %', remaining_value;
  END IF;

  BEGIN
    UPDATE payment_promises
    SET fulfilled_amount_minor = 1000,
        updated_by = actor_id
    WHERE id = promise_id_value;
    RAISE EXCEPTION 'expected manual fulfilled amount update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected manual fulfilled amount update to fail' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO payment_promises (
      customer_id,
      customer_account_id,
      representative_id,
      currency_code,
      promised_amount_minor,
      promise_date,
      due_date,
      debt_reason,
      created_by,
      updated_by,
      idempotency_key
    ) VALUES (
      customer_id_value,
      account_id_value,
      representative_id_value,
      'USD',
      1000,
      current_date,
      current_date,
      'عملة غير مسموحة',
      actor_id,
      actor_id,
      'promise-smoke-invalid-currency'
    );
    RAISE EXCEPTION 'expected unsupported currency to fail';
  EXCEPTION WHEN foreign_key_violation OR check_violation OR raise_exception THEN
    IF SQLERRM = 'expected unsupported currency to fail' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO payment_promises (
      customer_id,
      customer_account_id,
      representative_id,
      currency_code,
      promised_amount_minor,
      promise_date,
      due_date,
      debt_reason,
      created_by,
      updated_by,
      idempotency_key
    ) VALUES (
      customer_id_value,
      account_id_value,
      representative_id_value,
      'SR',
      -1,
      current_date,
      current_date,
      'مبلغ سالب',
      actor_id,
      actor_id,
      'promise-smoke-negative-amount'
    );
    RAISE EXCEPTION 'expected negative promise amount to fail';
  EXCEPTION WHEN check_violation OR raise_exception THEN
    IF SQLERRM = 'expected negative promise amount to fail' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO payment_promise_events (
    promise_id,
    actor_user_id,
    request_id,
    event_type,
    new_values
  ) VALUES (
    promise_id_value,
    actor_id,
    gen_random_uuid(),
    'CREATED',
    jsonb_build_object('promiseId', promise_id_value)
  ) RETURNING id INTO event_id_value;

  BEGIN
    UPDATE payment_promise_events
    SET reason = 'تعديل غير مسموح'
    WHERE id = event_id_value;
    RAISE EXCEPTION 'expected promise event update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected promise event update to fail' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM payment_promise_events WHERE id = event_id_value;
    RAISE EXCEPTION 'expected promise event delete to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected promise event delete to fail' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO payment_promise_followups (
    promise_id,
    scheduled_at,
    notes,
    created_by,
    request_id,
    idempotency_key
  ) VALUES (
    promise_id_value,
    now() + interval '1 day',
    'متابعة تجريبية',
    actor_id,
    gen_random_uuid(),
    'promise-smoke-followup-001'
  ) RETURNING id, scheduled_at INTO followup_id_value, next_followup_value;

  SELECT next_follow_up_at
  INTO next_followup_value
  FROM payment_promises
  WHERE id = promise_id_value;

  IF next_followup_value IS NULL THEN
    RAISE EXCEPTION 'expected promise next follow-up to be synchronized';
  END IF;

  BEGIN
    UPDATE payment_promise_followups
    SET notes = 'تعديل غير مسموح'
    WHERE id = followup_id_value;
    RAISE EXCEPTION 'expected follow-up update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected follow-up update to fail' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM payment_promises WHERE id = promise_id_value;
    RAISE EXCEPTION 'expected payment promise delete to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected payment promise delete to fail' THEN
      RAISE;
    END IF;
  END;

  SELECT COUNT(*) INTO permission_count
  FROM permissions
  WHERE code LIKE 'promises.%';

  IF permission_count <> 10 THEN
    RAISE EXCEPTION 'expected 10 promise permissions, got %', permission_count;
  END IF;

  SELECT COUNT(*) INTO manager_grant_count
  FROM role_permissions AS grant_row
  JOIN roles AS role ON role.id = grant_row.role_id
  JOIN permissions AS permission ON permission.id = grant_row.permission_id
  WHERE role.code = 'BRANCH_MANAGER'
    AND permission.code LIKE 'promises.%';

  IF manager_grant_count <> 10 THEN
    RAISE EXCEPTION 'expected branch manager to receive 10 promise permissions, got %', manager_grant_count;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'payment_promises',
        'payment_promise_events',
        'payment_promise_followups',
        'payment_promise_allocations'
      )
      AND column_name = 'branch_id'
  ) INTO has_branch_id;

  IF has_branch_id THEN
    RAISE EXCEPTION 'single-branch promise schema must not contain branch_id';
  END IF;
END;
$$;

ROLLBACK;
