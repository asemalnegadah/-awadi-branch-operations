BEGIN;

ALTER TABLE auth_login_attempts
  ADD COLUMN attempt_state text NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN completed_at timestamptz DEFAULT now();

DROP TRIGGER auth_login_attempts_prevent_update ON auth_login_attempts;

UPDATE auth_login_attempts
SET completed_at = occurred_at
WHERE completed_at IS NULL;

ALTER TABLE auth_login_attempts
  ALTER COLUMN succeeded DROP NOT NULL,
  DROP CONSTRAINT auth_login_attempts_result_complete,
  ADD CONSTRAINT auth_login_attempts_state_valid
    CHECK (attempt_state IN ('PENDING', 'COMPLETED')),
  ADD CONSTRAINT auth_login_attempts_result_complete
    CHECK (
      (
        attempt_state = 'PENDING'
        AND succeeded IS NULL
        AND failure_reason IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        attempt_state = 'COMPLETED'
        AND completed_at IS NOT NULL
        AND completed_at >= occurred_at
        AND (
          (succeeded = true AND failure_reason IS NULL)
          OR
          (succeeded = false AND failure_reason IS NOT NULL)
        )
      )
    );

CREATE INDEX auth_login_attempts_pending_time_idx
  ON auth_login_attempts (occurred_at DESC)
  WHERE attempt_state = 'PENDING';

CREATE OR REPLACE FUNCTION guard_auth_login_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.attempt_state <> 'PENDING' OR NEW.attempt_state <> 'COMPLETED' THEN
    RAISE EXCEPTION 'auth_login_attempts only permits PENDING to COMPLETED transition';
  END IF;

  IF ROW(
    OLD.id,
    OLD.occurred_at,
    OLD.normalized_email,
    OLD.request_id,
    OLD.ip_address,
    OLD.user_agent,
    OLD.metadata
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.occurred_at,
    NEW.normalized_email,
    NEW.request_id,
    NEW.ip_address,
    NEW.user_agent,
    NEW.metadata
  ) THEN
    RAISE EXCEPTION 'auth_login_attempt identity and request context are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_login_attempts_guard_update
BEFORE UPDATE ON auth_login_attempts
FOR EACH ROW EXECUTE FUNCTION guard_auth_login_attempt_update();

COMMIT;
