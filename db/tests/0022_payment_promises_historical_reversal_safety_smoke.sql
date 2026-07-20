BEGIN;

DO $$
DECLARE
  actor_id uuid;
  representative_id_value uuid;
  customer_id_value uuid;
  account_id_value uuid;
  promise_id_value uuid;
  promise_version integer;
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('promise.0022.actor@example.test', 'مستخدم اختبار 0022', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO sales_representatives (
    full_name_ar,
    user_id,
    representative_type,
    status
  ) VALUES (
    'مندوب اختبار 0022',
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
    'PROMISE-0022-001',
    'عميل اختبار العكس التاريخي',
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
    1500,
    current_date,
    current_date + 1,
    'اختبار استمرار التصحيح المالي بعد تعليق الحساب',
    actor_id,
    actor_id,
    'promise-0022-create-001'
  ) RETURNING id INTO promise_id_value;

  UPDATE customer_accounts
  SET status = 'SUSPENDED'
  WHERE id = account_id_value;

  -- This is the same narrowly scoped transaction-local marker used by the
  -- allocation synchronization trigger after an allocation or reversal.
  PERFORM set_config('app.promise_financial_write', promise_id_value::text, true);

  UPDATE payment_promises
  SET updated_by = actor_id
  WHERE id = promise_id_value;

  SELECT version
  INTO promise_version
  FROM payment_promises
  WHERE id = promise_id_value;

  IF promise_version <> 2 THEN
    RAISE EXCEPTION 'expected internal financial synchronization to advance version, got %', promise_version;
  END IF;

  PERFORM set_config('app.promise_financial_write', '', true);

  BEGIN
    UPDATE payment_promises
    SET notes = 'تعديل تشغيلي غير مسموح على حساب معلق',
        updated_by = actor_id
    WHERE id = promise_id_value;
    RAISE EXCEPTION 'expected normal update on suspended account to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected normal update on suspended account to fail' THEN
      RAISE;
    END IF;

    IF position('promise customer account is unavailable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected suspended-account error: %', SQLERRM;
    END IF;
  END;
END;
$$;

ROLLBACK;
