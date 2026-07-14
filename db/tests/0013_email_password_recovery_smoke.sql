BEGIN;

DO $$
DECLARE
  test_user_id uuid := gen_random_uuid();
  test_token_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO users (
    id,
    email,
    full_name,
    status,
    must_change_password
  ) VALUES (
    test_user_id,
    'password-reset-smoke@example.test',
    'مستخدم اختبار استعادة كلمة المرور',
    'INVITED',
    true
  );

  INSERT INTO password_reset_tokens (
    id,
    user_id,
    token_hash,
    purpose,
    expires_at,
    request_id,
    requested_ip
  ) VALUES (
    test_token_id,
    test_user_id,
    repeat('a', 64),
    'INVITE',
    now() + interval '30 minutes',
    gen_random_uuid(),
    '127.0.0.1'
  );

  BEGIN
    UPDATE password_reset_tokens
    SET token_hash = repeat('b', 64)
    WHERE id = test_token_id;

    RAISE EXCEPTION 'token hash mutation should have failed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'token hash mutation should have failed' THEN
        RAISE;
      END IF;
  END;

  UPDATE password_reset_tokens
  SET delivered_at = now(),
      delivery_provider = 'TEST',
      delivery_id = 'delivery-smoke'
  WHERE id = test_token_id;

  UPDATE password_reset_tokens
  SET consumed_at = now(),
      consumed_ip = '127.0.0.1'
  WHERE id = test_token_id;

  IF NOT EXISTS (
    SELECT 1
    FROM password_reset_tokens
    WHERE id = test_token_id
      AND consumed_at IS NOT NULL
      AND delivered_at IS NOT NULL
      AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'token consumption was not persisted';
  END IF;

  BEGIN
    UPDATE password_reset_tokens
    SET revoked_at = now(),
        revoke_reason = 'INVALID_AFTER_CONSUMPTION'
    WHERE id = test_token_id;

    RAISE EXCEPTION 'consumed token revocation should have failed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'consumed token revocation should have failed' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM password_reset_tokens WHERE id = test_token_id;

    RAISE EXCEPTION 'token deletion should have failed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'token deletion should have failed' THEN
        RAISE;
      END IF;
  END;
END;
$$;

ROLLBACK;
