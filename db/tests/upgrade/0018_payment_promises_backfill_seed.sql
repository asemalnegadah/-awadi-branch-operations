BEGIN;

DO $$
DECLARE
  actor_id uuid := gen_random_uuid();
  representative_id_value uuid := gen_random_uuid();
  customer_id_value uuid := gen_random_uuid();
  account_id_value uuid := gen_random_uuid();
  fulfilled_promise_id uuid := gen_random_uuid();
  rejected_promise_id uuid := gen_random_uuid();
  cancelled_promise_id uuid := gen_random_uuid();
  partial_promise_id uuid := gen_random_uuid();
  fulfilled_collection_id uuid := gen_random_uuid();
  partial_collection_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO users (id, email, full_name, status)
  VALUES (
    actor_id,
    'promise.upgrade.actor@example.test',
    'مستخدم اختبار ترقية الوعود',
    'ACTIVE'
  );

  INSERT INTO sales_representatives (
    id, full_name_ar, user_id, representative_type, status
  ) VALUES (
    representative_id_value,
    'مندوب اختبار ترقية الوعود',
    actor_id,
    'RETAIL',
    'ACTIVE'
  );

  INSERT INTO customers (
    id, customer_number, trade_name_ar, created_by, updated_by
  ) VALUES (
    customer_id_value,
    'PROMISE-UPGRADE-001',
    'عميل اختبار ترقية الوعود',
    actor_id,
    actor_id
  );

  INSERT INTO customer_accounts (id, customer_id, currency_code, created_by)
  VALUES (account_id_value, customer_id_value, 'SR', actor_id);

  INSERT INTO payment_promises (
    id, customer_id, customer_account_id, representative_id, currency_code,
    promised_amount_minor, promise_date, due_date, next_follow_up_at,
    debt_reason, created_by, updated_by, idempotency_key
  ) VALUES
    (
      fulfilled_promise_id, customer_id_value, account_id_value,
      representative_id_value, 'SR', 1000, current_date, current_date,
      '2026-07-20T12:00:00+03:00'::timestamptz, 'وعد منفذ قديم',
      actor_id, actor_id, 'promise-upgrade-fulfilled'
    ),
    (
      rejected_promise_id, customer_id_value, account_id_value,
      representative_id_value, 'SR', 1000, current_date, current_date,
      NULL, 'وعد مرفوض قديم', actor_id, actor_id,
      'promise-upgrade-rejected'
    ),
    (
      cancelled_promise_id, customer_id_value, account_id_value,
      representative_id_value, 'SR', 1000, current_date, current_date,
      NULL, 'وعد ملغي قديم', actor_id, actor_id,
      'promise-upgrade-cancelled'
    ),
    (
      partial_promise_id, customer_id_value, account_id_value,
      representative_id_value, 'SR', 2000, current_date, current_date,
      '2026-07-21T13:15:00+03:00'::timestamptz, 'وعد منفذ جزئيًا قديم',
      actor_id, actor_id, 'promise-upgrade-partial'
    );

  INSERT INTO collections (
    id, customer_id, customer_account_id, representative_id, currency_code,
    amount_minor, payment_method, collected_at, receipt_number, state,
    created_by, updated_by, idempotency_key
  ) VALUES
    (
      fulfilled_collection_id, customer_id_value, account_id_value,
      representative_id_value, 'SR', 1000, 'CASH', now(),
      'PROMISE-UPGRADE-FULL', 'DRAFT', actor_id, actor_id,
      'promise-upgrade-collection-full'
    ),
    (
      partial_collection_id, customer_id_value, account_id_value,
      representative_id_value, 'SR', 500, 'CASH', now(),
      'PROMISE-UPGRADE-PARTIAL', 'DRAFT', actor_id, actor_id,
      'promise-upgrade-collection-partial'
    );

  ALTER TABLE payment_promise_allocations
    DISABLE TRIGGER payment_promise_allocations_validate;

  INSERT INTO payment_promise_allocations (
    promise_id, collection_id, currency_code, amount_minor, allocated_by,
    request_id, idempotency_key
  ) VALUES
    (
      fulfilled_promise_id, fulfilled_collection_id, 'SR', 1000, actor_id,
      gen_random_uuid(), 'promise-upgrade-allocation-full'
    ),
    (
      partial_promise_id, partial_collection_id, 'SR', 500, actor_id,
      gen_random_uuid(), 'promise-upgrade-allocation-partial'
    );

  ALTER TABLE payment_promise_allocations
    ENABLE TRIGGER payment_promise_allocations_validate;

  UPDATE payment_promises
  SET base_status = 'REJECTED',
      next_follow_up_at = NULL,
      rejected_at = now(),
      rejected_by = actor_id,
      rejection_reason = 'رفض قديم لاختبار الترقية',
      updated_by = actor_id
  WHERE id = rejected_promise_id;

  UPDATE payment_promises
  SET base_status = 'CANCELLED',
      next_follow_up_at = NULL,
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = 'إلغاء قديم لاختبار الترقية',
      updated_by = actor_id
  WHERE id = cancelled_promise_id;
END;
$$;

COMMIT;
