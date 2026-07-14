BEGIN;

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('INVITE', 'RESET')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  requested_ip inet,
  delivered_at timestamptz,
  delivery_provider text,
  delivery_id text,
  consumed_at timestamptz,
  consumed_ip inet,
  revoked_at timestamptz,
  revoke_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT password_reset_token_hash_format
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT password_reset_token_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT password_reset_token_delivery_complete
    CHECK (
      (delivered_at IS NULL AND delivery_provider IS NULL AND delivery_id IS NULL)
      OR
      (delivered_at IS NOT NULL AND delivery_provider IS NOT NULL)
    ),
  CONSTRAINT password_reset_token_terminal_state
    CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CONSTRAINT password_reset_token_revocation_complete
    CHECK (
      (revoked_at IS NULL AND revoke_reason IS NULL)
      OR
      (revoked_at IS NOT NULL AND NULLIF(btrim(revoke_reason), '') IS NOT NULL)
    )
);

CREATE UNIQUE INDEX password_reset_tokens_one_active_per_user
  ON password_reset_tokens (user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX password_reset_tokens_user_time_idx
  ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX password_reset_tokens_expiry_idx
  ON password_reset_tokens (expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION validate_password_reset_token_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.id,
    OLD.user_id,
    OLD.token_hash,
    OLD.purpose,
    OLD.created_at,
    OLD.expires_at,
    OLD.request_id,
    OLD.requested_ip,
    OLD.metadata
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.user_id,
    NEW.token_hash,
    NEW.purpose,
    NEW.created_at,
    NEW.expires_at,
    NEW.request_id,
    NEW.requested_ip,
    NEW.metadata
  ) THEN
    RAISE EXCEPTION 'password reset token identity fields are immutable';
  END IF;

  IF (OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL)
    AND ROW(
      NEW.delivered_at,
      NEW.delivery_provider,
      NEW.delivery_id,
      NEW.consumed_at,
      NEW.consumed_ip,
      NEW.revoked_at,
      NEW.revoke_reason
    ) IS DISTINCT FROM ROW(
      OLD.delivered_at,
      OLD.delivery_provider,
      OLD.delivery_id,
      OLD.consumed_at,
      OLD.consumed_ip,
      OLD.revoked_at,
      OLD.revoke_reason
    ) THEN
    RAISE EXCEPTION 'terminal password reset token cannot be modified';
  END IF;

  IF OLD.delivered_at IS NOT NULL AND ROW(
    OLD.delivered_at,
    OLD.delivery_provider,
    OLD.delivery_id
  ) IS DISTINCT FROM ROW(
    NEW.delivered_at,
    NEW.delivery_provider,
    NEW.delivery_id
  ) THEN
    RAISE EXCEPTION 'password reset delivery metadata is immutable once recorded';
  END IF;

  IF NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'token consumption requires a non-revoked token';
    END IF;
  END IF;

  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    IF NEW.consumed_at IS NOT NULL OR NULLIF(btrim(NEW.revoke_reason), '') IS NULL THEN
      RAISE EXCEPTION 'token revocation requires a reason and an unconsumed token';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER password_reset_tokens_validate_update
BEFORE UPDATE ON password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION validate_password_reset_token_update();

CREATE OR REPLACE FUNCTION prevent_password_reset_token_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'password_reset_tokens cannot be deleted';
END;
$$;

CREATE TRIGGER password_reset_tokens_prevent_delete
BEFORE DELETE ON password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION prevent_password_reset_token_delete();

COMMIT;
