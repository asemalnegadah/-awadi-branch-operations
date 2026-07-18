BEGIN;

DO $$
DECLARE
  test_attempt_id uuid;
  second_update_blocked boolean := false;
  delete_blocked boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_login_attempts'
      AND column_name = 'attempt_state'
  ) THEN
    RAISE EXCEPTION 'auth_login_attempts.attempt_state is missing';
  END IF;

  IF to_regclass('public.auth_login_attempts_pending_time_idx') IS NULL THEN
    RAISE EXCEPTION 'auth_login_attempts_pending_time_idx is missing';
  END IF;

  INSERT INTO auth_login_attempts (
    normalized_email,
    succeeded,
    failure_reason,
    attempt_state,
    completed_at,
    request_id,
    ip_address,
    user_agent
  ) VALUES (
    'atomic.smoke@example.test',
    NULL,
    NULL,
    'PENDING',
    NULL,
    gen_random_uuid(),
    '127.0.0.240',
    'atomic-login-smoke'
  )
  RETURNING id INTO test_attempt_id;

  UPDATE auth_login_attempts
  SET succeeded = false,
      failure_reason = 'INVALID_CREDENTIALS',
      attempt_state = 'COMPLETED',
      completed_at = now()
  WHERE id = test_attempt_id;

  BEGIN
    UPDATE auth_login_attempts
    SET failure_reason = 'ACCOUNT_LOCKED'
    WHERE id = test_attempt_id;
  EXCEPTION WHEN OTHERS THEN
    second_update_blocked := true;
  END;

  IF NOT second_update_blocked THEN
    RAISE EXCEPTION 'completed auth login attempt accepted a second update';
  END IF;

  BEGIN
    DELETE FROM auth_login_attempts WHERE id = test_attempt_id;
  EXCEPTION WHEN OTHERS THEN
    delete_blocked := true;
  END;

  IF NOT delete_blocked THEN
    RAISE EXCEPTION 'auth login attempt accepted a delete';
  END IF;
END;
$$;

ROLLBACK;
