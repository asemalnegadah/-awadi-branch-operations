BEGIN;

DO $$
DECLARE
  manager_id uuid;
  representative_user_id uuid;
  outsider_user_id uuid;
  representative_id_value uuid;
  area_id_value uuid;
  route_id_value uuid;
  customer_id_value uuid;
  other_customer_id uuid;
  plan_id_value uuid;
  plan_item_id_value uuid;
  second_plan_id uuid;
  second_item_id uuid;
  visit_id_value uuid;
  out_of_plan_visit_id uuid;
  uploaded_file_one_id uuid;
  uploaded_file_two_id uuid;
  outcome_one_id uuid;
  result_id_value uuid;
  summary_record record;
BEGIN
  UPDATE organization_settings
  SET operating_mode = 'SINGLE_MANAGER'
  WHERE singleton_id = 1;

  INSERT INTO users (email, full_name, status)
  VALUES ('field.visit.manager@example.test', 'مدير اختبار الزيارات', 'ACTIVE')
  RETURNING id INTO manager_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('field.visit.rep@example.test', 'مندوب اختبار الزيارات', 'ACTIVE')
  RETURNING id INTO representative_user_id;

  INSERT INTO users (email, full_name, status)
  VALUES ('field.visit.outsider@example.test', 'مستخدم غير مدير', 'ACTIVE')
  RETURNING id INTO outsider_user_id;

  INSERT INTO user_roles (user_id, role_id, granted_by)
  SELECT manager_id, id, manager_id FROM roles WHERE code = 'BRANCH_MANAGER';

  INSERT INTO user_roles (user_id, role_id, granted_by)
  SELECT representative_user_id, id, manager_id FROM roles WHERE code = 'SALES_REP';

  INSERT INTO user_roles (user_id, role_id, granted_by)
  SELECT outsider_user_id, id, manager_id FROM roles WHERE code = 'SALES_REP';

  INSERT INTO sales_representatives (
    employee_code, full_name_ar, user_id, representative_type, status, created_by, updated_by
  ) VALUES (
    'VISIT-REP-001', 'مندوب اختبار الزيارات', representative_user_id,
    'RETAIL', 'ACTIVE', manager_id, manager_id
  ) RETURNING id INTO representative_id_value;

  INSERT INTO areas (code, name_ar)
  VALUES ('VISIT-AREA-001', 'منطقة اختبار الزيارات')
  RETURNING id INTO area_id_value;

  INSERT INTO routes (
    code, name_ar, area_id, estimated_travel_minutes, default_visit_minutes,
    created_by, updated_by
  ) VALUES (
    'VISIT-ROUTE-001', 'مسار اختبار الزيارات', area_id_value, 10, 25,
    manager_id, manager_id
  ) RETURNING id INTO route_id_value;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('VISIT-CUSTOMER-001', 'عميل اختبار الزيارة', manager_id, manager_id)
  RETURNING id INTO customer_id_value;

  INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
  VALUES ('VISIT-CUSTOMER-002', 'عميل آخر غير مطابق', manager_id, manager_id)
  RETURNING id INTO other_customer_id;

  INSERT INTO customer_rep_assignments (
    customer_id, representative_id, reason, approved_by, created_by
  ) VALUES (
    customer_id_value, representative_id_value, 'تكليف اختبار الزيارات', manager_id, manager_id
  );

  INSERT INTO customer_route_assignments (
    customer_id, route_id, reason, approved_by, created_by
  ) VALUES (
    customer_id_value, route_id_value, 'مسار اختبار الزيارات', manager_id, manager_id
  );

  INSERT INTO daily_plans (
    representative_id, plan_date, cutoff_at, ruleset_version,
    source_snapshot, input_fingerprint, created_by, idempotency_key
  ) VALUES (
    representative_id_value,
    (now() AT TIME ZONE 'Asia/Aden')::date,
    now(),
    'daily-plan-v1',
    '{}'::jsonb,
    repeat('a', 64),
    manager_id,
    'field-visit-plan-001'
  ) RETURNING id INTO plan_id_value;

  INSERT INTO daily_plan_items (
    plan_id, sequence_number, customer_id, task_type, priority_level,
    priority_score, selection_reason, objective, expected_result,
    area_id, route_id, estimated_visit_minutes, estimated_travel_minutes,
    created_by, updated_by
  ) VALUES (
    plan_id_value, 1, customer_id_value, 'DATA_UPDATE', 'HIGH',
    500, 'اختبار تنفيذ الزيارة.', 'تحديث بيانات العميل.', 'بيانات موثقة.',
    area_id_value, route_id_value, 25, 10, manager_id, manager_id
  ) RETURNING id INTO plan_item_id_value;

  UPDATE daily_plans
  SET state = 'PENDING_APPROVAL', submitted_by = manager_id, submitted_at = now()
  WHERE id = plan_id_value;

  UPDATE daily_plans
  SET state = 'APPROVED', approved_by = manager_id, approved_at = now()
  WHERE id = plan_id_value;

  UPDATE daily_plans
  SET state = 'IN_PROGRESS', started_by = representative_user_id, started_at = now()
  WHERE id = plan_id_value;

  INSERT INTO uploaded_files (
    original_name, media_type, size_bytes, sha256, storage_provider, storage_key,
    uploaded_by, updated_by, idempotency_key
  ) VALUES (
    'visit-evidence-1.jpg', 'image/jpeg', 1024, repeat('1', 64), 'R2',
    'tests/visit-evidence-1.jpg', representative_user_id, representative_user_id,
    'field-visit-file-001'
  ) RETURNING id INTO uploaded_file_one_id;

  UPDATE uploaded_files
  SET status = 'UPLOADED', uploaded_at = now(), updated_by = representative_user_id
  WHERE id = uploaded_file_one_id;

  INSERT INTO uploaded_files (
    original_name, media_type, size_bytes, sha256, storage_provider, storage_key,
    uploaded_by, updated_by, idempotency_key
  ) VALUES (
    'visit-evidence-2.png', 'image/png', 2048, repeat('2', 64), 'R2',
    'tests/visit-evidence-2.png', representative_user_id, representative_user_id,
    'field-visit-file-002'
  ) RETURNING id INTO uploaded_file_two_id;

  UPDATE uploaded_files
  SET status = 'UPLOADED', uploaded_at = now(), updated_by = representative_user_id
  WHERE id = uploaded_file_two_id;

  INSERT INTO field_visits (
    representative_id, customer_id, plan_id, plan_item_id, visit_source,
    visit_type, objective, created_by, idempotency_key
  ) VALUES (
    representative_id_value, customer_id_value, plan_id_value, plan_item_id_value,
    'PLAN', 'DATA_UPDATE', 'توثيق بيانات العميل وموقعه.',
    representative_user_id, 'field-visit-create-001'
  ) RETURNING id INTO visit_id_value;

  BEGIN
    INSERT INTO field_visits (
      representative_id, customer_id, plan_id, plan_item_id, visit_source,
      visit_type, objective, created_by, idempotency_key
    ) VALUES (
      representative_id_value, other_customer_id, plan_id_value, plan_item_id_value,
      'PLAN', 'DATA_UPDATE', 'محاولة عميل غير مطابق.',
      representative_user_id, 'field-visit-create-invalid-customer'
    );
    RAISE EXCEPTION 'expected mismatched plan customer to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected mismatched plan customer to fail' THEN RAISE; END IF;
    IF position('field visit representative or customer does not match the plan item' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected mismatched plan customer error: %', SQLERRM;
    END IF;
  END;

  UPDATE field_visits
  SET state = 'CHECKED_IN',
      arrived_at = now(),
      device_arrived_at = now() - interval '30 seconds',
      checkin_latitude = 12.785500,
      checkin_longitude = 45.018200,
      checkin_accuracy_meters = 8.5,
      sync_status = 'SYNCED',
      sync_received_at = now()
  WHERE id = visit_id_value;

  INSERT INTO field_visit_outcomes (
    visit_id, outcome_type, summary, details, recorded_by, request_id, idempotency_key
  ) VALUES (
    visit_id_value, 'CUSTOMER_DATA_UPDATE', 'تم التحقق من رقم الهاتف والموقع.',
    '{"fields":["phone","location"]}'::jsonb,
    representative_user_id, gen_random_uuid(), 'field-visit-outcome-001'
  ) RETURNING id INTO outcome_one_id;

  INSERT INTO field_visit_outcomes (
    visit_id, outcome_type, summary, details, recorded_by, request_id, idempotency_key
  ) VALUES (
    visit_id_value, 'PROBLEM_RESOLUTION', 'تم توثيق مشكلة الوصول وإغلاقها.',
    '{"problem":"access","resolved":true}'::jsonb,
    representative_user_id, gen_random_uuid(), 'field-visit-outcome-002'
  );

  INSERT INTO field_visit_evidence (
    visit_id, uploaded_file_id, evidence_type, caption,
    recorded_by, request_id, idempotency_key
  ) VALUES (
    visit_id_value, uploaded_file_one_id, 'CUSTOMER_LOCATION', 'واجهة الموقع.',
    representative_user_id, gen_random_uuid(), 'field-visit-evidence-001'
  );

  INSERT INTO field_visit_evidence (
    visit_id, uploaded_file_id, evidence_type, caption,
    recorded_by, request_id, idempotency_key
  ) VALUES (
    visit_id_value, uploaded_file_two_id, 'DOCUMENT', 'توثيق التحديث.',
    representative_user_id, gen_random_uuid(), 'field-visit-evidence-002'
  );

  SELECT * INTO summary_record
  FROM field_visit_summaries
  WHERE visit_id = visit_id_value;

  IF summary_record.outcome_count <> 2
    OR summary_record.qualifying_outcome_count <> 2
    OR summary_record.evidence_count <> 2
    OR summary_record.has_qualifying_outcome IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'field visit summary counts are incorrect: %', row_to_json(summary_record);
  END IF;

  BEGIN
    UPDATE field_visit_outcomes SET summary = 'محاولة تعديل ممنوعة' WHERE id = outcome_one_id;
    RAISE EXCEPTION 'expected field visit outcome mutation to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected field visit outcome mutation to fail' THEN RAISE; END IF;
    IF position('append-only' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected outcome immutability error: %', SQLERRM;
    END IF;
  END;

  UPDATE field_visits
  SET state = 'CHECKED_OUT',
      departed_at = now() + interval '1 minute',
      device_departed_at = now() + interval '30 seconds',
      checkout_latitude = 12.785510,
      checkout_longitude = 45.018210,
      checkout_accuracy_meters = 7.0
  WHERE id = visit_id_value;

  UPDATE field_visits
  SET state = 'SUBMITTED',
      declared_result = 'SUCCESS',
      outcome_summary = 'تم تحديث بيانات العميل وحل مشكلة الوصول.',
      submitted_by = representative_user_id,
      submitted_at = now()
  WHERE id = visit_id_value;

  UPDATE field_visits
  SET state = 'VERIFIED', verified_by = manager_id, verified_at = now()
  WHERE id = visit_id_value;

  INSERT INTO daily_plan_item_results (
    plan_item_id, visit_id, result_type, reason, recorded_by,
    request_id, idempotency_key
  ) VALUES (
    plan_item_id_value, visit_id_value, 'VISITED_SUCCESS',
    'زيارة ناجحة بنتيجة موثقة.', manager_id,
    gen_random_uuid(), 'field-visit-plan-result-001'
  ) RETURNING id INTO result_id_value;

  IF NOT EXISTS (
    SELECT 1 FROM current_daily_plan_item_results WHERE id = result_id_value
  ) THEN
    RAISE EXCEPTION 'current daily plan item result was not exposed';
  END IF;

  UPDATE daily_plans
  SET state = 'COMPLETED', completed_by = representative_user_id, completed_at = now()
  WHERE id = plan_id_value;

  INSERT INTO daily_plans (
    representative_id, plan_date, cutoff_at, ruleset_version,
    source_snapshot, input_fingerprint, created_by, idempotency_key
  ) VALUES (
    representative_id_value,
    (now() AT TIME ZONE 'Asia/Aden')::date,
    now(),
    'daily-plan-v1',
    '{}'::jsonb,
    repeat('b', 64),
    manager_id,
    'field-visit-plan-002'
  ) RETURNING id INTO second_plan_id;

  INSERT INTO daily_plan_items (
    plan_id, sequence_number, customer_id, task_type, priority_level,
    priority_score, selection_reason, objective, expected_result,
    area_id, route_id, estimated_visit_minutes, estimated_travel_minutes,
    created_by, updated_by
  ) VALUES (
    second_plan_id, 1, customer_id_value, 'DATA_UPDATE', 'MEDIUM',
    300, 'اختبار منع الإكمال.', 'تحديث.', 'نتيجة.',
    area_id_value, route_id_value, 20, 5, manager_id, manager_id
  ) RETURNING id INTO second_item_id;

  UPDATE daily_plans
  SET state = 'PENDING_APPROVAL', submitted_by = manager_id, submitted_at = now()
  WHERE id = second_plan_id;

  UPDATE daily_plans
  SET state = 'APPROVED', approved_by = manager_id, approved_at = now()
  WHERE id = second_plan_id;

  UPDATE daily_plans
  SET state = 'IN_PROGRESS', started_by = representative_user_id, started_at = now()
  WHERE id = second_plan_id;

  BEGIN
    UPDATE daily_plans
    SET state = 'COMPLETED', completed_by = representative_user_id, completed_at = now()
    WHERE id = second_plan_id;
    RAISE EXCEPTION 'expected plan completion without item results to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected plan completion without item results to fail' THEN RAISE; END IF;
    IF position('items lack execution results' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected plan completion guard error: %', SQLERRM;
    END IF;
  END;

  INSERT INTO field_visits (
    representative_id, customer_id, visit_source, visit_type, objective,
    out_of_plan_reason, created_by, idempotency_key
  ) VALUES (
    representative_id_value, customer_id_value, 'OUT_OF_PLAN', 'PROBLEM_RESOLUTION',
    'متابعة مشكلة طارئة.', 'تكليف طارئ خارج الخطة.',
    representative_user_id, 'field-visit-out-of-plan-001'
  ) RETURNING id INTO out_of_plan_visit_id;

  UPDATE field_visits
  SET state = 'CHECKED_IN', arrived_at = now()
  WHERE id = out_of_plan_visit_id;

  INSERT INTO field_visit_outcomes (
    visit_id, outcome_type, summary, recorded_by, request_id, idempotency_key
  ) VALUES (
    out_of_plan_visit_id, 'NO_RESULT', 'لم يوجد المسؤول في الموقع.',
    representative_user_id, gen_random_uuid(), 'field-visit-outcome-no-result'
  );

  UPDATE field_visits
  SET state = 'CHECKED_OUT', departed_at = now() + interval '1 minute'
  WHERE id = out_of_plan_visit_id;

  BEGIN
    UPDATE field_visits
    SET state = 'SUBMITTED', declared_result = 'SUCCESS',
        outcome_summary = 'إعلان نجاح غير صحيح.',
        submitted_by = representative_user_id, submitted_at = now()
    WHERE id = out_of_plan_visit_id;
    RAISE EXCEPTION 'expected successful visit without qualifying outcome to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected successful visit without qualifying outcome to fail' THEN RAISE; END IF;
    IF position('requires at least one qualifying outcome' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected successful visit guard error: %', SQLERRM;
    END IF;
  END;

  UPDATE field_visits
  SET state = 'SUBMITTED', declared_result = 'NO_CONTACT',
      outcome_summary = 'لم يوجد المسؤول في الموقع.',
      submitted_by = representative_user_id, submitted_at = now()
  WHERE id = out_of_plan_visit_id;

  BEGIN
    UPDATE field_visits
    SET state = 'VERIFIED', verified_by = outsider_user_id, verified_at = now()
    WHERE id = out_of_plan_visit_id;
    RAISE EXCEPTION 'expected non-manager out-of-plan verification to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected non-manager out-of-plan verification to fail' THEN RAISE; END IF;
    IF position('must be verified by a branch manager' IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected out-of-plan verifier error: %', SQLERRM;
    END IF;
  END;

  UPDATE field_visits
  SET state = 'VERIFIED', verified_by = manager_id, verified_at = now()
  WHERE id = out_of_plan_visit_id;

  IF second_item_id IS NULL THEN
    RAISE EXCEPTION 'second plan item fixture missing';
  END IF;
END;
$$;

ROLLBACK;
