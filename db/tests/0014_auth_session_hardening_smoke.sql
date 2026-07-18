BEGIN;

DO $$
BEGIN
  IF to_regclass('public.auth_login_attempts_ip_time_idx') IS NULL THEN
    RAISE EXCEPTION 'auth_login_attempts_ip_time_idx is missing';
  END IF;

  IF to_regclass('public.user_sessions_active_last_seen_idx') IS NULL THEN
    RAISE EXCEPTION 'user_sessions_active_last_seen_idx is missing';
  END IF;
END;
$$;

ROLLBACK;
