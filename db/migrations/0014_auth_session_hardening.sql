BEGIN;

CREATE INDEX auth_login_attempts_ip_time_idx
  ON auth_login_attempts (ip_address, occurred_at DESC)
  WHERE ip_address IS NOT NULL;

CREATE INDEX user_sessions_active_last_seen_idx
  ON user_sessions (last_seen_at)
  WHERE revoked_at IS NULL;

COMMIT;
