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
END;
$$;

ROLLBACK;
