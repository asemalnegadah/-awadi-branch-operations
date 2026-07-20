BEGIN;

DO $$
DECLARE
  actor_id uuid;
  representative_id_value uuid;
  customer_id_value uuid;
  account_id_value uuid;
  created_at_value timestamptz;
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('promise.cursor.smoke@example.test', 'مستخدم اختبار مؤشر الوعود', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO sales_representatives (
    full_name_ar,
    user_id,
    representative_type,
    status
  ) VALUES (
    'مندوب اختبار مؤشر الوعود',
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
    'PROMISE-CURSOR-SMOKE-001',
    'عميل اختبار مؤشر الوعود',
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
    created_at,
    updated_by,
    updated_at,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_id_value,
    representative_id_value,
    'SR',
    1000,
    current_date,
    current_date,
    'اختبار دقة مؤشر الصفحات',
    actor_id,
    clock_timestamp(),
    actor_id,
    clock_timestamp(),
    'promise-cursor-smoke-create-001'
  ) RETURNING created_at INTO created_at_value;

  IF mod(date_part('microseconds', created_at_value)::bigint, 1000) <> 0 THEN
    RAISE EXCEPTION 'payment promise created_at must be normalized to milliseconds';
  END IF;
END;
$$;

ROLLBACK;
