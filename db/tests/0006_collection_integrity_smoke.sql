BEGIN;

DO $$
DECLARE
  creator_id uuid;
  reviewer_id uuid;
  approver_id uuid;
  rep_id uuid;
  customer_id_value uuid;
  account_id_value uuid;
  collection_id_value uuid;
  ledger_id_value uuid;
  history_count integer;
BEGIN
  INSERT INTO users (email, full_name, status)
  VALUES ('creator@example.test', 'منشئ تجريبي', 'ACTIVE')
  RETURNING id INTO creator_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('reviewer@example.test', 'مراجع تجريبي', 'ACTIVE')
  RETURNING id INTO reviewer_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('approver@example.test', 'معتمد تجريبي', 'ACTIVE')
  RETURNING id INTO approver_id;

  INSERT INTO sales_representatives (full_name_ar, user_id, representative_type)
  VALUES ('مندوب تجريبي', creator_id, 'RETAIL')
  RETURNING id INTO rep_id;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('TEST-001', 'عميل تجريبي', creator_id, creator_id)
  RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (
    customer_id,
    currency_code,
    created_by
  ) VALUES (
    customer_id_value,
    'SR',
    creator_id
  ) RETURNING id INTO account_id_value;

  INSERT INTO collections (
    customer_id,
    customer_account_id,
    representative_id,
    currency_code,
    amount_minor,
    payment_method,
    collected_at,
    receipt_number,
    state,
    created_by,
    updated_by,
    idempotency_key
  ) VALUES (
    customer_id_value,
    account_id_value,
    rep_id,
    'SR',
    10000,
    'CASH',
    now(),
    'TEST-RCPT-001',
    'DRAFT',
    creator_id,
    creator_id,
    'test-collection-001'
  ) RETURNING id INTO collection_id_value;

  UPDATE collections
  SET amount_minor = 12000,
      updated_by = creator_id
  WHERE id = collection_id_value;

  PERFORM set_config('app.request_id', gen_random_uuid()::text, true);
  UPDATE collections
  SET state = 'SUBMITTED',
      updated_by = creator_id
  WHERE id = collection_id_value;

  BEGIN
    UPDATE collections
    SET amount_minor = 13000,
        updated_by = creator_id
    WHERE id = collection_id_value;
    RAISE EXCEPTION 'expected frozen collection fields to reject update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected frozen collection fields to reject update' THEN
      RAISE;
    END IF;
  END;

  UPDATE collections
  SET state = 'REVIEWED',
      reviewed_at = now(),
      reviewed_by = reviewer_id,
      updated_by = reviewer_id
  WHERE id = collection_id_value;

  UPDATE collections
  SET state = 'APPROVED',
      approved_at = now(),
      approved_by = approver_id,
      updated_by = approver_id
  WHERE id = collection_id_value;

  INSERT INTO representative_cash_custody_events (
    representative_id,
    currency_code,
    amount_minor,
    direction,
    event_type,
    occurred_at,
    recorded_by,
    source_type,
    source_id,
    idempotency_key
  ) VALUES (
    rep_id,
    'SR',
    12000,
    'IN',
    'COLLECTION_IN',
    now(),
    approver_id,
    'COLLECTION',
    collection_id_value::text,
    'test-custody-in-001'
  );

  BEGIN
    INSERT INTO representative_cash_custody_events (
      representative_id,
      currency_code,
      amount_minor,
      direction,
      event_type,
      occurred_at,
      recorded_by,
      received_by,
      source_type,
      source_id,
      idempotency_key
    ) VALUES (
      rep_id,
      'SR',
      13000,
      'OUT',
      'HANDOVER_OUT',
      now(),
      approver_id,
      reviewer_id,
      'CASH_HANDOVER',
      'TEST-HO-OVER',
      'test-custody-out-over'
    );
    RAISE EXCEPTION 'expected custody overdraft to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected custody overdraft to be rejected' THEN
      RAISE;
    END IF;
  END;

  UPDATE collections
  SET state = 'CASH_RECEIVED',
      cash_received_at = now(),
      cash_received_by = reviewer_id,
      updated_by = reviewer_id
  WHERE id = collection_id_value;

  INSERT INTO customer_ledger_entries (
    customer_id,
    customer_account_id,
    currency_code,
    direction,
    entry_type,
    amount_minor,
    accounting_date,
    source_type,
    source_id,
    idempotency_key,
    posted_at,
    posted_by,
    request_id
  ) VALUES (
    customer_id_value,
    account_id_value,
    'SR',
    'CREDIT',
    'COLLECTION',
    12000,
    current_date,
    'COLLECTION',
    collection_id_value::text,
    'test-ledger-collection-001',
    now(),
    reviewer_id,
    gen_random_uuid()
  ) RETURNING id INTO ledger_id_value;

  UPDATE collections
  SET state = 'RECONCILED',
      ledger_entry_id = ledger_id_value,
      reconciled_at = now(),
      reconciled_by = reviewer_id,
      updated_by = reviewer_id
  WHERE id = collection_id_value;

  SELECT COUNT(*)
  INTO history_count
  FROM collection_state_history
  WHERE collection_id = collection_id_value;

  IF history_count <> 6 THEN
    RAISE EXCEPTION 'expected 6 collection history rows, got %', history_count;
  END IF;

  BEGIN
    DELETE FROM collections WHERE id = collection_id_value;
    RAISE EXCEPTION 'expected collection deletion to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected collection deletion to be rejected' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
