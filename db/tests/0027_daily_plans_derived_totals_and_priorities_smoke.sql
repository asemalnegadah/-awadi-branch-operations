BEGIN;

DO $$
DECLARE
  manager_id uuid;
  representative_id_value uuid;
  other_representative_id uuid;
  area_id_value uuid;
  route_id_value uuid;
  customer_one_id uuid;
  customer_two_id uuid;
  plan_id_value uuid;
  priority_id_value uuid;
  item_one_id uuid;
  item_two_id uuid;
  totals_record record;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('daily.plan.derived.manager@example.test', 'مدير اختبار إجماليات الخطط', 'ACTIVE')
  RETURNING id INTO manager_id;

  INSERT INTO user_roles (user_id, role_id, granted_by)
  SELECT manager_id, id, manager_id FROM roles WHERE code = 'BRANCH_MANAGER';

  INSERT INTO sales_representatives (
    employee_code, full_name_ar, representative_type, status, created_by, updated_by
  ) VALUES (
    'PLAN-DERIVED-REP-001', 'مندوب إجماليات الخطة', 'RETAIL', 'ACTIVE', manager_id, manager_id
  ) RETURNING id INTO representative_id_value;

  INSERT INTO sales_representatives (
    employee_code, full_name_ar, representative_type, status, created_by, updated_by
  ) VALUES (
    'PLAN-DERIVED-REP-002', 'مندوب آخر لاختبار النطاق', 'RETAIL', 'ACTIVE', manager_id, manager_id
  ) RETURNING id INTO other_representative_id;

  INSERT INTO areas (code, name_ar)
  VALUES ('PLAN-DERIVED-AREA', 'منطقة إجماليات الخطط')
  RETURNING id INTO area_id_value;

  INSERT INTO routes (
    code, name_ar, area_id, estimated_travel_minutes, default_visit_minutes,
    created_by, updated_by
  ) VALUES (
    'PLAN-DERIVED-ROUTE', 'مسار إجماليات الخطط', area_id_value, 15, 30,
    manager_id, manager_id
  ) RETURNING id INTO route_id_value;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('PLAN-DERIVED-C1', 'عميل إجماليات أول', manager_id, manager_id)
  RETURNING id INTO customer_one_id;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('PLAN-DERIVED-C2', 'عميل إجماليات ثان', manager_id, manager_id)
  RETURNING id INTO customer_two_id;

  INSERT INTO customer_rep_assignments (
    customer_id, representative_id, reason, approved_by, created_by
  ) VALUES
    (customer_one_id, representative_id_value, 'تكليف أول', manager_id, manager_id),
    (customer_two_id, representative_id_value, 'تكليف ثان', manager_id, manager_id);

  INSERT INTO customer_route_assignments (
    customer_id, route_id, reason, approved_by, created_by
  ) VALUES
    (customer_one_id, route_id_value, 'مسار أول', manager_id, manager_id),
    (customer_two_id, route_id_value, 'مسار ثان', manager_id, manager_id);

  INSERT INTO planning_priority_overrides (
    customer_id,
    representative_id,
    valid_from,
    valid_until,
    priority,
    reason,
    created_by,
    request_id,
    idempotency_key
  ) VALUES (
    customer_one_id,
    representative_id_value,
    (now() AT TIME ZONE 'Asia/Aden')::date,
    (now() AT TIME ZONE 'Asia/Aden')::date + 5,
    90,
    'أولوية مدير موثقة للاختبار.',
    manager_id,
    gen_random_uuid(),
    'daily-plan-derived-priority-001'
  ) RETURNING id INTO priority_id_value;

  BEGIN
    UPDATE planning_priority_overrides
    SET priority = 10,
        state = 'REVOKED',
        revoked_by = manager_id,
        revoked_at = now(),
        revocation_reason = 'محاولة إعادة كتابة الأصل.'
    WHERE id = priority_id_value;
    RAISE EXCEPTION 'expected planning priority core mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected planning priority core mutation to fail' THEN RAISE; END IF;
    IF position('planning priority core fields are immutable' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected planning priority immutability error: %', SQLERRM;
    END IF;
  END;

  UPDATE planning_priority_overrides
  SET state = 'REVOKED',
      revoked_by = manager_id,
      revoked_at = now(),
      revocation_reason = 'انتهاء أولوية الاختبار.'
  WHERE id = priority_id_value;

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
    repeat('c', 64),
    manager_id,
    'daily-plan-derived-plan-001'
  ) RETURNING id INTO plan_id_value;

  INSERT INTO daily_plan_candidates (
    plan_id, customer_id, route_id, area_id, computed_score,
    selected, selection_rank, decision_reason, factors, source_snapshot
  ) VALUES (
    plan_id_value, customer_one_id, route_id_value, area_id_value, 800,
    true, 1, 'مرشح أول.', '[]'::jsonb, '{}'::jsonb
  );

  INSERT INTO daily_plan_candidates (
    plan_id, customer_id, route_id, area_id, computed_score,
    selected, selection_rank, decision_reason, factors, source_snapshot
  ) VALUES (
    plan_id_value, customer_two_id, route_id_value, area_id_value, 700,
    true, 2, 'مرشح ثان.', '[]'::jsonb, '{}'::jsonb
  );

  BEGIN
    INSERT INTO daily_plan_candidates (
      plan_id, customer_id, computed_score, selected, selection_rank,
      decision_reason, factors, source_snapshot
    ) VALUES (
      plan_id_value,
      customer_one_id,
      600,
      true,
      2,
      'ترتيب مكرر.',
      '[]'::jsonb,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'expected duplicate candidate rank or customer to fail';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO daily_plan_items (
    plan_id, sequence_number, customer_id, task_type, priority_level,
    priority_score, selection_reason, objective, expected_result,
    target_collection_sr_minor, target_collection_rg_minor,
    target_sales_sr_minor, target_sales_rg_minor,
    route_id, estimated_visit_minutes, estimated_travel_minutes,
    created_by, updated_by
  ) VALUES (
    plan_id_value, 1, customer_one_id, 'MIXED', 'CRITICAL',
    800, 'أولوية أولى.', 'تحصيل وبيع.', 'نتيجة موثقة.',
    10000, 2000, 5000, 1000,
    route_id_value, 30, 15, manager_id, manager_id
  ) RETURNING id INTO item_one_id;

  INSERT INTO daily_plan_items (
    plan_id, sequence_number, customer_id, task_type, priority_level,
    priority_score, selection_reason, objective, expected_result,
    target_collection_sr_minor, target_collection_rg_minor,
    target_sales_sr_minor, target_sales_rg_minor,
    route_id, estimated_visit_minutes, estimated_travel_minutes,
    created_by, updated_by
  ) VALUES (
    plan_id_value, 2, customer_two_id, 'COLLECTION', 'HIGH',
    700, 'أولوية ثانية.', 'تحصيل.', 'نتيجة موثقة.',
    3000, 4000, 0, 0,
    route_id_value, 25, 10, manager_id, manager_id
  ) RETURNING id INTO item_two_id;

  SELECT
    target_collection_sr_minor,
    target_collection_rg_minor,
    target_sales_sr_minor,
    target_sales_rg_minor,
    estimated_work_minutes
  INTO totals_record
  FROM daily_plans
  WHERE id = plan_id_value;

  IF totals_record.target_collection_sr_minor <> 13000
    OR totals_record.target_collection_rg_minor <> 6000
    OR totals_record.target_sales_sr_minor <> 5000
    OR totals_record.target_sales_rg_minor <> 1000
    OR totals_record.estimated_work_minutes <> 80 THEN
    RAISE EXCEPTION 'derived plan totals are incorrect: %', row_to_json(totals_record);
  END IF;

  UPDATE daily_plans
  SET target_collection_sr_minor = 999999,
      target_collection_rg_minor = 999999,
      target_sales_sr_minor = 999999,
      target_sales_rg_minor = 999999,
      estimated_work_minutes = 999999
  WHERE id = plan_id_value;

  SELECT
    target_collection_sr_minor,
    target_collection_rg_minor,
    target_sales_sr_minor,
    target_sales_rg_minor,
    estimated_work_minutes
  INTO totals_record
  FROM daily_plans
  WHERE id = plan_id_value;

  IF totals_record.target_collection_sr_minor <> 13000
    OR totals_record.target_collection_rg_minor <> 6000
    OR totals_record.target_sales_sr_minor <> 5000
    OR totals_record.target_sales_rg_minor <> 1000
    OR totals_record.estimated_work_minutes <> 80 THEN
    RAISE EXCEPTION 'direct plan total override was not replaced by derived totals';
  END IF;

  UPDATE daily_plan_items
  SET target_collection_sr_minor = 7000,
      target_collection_rg_minor = 1000,
      estimated_visit_minutes = 20,
      updated_by = manager_id
  WHERE id = item_two_id;

  SELECT
    target_collection_sr_minor,
    target_collection_rg_minor,
    estimated_work_minutes
  INTO totals_record
  FROM daily_plans
  WHERE id = plan_id_value;

  IF totals_record.target_collection_sr_minor <> 17000
    OR totals_record.target_collection_rg_minor <> 3000
    OR totals_record.estimated_work_minutes <> 75 THEN
    RAISE EXCEPTION 'plan totals did not refresh after item update';
  END IF;

  DELETE FROM daily_plan_items WHERE id = item_one_id;

  SELECT
    target_collection_sr_minor,
    target_collection_rg_minor,
    target_sales_sr_minor,
    target_sales_rg_minor,
    estimated_work_minutes
  INTO totals_record
  FROM daily_plans
  WHERE id = plan_id_value;

  IF totals_record.target_collection_sr_minor <> 7000
    OR totals_record.target_collection_rg_minor <> 1000
    OR totals_record.target_sales_sr_minor <> 0
    OR totals_record.target_sales_rg_minor <> 0
    OR totals_record.estimated_work_minutes <> 30 THEN
    RAISE EXCEPTION 'plan totals did not refresh after item deletion';
  END IF;

  BEGIN
    INSERT INTO daily_plan_items (
      plan_id, sequence_number, customer_id, task_type, priority_level,
      priority_score, selection_reason, objective, expected_result,
      created_by, updated_by
    ) VALUES (
      plan_id_value, 3, customer_one_id, 'DATA_UPDATE', 'LOW',
      100, 'اختبار نطاق.', 'تحديث.', 'توثيق.', manager_id, manager_id
    );
    -- This succeeds because customer_one is assigned to the plan representative.
  END;

  BEGIN
    UPDATE customer_rep_assignments
    SET valid_until = now() - interval '1 minute'
    WHERE customer_id = customer_one_id
      AND representative_id = representative_id_value;

    INSERT INTO daily_plan_items (
      plan_id, sequence_number, customer_id, task_type, priority_level,
      priority_score, selection_reason, objective, expected_result,
      created_by, updated_by
    ) VALUES (
      plan_id_value, 4, customer_one_id, 'DATA_UPDATE', 'LOW',
      100, 'اختبار عميل خارج النطاق.', 'تحديث.', 'توثيق.', manager_id, manager_id
    );
    RAISE EXCEPTION 'expected out-of-scope plan item to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected out-of-scope plan item to fail' THEN RAISE; END IF;
    IF position('daily plan item customer is not assigned to the representative at cutoff' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected plan item scope error: %', SQLERRM;
    END IF;
  END;

  IF other_representative_id IS NULL THEN
    RAISE EXCEPTION 'other representative fixture missing';
  END IF;
END;
$$;

ROLLBACK;
