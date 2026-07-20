BEGIN;

DO $$
DECLARE
  actor_id uuid;
  representative_id_value uuid;
  customer_id_value uuid;
  account_id_value uuid;
  promise_id_value uuid;
  payload_value jsonb;
  audit_metadata jsonb;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('promise.0021.actor@example.test', 'مستخدم اختبار 0021', 'ACTIVE')
  RETURNING id INTO actor_id;

  INSERT INTO sales_representatives (
    full_name_ar,
    user_id,
    representative_type,
    status
  ) VALUES (
    'مندوب اختبار 0021',
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
    'PROMISE-0021-001',
    'عميل اختبار حماية الحمولة',
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
    next_follow_up_at,
    debt_reason,
    created_by,
    updated_by,
    idempotency_key,
    create_payload
  ) VALUES (
    customer_id_value,
    account_id_value,
    representative_id_value,
    'SR',
    1500,
    DATE '2026-07-20',
    DATE '2026-07-22',
    TIMESTAMPTZ '2026-07-21 09:30:00+03',
    'اختبار اشتقاق الحمولة من الأعمدة',
    actor_id,
    actor_id,
    'promise-0021-create-001',
    '{"spoofed": true, "promisedAmountMinor": 999999}'::jsonb
  ) RETURNING id, create_payload INTO promise_id_value, payload_value;

  IF payload_value ? 'spoofed'
    OR payload_value ->> 'customerId' <> customer_id_value::text
    OR payload_value ->> 'customerAccountId' <> account_id_value::text
    OR payload_value ->> 'representativeId' <> representative_id_value::text
    OR payload_value ->> 'currencyCode' <> 'SR'
    OR (payload_value ->> 'promisedAmountMinor')::bigint <> 1500
    OR payload_value ->> 'nextFollowUpAt' <> '2026-07-21T06:30:00.000Z' THEN
    RAISE EXCEPTION 'payment promise create payload was not derived canonically: %', payload_value;
  END IF;

  BEGIN
    UPDATE payment_promises
    SET create_payload = jsonb_set(create_payload, '{notes}', '"changed"'::jsonb)
    WHERE id = promise_id_value;
    RAISE EXCEPTION 'expected create_payload mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected create_payload mutation to fail' THEN
      RAISE;
    END IF;
  END;

  INSERT INTO audit_logs (
    actor_user_id,
    actor_type,
    action,
    resource_type,
    resource_id,
    request_id,
    result,
    metadata
  ) VALUES (
    actor_id,
    'USER',
    'promises.test',
    'PAYMENT_PROMISE',
    promise_id_value::text,
    gen_random_uuid(),
    'SUCCESS',
    '{"operating_mode": "SINGLE_BRANCH_ADEN", "marker": "preserved"}'::jsonb
  ) RETURNING metadata INTO audit_metadata;

  IF audit_metadata ->> 'operating_mode' <> 'SINGLE_MANAGER'
    OR audit_metadata ->> 'marker' <> 'preserved' THEN
    RAISE EXCEPTION 'payment promise audit mode was not enforced: %', audit_metadata;
  END IF;

  UPDATE organization_settings
  SET operating_mode = 'MULTI_USER'
  WHERE singleton_id = 1;

  INSERT INTO audit_logs (
    actor_user_id,
    actor_type,
    action,
    resource_type,
    resource_id,
    request_id,
    result,
    metadata
  ) VALUES (
    actor_id,
    'USER',
    'promises.test.multi',
    'PAYMENT_PROMISE',
    promise_id_value::text,
    gen_random_uuid(),
    'SUCCESS',
    '{}'::jsonb
  ) RETURNING metadata INTO audit_metadata;

  IF audit_metadata ->> 'operating_mode' <> 'MULTI_USER' THEN
    RAISE EXCEPTION 'multi-user audit mode was not recorded: %', audit_metadata;
  END IF;
END;
$$;

ROLLBACK;
