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

CREATE OR REPLACE FUNCTION is_single_manager_actor(actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT actor_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM organization_settings
      WHERE singleton_id = 1
        AND operating_mode = 'SINGLE_MANAGER'
    )
    AND EXISTS (
      SELECT 1
      FROM user_roles AS user_role
      JOIN roles AS role ON role.id = user_role.role_id
      JOIN users AS user_account ON user_account.id = user_role.user_id
      WHERE user_role.user_id = actor_id
        AND role.code = 'BRANCH_MANAGER'
        AND user_account.status = 'ACTIVE'
        AND user_account.deleted_at IS NULL
        AND user_role.revoked_at IS NULL
        AND user_role.valid_from <= now()
        AND (user_role.valid_until IS NULL OR user_role.valid_until > now())
    );
$$;

CREATE OR REPLACE FUNCTION validate_collection_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_reason text;
  linked_entry customer_ledger_entries%ROWTYPE;
BEGIN
  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');

  IF ROW(OLD.id, OLD.created_at, OLD.created_by, OLD.idempotency_key)
    IS DISTINCT FROM
    ROW(NEW.id, NEW.created_at, NEW.created_by, NEW.idempotency_key) THEN
    RAISE EXCEPTION 'collection identity and creation fields are immutable';
  END IF;

  IF OLD.state <> 'DRAFT' OR NEW.state <> OLD.state THEN
    IF ROW(
      OLD.customer_id,
      OLD.customer_account_id,
      OLD.representative_id,
      OLD.currency_code,
      OLD.amount_minor,
      OLD.payment_method,
      OLD.collected_at,
      OLD.receipt_number,
      OLD.evidence_document_id,
      OLD.evidence_note
    ) IS DISTINCT FROM ROW(
      NEW.customer_id,
      NEW.customer_account_id,
      NEW.representative_id,
      NEW.currency_code,
      NEW.amount_minor,
      NEW.payment_method,
      NEW.collected_at,
      NEW.receipt_number,
      NEW.evidence_document_id,
      NEW.evidence_note
    ) THEN
      RAISE EXCEPTION 'collection financial and evidence fields are frozen after draft';
    END IF;
  END IF;

  IF OLD.state <> NEW.state
    AND NOT collection_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'invalid collection state transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF OLD.state <> NEW.state
    AND NEW.state IN ('RETURNED', 'CONFLICTED', 'REJECTED')
    AND transition_reason IS NULL THEN
    RAISE EXCEPTION 'transition reason is required for state %', NEW.state;
  END IF;

  IF NEW.state = 'SUBMITTED'
    AND NEW.receipt_number IS NULL
    AND NEW.evidence_document_id IS NULL THEN
    RAISE EXCEPTION 'submitted collection requires receipt or evidence';
  END IF;

  IF ROW(NEW.reviewed_at, NEW.reviewed_by)
    IS DISTINCT FROM ROW(OLD.reviewed_at, OLD.reviewed_by)
    AND NEW.state <> 'REVIEWED' THEN
    RAISE EXCEPTION 'review fields may only be set during review transition';
  END IF;

  IF NEW.state = 'REVIEWED' AND (
    NEW.reviewed_by IS NULL
    OR NEW.reviewed_at IS NULL
    OR (
      NEW.reviewed_by = NEW.created_by
      AND NOT is_single_manager_actor(NEW.reviewed_by)
    )
  ) THEN
    RAISE EXCEPTION 'reviewed collection requires an authorized reviewer and review time';
  END IF;

  IF ROW(NEW.approved_at, NEW.approved_by)
    IS DISTINCT FROM ROW(OLD.approved_at, OLD.approved_by)
    AND NEW.state <> 'APPROVED' THEN
    RAISE EXCEPTION 'approval fields may only be set during approval transition';
  END IF;

  IF NEW.state = 'APPROVED' AND (
    NEW.approved_by IS NULL
    OR NEW.approved_at IS NULL
    OR (
      NEW.approved_by = NEW.created_by
      AND NOT is_single_manager_actor(NEW.approved_by)
    )
  ) THEN
    RAISE EXCEPTION 'approved collection requires an authorized approver and approval time';
  END IF;

  IF ROW(NEW.cash_received_at, NEW.cash_received_by)
    IS DISTINCT FROM ROW(OLD.cash_received_at, OLD.cash_received_by)
    AND NEW.state <> 'CASH_RECEIVED' THEN
    RAISE EXCEPTION 'cash receipt fields may only be set during cash receipt transition';
  END IF;

  IF NEW.state = 'CASH_RECEIVED' AND (
    NEW.cash_received_by IS NULL
    OR NEW.cash_received_at IS NULL
    OR (
      NEW.cash_received_by = NEW.created_by
      AND NOT is_single_manager_actor(NEW.cash_received_by)
    )
  ) THEN
    RAISE EXCEPTION 'cash receipt requires an authorized receiver and receipt time';
  END IF;

  IF NEW.ledger_entry_id IS DISTINCT FROM OLD.ledger_entry_id THEN
    IF OLD.ledger_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'linked ledger entry cannot be replaced';
    END IF;

    IF NEW.state <> 'RECONCILED' OR NEW.ledger_entry_id IS NULL THEN
      RAISE EXCEPTION 'ledger entry may only be linked during reconciliation';
    END IF;

    SELECT * INTO linked_entry
    FROM customer_ledger_entries
    WHERE id = NEW.ledger_entry_id;

    IF linked_entry.id IS NULL THEN
      RAISE EXCEPTION 'linked ledger entry does not exist';
    END IF;

    IF linked_entry.entry_type <> 'COLLECTION'
      OR linked_entry.direction <> 'CREDIT'
      OR linked_entry.customer_id <> NEW.customer_id
      OR linked_entry.customer_account_id <> NEW.customer_account_id
      OR linked_entry.currency_code <> NEW.currency_code
      OR linked_entry.amount_minor <> NEW.amount_minor
      OR linked_entry.source_type <> 'COLLECTION'
      OR linked_entry.source_id <> NEW.id::text THEN
      RAISE EXCEPTION 'linked ledger entry does not match collection';
    END IF;
  END IF;

  IF ROW(NEW.reconciled_at, NEW.reconciled_by)
    IS DISTINCT FROM ROW(OLD.reconciled_at, OLD.reconciled_by)
    AND NEW.state <> 'RECONCILED' THEN
    RAISE EXCEPTION 'reconciliation fields may only be set during reconciliation';
  END IF;

  IF NEW.state = 'RECONCILED' AND (
    NEW.ledger_entry_id IS NULL
    OR NEW.reconciled_by IS NULL
    OR NEW.reconciled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'reconciled collection requires ledger entry and reconciliation actor';
  END IF;

  IF ROW(NEW.closed_at, NEW.closed_by)
    IS DISTINCT FROM ROW(OLD.closed_at, OLD.closed_by)
    AND NEW.state <> 'CLOSED' THEN
    RAISE EXCEPTION 'close fields may only be set during close transition';
  END IF;

  IF NEW.state = 'CLOSED' AND (
    NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR NEW.ledger_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'closed collection requires ledger entry, closer, and close time';
  END IF;

  IF ROW(NEW.reversed_at, NEW.reversed_by, NEW.reversal_reason)
    IS DISTINCT FROM ROW(OLD.reversed_at, OLD.reversed_by, OLD.reversal_reason)
    AND NEW.state <> 'REVERSED' THEN
    RAISE EXCEPTION 'reversal fields may only be set during reversal transition';
  END IF;

  IF NEW.state = 'REVERSED' AND (
    NEW.reversed_by IS NULL
    OR NEW.reversed_at IS NULL
    OR NULLIF(btrim(NEW.reversal_reason), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'reversed collection requires actor, time, and reason';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_collection_state_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_setting text;
  request_value uuid;
  transition_reason text;
  current_operating_mode text;
  self_approved boolean;
BEGIN
  request_setting := NULLIF(btrim(current_setting('app.request_id', true)), '');
  request_value := gen_random_uuid();

  IF request_setting IS NOT NULL THEN
    BEGIN
      request_value := request_setting::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'app.request_id must be a valid UUID';
    END;
  END IF;

  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');
  IF transition_reason IS NULL AND NEW.state = 'REVERSED' THEN
    transition_reason := NULLIF(btrim(NEW.reversal_reason), '');
  END IF;

  SELECT operating_mode
  INTO current_operating_mode
  FROM organization_settings
  WHERE singleton_id = 1;

  self_approved := TG_OP = 'UPDATE'
    AND NEW.updated_by = NEW.created_by
    AND NEW.state IN ('REVIEWED', 'APPROVED', 'CASH_RECEIVED', 'RECONCILED', 'CLOSED', 'REVERSED');

  INSERT INTO collection_state_history (
    collection_id,
    from_state,
    to_state,
    changed_at,
    changed_by,
    reason,
    request_id,
    metadata
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    now(),
    CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END,
    transition_reason,
    request_value,
    jsonb_build_object(
      'version', NEW.version,
      'operating_mode', current_operating_mode,
      'self_approved', self_approved
    )
  );

  RETURN NEW;
END;
$$;

COMMIT;
