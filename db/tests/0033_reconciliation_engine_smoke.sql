BEGIN;

DO $$
DECLARE
  manager_id uuid;
  branch_manager_role_id uuid;
  system_admin_role_id uuid;
  customer_id_value uuid;
  sr_account_id uuid;
  rg_account_id uuid;
  reconciliation_id_value uuid;
  matched_id_value uuid;
  ledger_entry_id_value uuid;
  settlement_id_value uuid;
  event_count integer;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('reconciliation.manager@example.test', 'مدير اختبار المطابقات', 'ACTIVE')
  RETURNING id INTO manager_id;

  SELECT id INTO branch_manager_role_id FROM roles WHERE code = 'BRANCH_MANAGER';
  SELECT id INTO system_admin_role_id FROM roles WHERE code = 'SYSTEM_ADMIN';
  INSERT INTO user_roles (user_id, role_id, granted_by)
  VALUES (manager_id, branch_manager_role_id, manager_id);

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('RECON-001', 'عميل اختبار المطابقة', manager_id, manager_id)
  RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (customer_id, currency_code, created_by)
  VALUES (customer_id_value, 'SR', manager_id)
  RETURNING id INTO sr_account_id;
  INSERT INTO customer_accounts (customer_id, currency_code, created_by)
  VALUES (customer_id_value, 'RG', manager_id)
  RETURNING id INTO rg_account_id;

  PERFORM set_config('app.request_id', gen_random_uuid()::text, true);
  INSERT INTO reconciliation_cases (
    customer_id, customer_account_id, currency_code,
    source_kind, source_type, source_id, cutoff_date,
    expected_amount_minor, observed_amount_minor,
    created_by, updated_by, idempotency_key
  ) VALUES (
    customer_id_value, sr_account_id, 'SR',
    'LEDGER_TO_STATEMENT', 'ONYX_STATEMENT', 'RECON-SOURCE-001', CURRENT_DATE,
    100000, 105000,
    manager_id, manager_id, 'reconciliation-create-001'
  ) RETURNING id INTO reconciliation_id_value;

  IF NOT EXISTS (
    SELECT 1 FROM reconciliation_cases
    WHERE id = reconciliation_id_value
      AND difference_amount_minor = 5000
      AND create_payload ->> 'sourceId' = 'RECON-SOURCE-001'
  ) THEN
    RAISE EXCEPTION 'reconciliation difference or canonical payload was not derived';
  END IF;

  PERFORM set_config('app.transition_reason', 'إرسال المطابقة للمراجعة.', true);
  UPDATE reconciliation_cases
  SET state = 'PENDING_REVIEW', submitted_by = manager_id, submitted_at = now(), updated_by = manager_id
  WHERE id = reconciliation_id_value;

  PERFORM set_config('app.transition_reason', 'تصنيف فرق مثبت من كشف المصدر.', true);
  UPDATE reconciliation_cases
  SET state = 'REVIEWED', reviewed_by = manager_id, reviewed_at = now(),
      reason_code = 'WRONG_AMOUNT', reason_text = 'مبلغ المصدر يزيد عن رصيد الدفتر بمقدار 50.00 SR.',
      updated_by = manager_id
  WHERE id = reconciliation_id_value;

  UPDATE reconciliation_cases
  SET state = 'PENDING_APPROVAL', updated_by = manager_id
  WHERE id = reconciliation_id_value;

  UPDATE reconciliation_cases
  SET state = 'APPROVED', approved_by = manager_id, approved_at = now(), updated_by = manager_id
  WHERE id = reconciliation_id_value;

  INSERT INTO customer_ledger_entries (
    customer_id, customer_account_id, currency_code, direction, entry_type,
    amount_minor, accounting_date, description, source_type, source_id,
    idempotency_key, posted_at, posted_by, request_id
  ) VALUES (
    customer_id_value, sr_account_id, 'SR', 'DEBIT', 'RECONCILIATION_ADJUSTMENT',
    5000, CURRENT_DATE, 'تسوية فرق مطابقة معتمدة.', 'RECONCILIATION', reconciliation_id_value::text,
    'reconciliation-ledger-001', now(), manager_id, gen_random_uuid()
  ) RETURNING id INTO ledger_entry_id_value;

  INSERT INTO reconciliation_settlements (
    reconciliation_id, ledger_entry_id, direction, amount_minor,
    settled_by, idempotency_key, request_id, reason
  ) VALUES (
    reconciliation_id_value, ledger_entry_id_value, 'DEBIT', 5000,
    manager_id, 'reconciliation-settlement-001', gen_random_uuid(),
    'اعتماد التسوية وربطها بقيد دفتر غير قابل للحذف.'
  ) RETURNING id INTO settlement_id_value;

  PERFORM set_config('app.transition_reason', 'تنفيذ التسوية المعتمدة.', true);
  UPDATE reconciliation_cases
  SET state = 'SETTLED', settled_by = manager_id, settled_at = now(),
      settlement_ledger_entry_id = ledger_entry_id_value, updated_by = manager_id
  WHERE id = reconciliation_id_value;

  IF NOT EXISTS (
    SELECT 1
    FROM reconciliation_cases AS reconciliation
    JOIN reconciliation_settlements AS settlement
      ON settlement.reconciliation_id = reconciliation.id
    JOIN customer_ledger_entries AS entry
      ON entry.id = settlement.ledger_entry_id
    WHERE reconciliation.id = reconciliation_id_value
      AND reconciliation.state = 'SETTLED'
      AND entry.entry_type = 'RECONCILIATION_ADJUSTMENT'
      AND entry.currency_code = 'SR'
      AND entry.direction = 'DEBIT'
      AND entry.amount_minor = 5000
  ) THEN
    RAISE EXCEPTION 'settled reconciliation is not linked to the governed ledger entry';
  END IF;

  BEGIN
    INSERT INTO reconciliation_settlements (
      reconciliation_id, ledger_entry_id, direction, amount_minor,
      settled_by, idempotency_key, request_id, reason
    ) VALUES (
      reconciliation_id_value, ledger_entry_id_value, 'DEBIT', 5000,
      manager_id, 'reconciliation-settlement-duplicate', gen_random_uuid(),
      'محاولة تسوية مكررة يجب رفضها.'
    );
    RAISE EXCEPTION 'expected duplicate settlement to fail';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'expected duplicate settlement to fail' THEN RAISE; END IF;
      IF position('only an approved reconciliation can be settled' IN SQLERRM) = 0 THEN
        RAISE EXCEPTION 'unexpected duplicate settlement error: %', SQLERRM;
      END IF;
  END;

  SELECT COUNT(*) INTO event_count
  FROM reconciliation_settlements
  WHERE reconciliation_id = reconciliation_id_value;
  IF event_count <> 1 THEN
    RAISE EXCEPTION 'duplicate settlement attempt changed settlement count to %', event_count;
  END IF;

  BEGIN
    UPDATE reconciliation_events SET reason = 'تعديل غير مسموح'
    WHERE reconciliation_id = reconciliation_id_value;
    RAISE EXCEPTION 'expected reconciliation event mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected reconciliation event mutation to fail' THEN RAISE; END IF;
  END;

  SELECT COUNT(*) INTO event_count
  FROM reconciliation_events
  WHERE reconciliation_id = reconciliation_id_value;
  IF event_count <> 6 THEN
    RAISE EXCEPTION 'expected six lifecycle events, found %', event_count;
  END IF;

  INSERT INTO reconciliation_cases (
    customer_id, customer_account_id, currency_code,
    source_kind, source_type, source_id, cutoff_date,
    expected_amount_minor, observed_amount_minor,
    created_by, updated_by, idempotency_key
  ) VALUES (
    customer_id_value, sr_account_id, 'SR',
    'IMPORT_TO_LEDGER', 'IMPORT_BATCH', 'RECON-MATCH-001', CURRENT_DATE,
    20000, 20000,
    manager_id, manager_id, 'reconciliation-create-matched-001'
  ) RETURNING id INTO matched_id_value;

  UPDATE reconciliation_cases
  SET state = 'MATCHED', submitted_by = manager_id, submitted_at = now(), updated_by = manager_id
  WHERE id = matched_id_value;

  IF NOT EXISTS (
    SELECT 1 FROM reconciliation_cases WHERE id = matched_id_value AND state = 'MATCHED'
  ) THEN
    RAISE EXCEPTION 'zero difference reconciliation was not marked matched';
  END IF;

  BEGIN
    INSERT INTO reconciliation_cases (
      customer_id, customer_account_id, currency_code,
      source_kind, source_type, source_id, cutoff_date,
      expected_amount_minor, observed_amount_minor,
      created_by, updated_by, idempotency_key
    ) VALUES (
      customer_id_value, rg_account_id, 'SR',
      'LEDGER_TO_STATEMENT', 'ONYX_STATEMENT', 'RECON-CURRENCY-FAIL', CURRENT_DATE,
      100, 200,
      manager_id, manager_id, 'reconciliation-currency-fail'
    );
    RAISE EXCEPTION 'expected currency mismatch to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected currency mismatch to fail' THEN RAISE; END IF;
    IF position('reconciliation currency does not match customer account' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected currency mismatch error: %', SQLERRM;
    END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM permissions AS permission
    JOIN role_permissions AS grant_row ON grant_row.permission_id = permission.id
    WHERE permission.code = 'reconciliations.settle'
      AND grant_row.role_id = branch_manager_role_id
  ) THEN
    RAISE EXCEPTION 'branch manager reconciliation settlement permission is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM permissions AS permission
    JOIN role_permissions AS grant_row ON grant_row.permission_id = permission.id
    WHERE permission.code LIKE 'reconciliations.%'
      AND grant_row.role_id = system_admin_role_id
  ) THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN must not receive reconciliation permissions by default';
  END IF;
END;
$$;

ROLLBACK;
