BEGIN;

ALTER TABLE organization_settings
  ADD COLUMN operating_mode text NOT NULL DEFAULT 'SINGLE_MANAGER'
    CHECK (operating_mode IN ('SINGLE_MANAGER', 'MULTI_USER'));

ALTER TABLE users
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN password_version integer NOT NULL DEFAULT 1
    CHECK (password_version >= 1),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  password_version integer NOT NULL CHECK (password_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoke_reason text,
  ip_address inet,
  user_agent text,
  CONSTRAINT user_sessions_token_hash_format
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT user_sessions_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT user_sessions_revocation_complete
    CHECK (
      (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR
      (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
    )
);

CREATE INDEX user_sessions_active_user_idx
  ON user_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX user_sessions_expiry_idx
  ON user_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE auth_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  normalized_email text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES user_sessions(id) ON DELETE RESTRICT,
  succeeded boolean NOT NULL,
  failure_reason text,
  request_id uuid NOT NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT auth_login_attempts_email_normalized
    CHECK (normalized_email = lower(btrim(normalized_email))),
  CONSTRAINT auth_login_attempts_result_complete
    CHECK (
      (succeeded = true AND failure_reason IS NULL)
      OR
      (succeeded = false AND failure_reason IS NOT NULL)
    )
);

CREATE INDEX auth_login_attempts_email_time_idx
  ON auth_login_attempts (normalized_email, occurred_at DESC);

CREATE INDEX auth_login_attempts_user_time_idx
  ON auth_login_attempts (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_auth_login_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'auth_login_attempts is append-only';
END;
$$;

CREATE TRIGGER auth_login_attempts_prevent_update
BEFORE UPDATE ON auth_login_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_auth_login_attempt_mutation();

CREATE TRIGGER auth_login_attempts_prevent_delete
BEFORE DELETE ON auth_login_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_auth_login_attempt_mutation();

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
CROSS JOIN permissions AS permission
WHERE role.code = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
