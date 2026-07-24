BEGIN;

DO $$
DECLARE
  creator_id uuid;
  reviewer_id uuid;
  approver_id uuid;
  customer_id_value uuid;
  account_id_value uuid;
  reconciliation_id_value uuid;
  current_state text;
  current_reviewer uuid;
  current_approver uuid;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'MULTI_USER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('reconciliation.creator.multi@example.test', 'منشئ مطابقة متعدد المستخدمين', 'ACTIVE')
  RETURNING id INTO creator_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('reconciliation.reviewer.multi@example.test', 'مراجع مطابقة مستقل', 'ACTIVE')
  RETURNING id INTO reviewer_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('reconciliation.approver.multi@example.test', 'معتمد مطابقة مستقل', 'ACTIVE')
  RETURNING id INTO approver_id;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('RECON-MULTI-001', 'عميل اختبار الفصل الوظيفي', creator_id, creator_id)
  RETURNING id INTO customer_id_value;

  INSERT INTO customer_accounts (customer_id, currency_code, created_by)
  VALUES (customer_id_value, 'SR', creator_id)
  RETURNING id INTO account_id_value;

  PERFORM set_config('app.request_id', gen_random_uuid()::text, true);
  INSERT INTO reconciliation_cases (
    customer_id, customer_account_id, currency_code,
    source_kind, source_type, source_id, cutoff_date,
    expected_amount_minor, observed_amount_minor,
    created_by, updated_by, idempotency_key
  ) VALUES (
    customer_id_value, account_id_value, 'SR',
    'LEDGER_TO_STATEMENT', 'MULTI_USER_TEST', 'RECON-MULTI-SOURCE-001', CURRENT_DATE,
    100000, 105000,
    creator_id, creator_id, 'reconciliation-multi-create-001'
  ) RETURNING id INTO reconciliation_id_value;

  PERFORM set_config('app.transition_reason', 'إرسال المطابقة إلى مراجع مستقل.', true);
  UPDATE reconciliation_cases
  SET state = 'PENDING_REVIEW', submitted_by = creator_id, submitted_at = now(), updated_by = creator_id
  WHERE id = reconciliation_id_value;

  BEGIN
    UPDATE reconciliation_cases
    SET state = 'REVIEWED', reviewed_by = creator_id, reviewed_at = now(),
        reason_code = 'WRONG_AMOUNT', reason_text = 'محاولة مراجعة ذاتية يجب رفضها.',
        updated_by = creator_id
    WHERE id = reconciliation_id_value;
    RAISE EXCEPTION 'expected creator self-review to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected creator self-review to fail' THEN RAISE; END IF;
    IF position('review requires an independent reviewer outside single-manager mode' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected creator self-review error: %', SQLERRM;
    END IF;
  END;

  SELECT state, reviewed_by
  INTO current_state, current_reviewer
  FROM reconciliation_cases
  WHERE id = reconciliation_id_value;
  IF current_state <> 'PENDING_REVIEW' OR current_reviewer IS NOT NULL THEN
    RAISE EXCEPTION 'failed self-review changed reconciliation state or reviewer';
  END IF;

  PERFORM set_config('app.transition_reason', 'مراجعة مستقلة مثبتة.', true);
  UPDATE reconciliation_cases
  SET state = 'REVIEWED', reviewed_by = reviewer_id, reviewed_at = now(),
      reason_code = 'WRONG_AMOUNT', reason_text = 'المراجع المستقل أثبت فرق المبلغ.',
      updated_by = reviewer_id
  WHERE id = reconciliation_id_value;

  UPDATE reconciliation_cases
  SET state = 'PENDING_APPROVAL', updated_by = reviewer_id
  WHERE id = reconciliation_id_value;

  BEGIN
    UPDATE reconciliation_cases
    SET state = 'APPROVED', approved_by = creator_id, approved_at = now(), updated_by = creator_id
    WHERE id = reconciliation_id_value;
    RAISE EXCEPTION 'expected creator approval to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected creator approval to fail' THEN RAISE; END IF;
    IF position('approval requires an independent approver outside single-manager mode' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected creator approval error: %', SQLERRM;
    END IF;
  END;

  BEGIN
    UPDATE reconciliation_cases
    SET state = 'APPROVED', approved_by = reviewer_id, approved_at = now(), updated_by = reviewer_id
    WHERE id = reconciliation_id_value;
    RAISE EXCEPTION 'expected reviewer approval to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected reviewer approval to fail' THEN RAISE; END IF;
    IF position('approval requires an independent approver outside single-manager mode' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected reviewer approval error: %', SQLERRM;
    END IF;
  END;

  SELECT state, approved_by
  INTO current_state, current_approver
  FROM reconciliation_cases
  WHERE id = reconciliation_id_value;
  IF current_state <> 'PENDING_APPROVAL' OR current_approver IS NOT NULL THEN
    RAISE EXCEPTION 'failed approval attempt changed reconciliation state or approver';
  END IF;

  PERFORM set_config('app.transition_reason', 'اعتماد مستقل مثبت.', true);
  UPDATE reconciliation_cases
  SET state = 'APPROVED', approved_by = approver_id, approved_at = now(), updated_by = approver_id
  WHERE id = reconciliation_id_value;

  SELECT state, reviewed_by, approved_by
  INTO current_state, current_reviewer, current_approver
  FROM reconciliation_cases
  WHERE id = reconciliation_id_value;
  IF current_state <> 'APPROVED'
    OR current_reviewer <> reviewer_id
    OR current_approver <> approver_id
    OR creator_id = current_reviewer
    OR creator_id = current_approver
    OR current_reviewer = current_approver THEN
    RAISE EXCEPTION 'independent creator, reviewer, and approver separation was not preserved';
  END IF;
END;
$$;

ROLLBACK;
