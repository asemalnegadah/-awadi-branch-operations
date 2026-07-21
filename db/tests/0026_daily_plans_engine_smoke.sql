BEGIN;

DO $$
DECLARE
  manager_id uuid;
  sales_user_id uuid;
  branch_manager_role_id uuid;
  sales_rep_role_id uuid;
  system_admin_role_id uuid;
  representative_id_value uuid;
  area_id_value uuid;
  route_id_value uuid;
  customer_one_id uuid;
  customer_two_id uuid;
  account_sr_id uuid;
  account_rg_id uuid;
  promise_id_value uuid;
  plan_id_value uuid;
  second_plan_id uuid;
  selected_candidate_id uuid;
  excluded_candidate_id uuid;
  item_id_value uuid;
  event_id_value uuid;
  permission_count integer;
  system_admin_grant_count integer;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('daily.plan.manager@example.test', 'مدير اختبار الخطط اليومية', 'ACTIVE')
  RETURNING id INTO manager_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('daily.plan.rep@example.test', 'مندوب اختبار الخطط اليومية', 'ACTIVE')
  RETURNING id INTO sales_user_id;

  SELECT id INTO branch_manager_role_id FROM roles WHERE code = 'BRANCH_MANAGER';
  SELECT id INTO sales_rep_role_id FROM roles WHERE code = 'SALES_REP';
  SELECT id INTO system_admin_role_id FROM roles WHERE code = 'SYSTEM_ADMIN';

  IF branch_manager_role_id IS NULL OR sales_rep_role_id IS NULL OR system_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'required roles are missing';
  END IF;

  INSERT INTO user_roles (user_id, role_id, granted_by)
  VALUES
    (manager_id, branch_manager_role_id, manager_id),
    (sales_user_id, sales_rep_role_id, manager_id);

  INSERT INTO sales_representatives (
    employee_code,
    full_name_ar,
    user_id,
    representative_type,
    status,
    created_by,
    updated_by
  ) VALUES (
    'PLAN-REP-001',
    'مندوب اختبار الخطط',
    sales_user_id,
    'RETAIL',
    'ACTIVE',
    manager_id,
    manager_id
  ) RETURNING id INTO representative_id_value;

  INSERT INTO areas (code, name_ar)
  VALUES ('PLAN-AREA-001', 'منطقة اختبار الخطط')
  RETURNING id INTO area_id_value;

  INSERT INTO routes (
    code,
    name_ar,
    area_id,
    estimated_travel_minutes,
    default_visit_minutes,
    created_by,
    updated_by
  ) VALUES (
    'PLAN-ROUTE-001',
    'مسار اختبار الخطط',
    area_id_value,
    20,
    35,
    manager_id,
    manager_id
  ) RETURNING id INTO route_id_value;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('PLAN-CUST-001', 'عميل مختار للخطة', manager_id, manager_id)
  RETURNING id INTO customer_one_id;

  INSERT INTO customers (customer_number, trade_name_ar, lifecycle_status, created_by, updated_by)
  VALUES ('PLAN-CUST-002', 'عميل مستبعد من الخطة', 'PERMANENTLY_CLOSED', manager_id, manager_id)
  RETURNING id INTO customer_two_id;

  INSERT INTO customer_accounts (customer_id, currency_code, credit_limit_minor, created_by)
  VALUES (customer_one_id, 'SR', 100000, manager_id)
  RETURNING id INTO account_sr_id;

  INSERT INTO customer_accounts (customer_id, currency_code, credit_limit_minor, created_by)
  VALUES (customer_one_id, 'RG', 50000, manager_id)
  RETURNING id INTO account_rg_id;

  INSERT INTO customer_rep_assignments (
    customer_id,
    representative_id,
    reason,
    approved_by,
    created_by
  ) VALUES
    (customer_one_id, representative_id_value, 'تكليف أساسي للاختبار', manager_id, manager_id),
    (customer_two_id, representative_id_value, 'تكليف عميل مغلق للاختبار', manager_id, manager_id);

  INSERT INTO customer_route_assignments (
    customer_id,
    route_id,
    reason,
    approved_by,
    created_by
  ) VALUES
    (customer_one_id, route_id_value, 'مسار أساسي للاختبار', manager_id, manager_id),
    (customer_two_id, route_id_value, 'مسار العميل المغلق', manager_id, manager_id);

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
    customer_one_id,
    account_sr_id,
    representative_id_value,
    'SR',
    25000,
    (now() AT TIME ZONE 'Asia/Aden')::date - 5,
    (now() AT TIME ZONE 'Asia/Aden')::date,
    'وعد مستحق ضمن خطة الاختبار.',
    manager_id,
    manager_id,
    'daily-plan-smoke-promise-001'
  ) RETURNING id INTO promise_id_value;

  INSERT INTO daily_plans (
    representative_id,
    plan_date,
    cutoff_at,
    ruleset_version,
    source_snapshot,
    input_fingerprint,
    created_by,
    idempotency_key
  ) VALUES (
    representative_id_value,
    (now() AT TIME ZONE 'Asia/Aden')::date,
    now(),
    'daily-plan-v1',
    jsonb_build_object('representativeId', representative_id_value, 'candidateCount', 2),
    repeat('a', 64),
    manager_id,
    'daily-plan-smoke-plan-001'
  ) RETURNING id INTO plan_id_value;

  BEGIN
    UPDATE daily_plans
    SET state = 'PENDING_APPROVAL',
        submitted_by = manager_id,
        submitted_at = now()
    WHERE id = plan_id_value;
    RAISE EXCEPTION 'expected empty plan submission to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected empty plan submission to fail' THEN RAISE; END IF;
    IF position('daily plan cannot be submitted without items' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected empty plan submission error: %', SQLERRM;
    END IF;
  END;

  INSERT INTO daily_plan_candidates (
    plan_id,
    customer_id,
    route_id,
    area_id,
    computed_score,
    selected,
    selection_rank,
    decision_reason,
    factors,
    source_snapshot,
    linked_promise_id
  ) VALUES (
    plan_id_value,
    customer_one_id,
    route_id_value,
    area_id_value,
    910,
    true,
    1,
    'وعد مستحق ورصيد يحتاج تحصيلًا.',
    '[{"code":"DUE_PROMISE","points":40},{"code":"OLD_DEBT","points":30}]'::jsonb,
    jsonb_build_object('targetCollectionSrMinor', 25000, 'targetCollectionRgMinor', 5000),
    promise_id_value
  ) RETURNING id INTO selected_candidate_id;

  INSERT INTO daily_plan_candidates (
    plan_id,
    customer_id,
    route_id,
    area_id,
    computed_score,
    selected,
    decision_reason,
    exclusion_reason,
    factors,
    source_snapshot
  ) VALUES (
    plan_id_value,
    customer_two_id,
    route_id_value,
    area_id_value,
    100,
    false,
    'تم تقييم العميل ضمن المرشحين.',
    'المنشأة مغلقة نهائيًا ولا توجد مهمة تحصيل موثقة.',
    '[{"code":"CLOSED_CUSTOMER","points":0}]'::jsonb,
    '{"lifecycleStatus":"PERMANENTLY_CLOSED"}'::jsonb
  ) RETURNING id INTO excluded_candidate_id;

  BEGIN
    UPDATE daily_plan_candidates
    SET computed_score = 999
    WHERE id = selected_candidate_id;
    RAISE EXCEPTION 'expected candidate update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected candidate update to fail' THEN RAISE; END IF;
  END;

  INSERT INTO daily_plan_items (
    plan_id,
    sequence_number,
    customer_id,
    linked_promise_id,
    task_type,
    priority_level,
    priority_score,
    selection_reason,
    objective,
    expected_result,
    target_collection_sr_minor,
    target_collection_rg_minor,
    target_sales_sr_minor,
    target_sales_rg_minor,
    route_id,
    estimated_visit_minutes,
    estimated_travel_minutes,
    created_by,
    updated_by
  ) VALUES (
    plan_id_value,
    1,
    customer_one_id,
    promise_id_value,
    'MIXED',
    'CRITICAL',
    910,
    'وعد مستحق مع أولوية مدير.',
    'تحصيل الوعد ومراجعة فرصة البيع.',
    'تحصيل موثق أو وعد جديد بتاريخ واضح.',
    25000,
    5000,
    10000,
    2000,
    route_id_value,
    35,
    20,
    manager_id,
    manager_id
  ) RETURNING id INTO item_id_value;

  IF NOT EXISTS (
    SELECT 1
    FROM daily_plan_items
    WHERE id = item_id_value
      AND area_id = area_id_value
      AND target_collection_sr_minor = 25000
      AND target_collection_rg_minor = 5000
  ) THEN
    RAISE EXCEPTION 'plan item route area or separated targets were not stored correctly';
  END IF;

  INSERT INTO daily_plan_adjustments (
    plan_id,
    plan_item_id,
    adjustment_type,
    actor_user_id,
    reason,
    new_values,
    request_id,
    idempotency_key
  ) VALUES (
    plan_id_value,
    item_id_value,
    'CHANGE_TARGET',
    manager_id,
    'توثيق أهداف SR وRG بشكل مستقل.',
    '{"targetCollectionSrMinor":25000,"targetCollectionRgMinor":5000}'::jsonb,
    gen_random_uuid(),
    'daily-plan-smoke-adjustment-001'
  );

  INSERT INTO daily_plan_events (
    plan_id,
    event_type,
    actor_user_id,
    request_id,
    new_values,
    operation_payload,
    reason,
    idempotency_key
  ) VALUES (
    plan_id_value,
    'GENERATED',
    manager_id,
    gen_random_uuid(),
    jsonb_build_object('state', 'DRAFT', 'itemCount', 1),
    jsonb_build_object('rulesetVersion', 'daily-plan-v1'),
    'توليد خطة الاختبار.',
    'daily-plan-smoke-event-001'
  ) RETURNING id INTO event_id_value;

  UPDATE daily_plans
  SET state = 'PENDING_APPROVAL',
      submitted_by = manager_id,
      submitted_at = now(),
      target_collection_sr_minor = 25000,
      target_collection_rg_minor = 5000,
      target_sales_sr_minor = 10000,
      target_sales_rg_minor = 2000,
      estimated_work_minutes = 55
  WHERE id = plan_id_value;

  BEGIN
    UPDATE daily_plan_items
    SET objective = 'تعديل غير مسموح بعد الإرسال',
        updated_by = manager_id
    WHERE id = item_id_value;
    RAISE EXCEPTION 'expected submitted plan item update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected submitted plan item update to fail' THEN RAISE; END IF;
    IF position('daily plan items may change only while the plan is DRAFT' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected submitted plan item error: %', SQLERRM;
    END IF;
  END;

  UPDATE daily_plans
  SET state = 'APPROVED',
      approved_by = manager_id,
      approved_at = now()
  WHERE id = plan_id_value;

  BEGIN
    UPDATE daily_plans
    SET submitted_by = sales_user_id,
        submitted_at = now(),
        state = 'IN_PROGRESS',
        started_by = sales_user_id,
        started_at = now()
    WHERE id = plan_id_value;
    RAISE EXCEPTION 'expected plan submitter mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected plan submitter mutation to fail' THEN RAISE; END IF;
    IF position('daily plan submission actor is immutable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected plan actor immutability error: %', SQLERRM;
    END IF;
  END;

  UPDATE daily_plans
  SET state = 'IN_PROGRESS',
      started_by = sales_user_id,
      started_at = now()
  WHERE id = plan_id_value;

  INSERT INTO daily_plan_item_results (
    plan_item_id,
    result_type,
    reason,
    recorded_by,
    request_id,
    idempotency_key
  ) VALUES (
    item_id_value,
    'SKIPPED',
    'نتيجة تنفيذ موثقة لاختبار دورة الخطة.',
    sales_user_id,
    gen_random_uuid(),
    'daily-plan-smoke-item-result-001'
  );

  UPDATE daily_plans
  SET state = 'COMPLETED',
      completed_by = sales_user_id,
      completed_at = now()
  WHERE id = plan_id_value;

  BEGIN
    DELETE FROM daily_plan_events WHERE id = event_id_value;
    RAISE EXCEPTION 'expected daily plan event delete to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected daily plan event delete to fail' THEN RAISE; END IF;
  END;

  INSERT INTO daily_plans (
    representative_id,
    plan_date,
    cutoff_at,
    ruleset_version,
    source_snapshot,
    input_fingerprint,
    created_by,
    idempotency_key
  ) VALUES (
    representative_id_value,
    (now() AT TIME ZONE 'Asia/Aden')::date + 1,
    now(),
    'daily-plan-v1',
    '{}'::jsonb,
    repeat('b', 64),
    manager_id,
    'daily-plan-smoke-plan-002'
  ) RETURNING id INTO second_plan_id;

  BEGIN
    INSERT INTO daily_plan_candidates (
      plan_id,
      customer_id,
      computed_score,
      selected,
      selection_rank,
      decision_reason,
      factors,
      source_snapshot,
      linked_promise_id
    ) VALUES (
      second_plan_id,
      customer_two_id,
      500,
      true,
      1,
      'اختبار وعد تابع لعميل آخر.',
      '[]'::jsonb,
      '{}'::jsonb,
      promise_id_value
    );
    RAISE EXCEPTION 'expected candidate promise customer mismatch to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected candidate promise customer mismatch to fail' THEN RAISE; END IF;
    IF position('daily plan candidate promise belongs to another customer' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected candidate promise mismatch error: %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO permission_count
  FROM permissions
  WHERE code IN (
    'plans.read_own',
    'plans.read_all',
    'plans.generate',
    'plans.manage',
    'plans.approve',
    'plans.view_history'
  );

  IF permission_count <> 6 THEN
    RAISE EXCEPTION 'expected 6 daily plan permissions, got %', permission_count;
  END IF;

  SELECT COUNT(*) INTO system_admin_grant_count
  FROM role_permissions AS grant_row
  JOIN permissions AS permission ON permission.id = grant_row.permission_id
  WHERE grant_row.role_id = system_admin_role_id
    AND permission.code LIKE 'plans.%';

  IF system_admin_grant_count <> 0 THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN must not receive daily plan business permissions by default';
  END IF;

  IF excluded_candidate_id IS NULL OR account_rg_id IS NULL THEN
    RAISE EXCEPTION 'daily plan smoke fixtures were not created';
  END IF;
END;
$$;

ROLLBACK;
