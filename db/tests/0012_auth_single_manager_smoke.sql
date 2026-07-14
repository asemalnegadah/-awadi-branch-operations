BEGIN;

DO $$
DECLARE
  manager_permission_count integer;
  permission_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_settings'
      AND column_name = 'operating_mode'
  ) THEN
    RAISE EXCEPTION 'organization_settings.operating_mode is missing';
  END IF;

  IF (SELECT operating_mode FROM organization_settings WHERE singleton_id = 1)
     <> 'SINGLE_MANAGER' THEN
    RAISE EXCEPTION 'default operating mode must be SINGLE_MANAGER';
  END IF;

  SELECT COUNT(*) INTO permission_count FROM permissions;

  SELECT COUNT(*)
  INTO manager_permission_count
  FROM role_permissions AS role_permission
  JOIN roles AS role ON role.id = role_permission.role_id
  WHERE role.code = 'BRANCH_MANAGER';

  IF manager_permission_count <> permission_count THEN
    RAISE EXCEPTION 'BRANCH_MANAGER must receive every current permission in SINGLE_MANAGER mode';
  END IF;
END;
$$;

DO $$
DECLARE
  test_user_id uuid := gen_random_uuid();
  test_session_id uuid := gen_random_uuid();
  test_attempt_id uuid := gen_random_uuid();
  test_request_id uuid := gen_random_uuid();
  test_representative_id uuid := gen_random_uuid();
  test_customer_id uuid := gen_random_uuid();
  test_account_id uuid := gen_random_uuid();
  test_collection_id uuid := gen_random_uuid();
  test_multi_collection_id uuid := gen_random_uuid();
  latest_metadata jsonb;
  multi_user_blocked boolean := false;
BEGIN
  INSERT INTO users (
    id,
    email,
    full_name,
    password_hash,
    status,
    password_changed_at
  ) VALUES (
    test_user_id,
    'auth-smoke@example.test',
    'مدير اختبار المصادقة',
    'scrypt-v1$16384$8$1$dGVzdC1vbmx5LXNhbHQ$ZmFrZS1oYXNo',
    'ACTIVE',
    now()
  );

  INSERT INTO user_roles (user_id, role_id, granted_by)
  SELECT test_user_id, id, test_user_id
  FROM roles
  WHERE code = 'BRANCH_MANAGER';

  IF NOT is_single_manager_actor(test_user_id) THEN
    RAISE EXCEPTION 'active branch manager must be recognized in SINGLE_MANAGER mode';
  END IF;

  INSERT INTO user_sessions (
    id,
    user_id,
    token_hash,
    password_version,
    expires_at,
    ip_address,
    user_agent
  ) VALUES (
    test_session_id,
    test_user_id,
    repeat('a', 64),
    1,
    now() + interval '8 hours',
    '127.0.0.1',
    'auth-smoke-test'
  );

  UPDATE user_sessions
  SET revoked_at = now(),
      revoked_by = test_user_id,
      revoke_reason = 'SMOKE_TEST'
  WHERE id = test_session_id;

  IF NOT EXISTS (
    SELECT 1
    FROM user_sessions
    WHERE id = test_session_id
      AND revoked_at IS NOT NULL
      AND revoke_reason = 'SMOKE_TEST'
  ) THEN
    RAISE EXCEPTION 'session revocation was not persisted';
  END IF;

  INSERT INTO auth_login_attempts (
    id,
    normalized_email,
    user_id,
    session_id,
    succeeded,
    request_id,
    ip_address,
    user_agent
  ) VALUES (
    test_attempt_id,
    'auth-smoke@example.test',
    test_user_id,
    test_session_id,
    true,
    test_request_id,
    '127.0.0.1',
    'auth-smoke-test'
  );

  BEGIN
    UPDATE auth_login_attempts
    SET metadata = '{"tampered":true}'::jsonb
    WHERE id = test_attempt_id;

    RAISE EXCEPTION 'auth_login_attempts update should have failed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'auth_login_attempts update should have failed' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO sales_representatives (
    id,
    employee_code,
    full_name_ar,
    user_id,
    created_by,
    updated_by
  ) VALUES (
    test_representative_id,
    'AUTH-SMOKE',
    'مندوب اختبار الاعتماد الذاتي',
    test_user_id,
    test_user_id,
    test_user_id
  );

  INSERT INTO customers (
    id,
    customer_number,
    trade_name_ar,
    created_by,
    updated_by
  ) VALUES (
    test_customer_id,
    'AUTH-SMOKE-CUSTOMER',
    'عميل اختبار الاعتماد الذاتي',
    test_user_id,
    test_user_id
  );

  INSERT INTO customer_accounts (
    id,
    customer_id,
    currency_code,
    created_by
  ) VALUES (
    test_account_id,
    test_customer_id,
    'SR',
    test_user_id
  );

  PERFORM set_config('app.request_id', test_request_id::text, true);

  INSERT INTO collections (
    id,
    customer_id,
    customer_account_id,
    representative_id,
    currency_code,
    amount_minor,
    payment_method,
    collected_at,
    receipt_number,
    created_by,
    updated_by,
    idempotency_key
  ) VALUES (
    test_collection_id,
    test_customer_id,
    test_account_id,
    test_representative_id,
    'SR',
    10000,
    'CASH',
    now(),
    'AUTH-SMOKE-RECEIPT',
    test_user_id,
    test_user_id,
    'AUTH-SMOKE-COLLECTION'
  );

  UPDATE collections
  SET state = 'SUBMITTED', updated_by = test_user_id
  WHERE id = test_collection_id;

  UPDATE collections
  SET state = 'REVIEWED',
      reviewed_at = now(),
      reviewed_by = test_user_id,
      updated_by = test_user_id
  WHERE id = test_collection_id;

  UPDATE collections
  SET state = 'APPROVED',
      approved_at = now(),
      approved_by = test_user_id,
      updated_by = test_user_id
  WHERE id = test_collection_id;

  UPDATE collections
  SET state = 'CASH_RECEIVED',
      cash_received_at = now(),
      cash_received_by = test_user_id,
      updated_by = test_user_id
  WHERE id = test_collection_id;

  SELECT metadata
  INTO latest_metadata
  FROM collection_state_history
  WHERE collection_id = test_collection_id
    AND to_state = 'CASH_RECEIVED'
  ORDER BY changed_at DESC
  LIMIT 1;

  IF latest_metadata->>'operating_mode' <> 'SINGLE_MANAGER'
     OR latest_metadata->>'self_approved' <> 'true' THEN
    RAISE EXCEPTION 'self-approved manager transition must be explicitly audited';
  END IF;

  INSERT INTO collections (
    id,
    customer_id,
    customer_account_id,
    representative_id,
    currency_code,
    amount_minor,
    payment_method,
    collected_at,
    receipt_number,
    created_by,
    updated_by,
    idempotency_key
  ) VALUES (
    test_multi_collection_id,
    test_customer_id,
    test_account_id,
    test_representative_id,
    'SR',
    20000,
    'CASH',
    now(),
    'AUTH-MULTI-RECEIPT',
    test_user_id,
    test_user_id,
    'AUTH-MULTI-COLLECTION'
  );

  UPDATE collections
  SET state = 'SUBMITTED', updated_by = test_user_id
  WHERE id = test_multi_collection_id;

  UPDATE organization_settings
  SET operating_mode = 'MULTI_USER'
  WHERE singleton_id = 1;

  IF is_single_manager_actor(test_user_id) THEN
    RAISE EXCEPTION 'single-manager actor check must be disabled in MULTI_USER mode';
  END IF;

  BEGIN
    UPDATE collections
    SET state = 'REVIEWED',
        reviewed_at = now(),
        reviewed_by = test_user_id,
        updated_by = test_user_id
    WHERE id = test_multi_collection_id;
  EXCEPTION
    WHEN OTHERS THEN
      IF position('authorized reviewer' IN SQLERRM) > 0 THEN
        multi_user_blocked := true;
      ELSE
        RAISE;
      END IF;
  END;

  IF NOT multi_user_blocked THEN
    RAISE EXCEPTION 'MULTI_USER mode must block creator self-review';
  END IF;
END;
$$;

ROLLBACK;
