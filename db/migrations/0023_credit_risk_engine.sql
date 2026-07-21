BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('risk.read', 'risk', 'read', 'عرض تقييمات المخاطر وقرارات الائتمان ضمن النطاق المسموح.'),
  ('risk.recalculate', 'risk', 'recalculate', 'إعادة حساب تقييم خطر حتمي من بيانات معتمدة.'),
  ('risk.view_history', 'risk', 'view_history', 'عرض تاريخ تقييمات المخاطر وأحداث القرارات.'),
  ('credit_restrictions.propose', 'credit_restrictions', 'propose', 'اقتراح تقييد أو منع البيع الآجل.'),
  ('credit_restrictions.approve', 'credit_restrictions', 'approve', 'اعتماد أو رفض قرار تقييد ائتماني.'),
  ('credit_restrictions.revoke', 'credit_restrictions', 'revoke', 'إلغاء قرار تقييد ائتماني نافذ.'),
  ('credit_exceptions.propose', 'credit_exceptions', 'propose', 'اقتراح استثناء محدد من قرار ائتماني.'),
  ('credit_exceptions.approve', 'credit_exceptions', 'approve', 'اعتماد أو رفض استثناء ائتماني.'),
  ('credit_exceptions.revoke', 'credit_exceptions', 'revoke', 'إلغاء استثناء ائتماني نافذ.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN (
    'risk.read',
    'risk.recalculate',
    'risk.view_history',
    'credit_restrictions.propose',
    'credit_restrictions.approve',
    'credit_restrictions.revoke',
    'credit_exceptions.propose',
    'credit_exceptions.approve',
    'credit_exceptions.revoke'
  )
WHERE role.code = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN ('risk.read', 'risk.view_history')
WHERE role.code IN ('OWNER_AUDITOR', 'AUDITOR', 'ACCOUNTING_CASHIER')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code = 'risk.read'
WHERE role.code = 'SALES_REP'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_credit_risk_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TABLE credit_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IN ('SR', 'RG')),
  cutoff_at timestamptz NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  ruleset_version text NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  recommended_action text NOT NULL CHECK (recommended_action IN ('NONE', 'MONITOR', 'LIMIT', 'BLOCK')),
  automatic_block_recommended boolean NOT NULL,
  data_quality_score smallint NOT NULL CHECK (data_quality_score BETWEEN 0 AND 100),
  factors jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(factors) = 'array'),
  missing_inputs text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (array_position(missing_inputs, NULL) IS NULL),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  supersedes_assessment_id uuid REFERENCES credit_risk_assessments(id) ON DELETE RESTRICT,
  assessed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  CONSTRAINT credit_risk_assessment_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT credit_risk_assessment_ruleset_nonempty
    CHECK (NULLIF(btrim(ruleset_version), '') IS NOT NULL),
  CONSTRAINT credit_risk_assessment_score_shape CHECK (
    (score BETWEEN 0 AND 24
      AND risk_level = 'LOW'
      AND recommended_action = 'NONE'
      AND automatic_block_recommended = false)
    OR
    (score BETWEEN 25 AND 49
      AND risk_level = 'MEDIUM'
      AND recommended_action = 'MONITOR'
      AND automatic_block_recommended = false)
    OR
    (score BETWEEN 50 AND 74
      AND risk_level = 'HIGH'
      AND recommended_action = 'LIMIT'
      AND automatic_block_recommended = false)
    OR
    (score BETWEEN 75 AND 100
      AND risk_level = 'CRITICAL'
      AND recommended_action = 'BLOCK'
      AND automatic_block_recommended = true)
  )
);

CREATE INDEX credit_risk_assessments_account_history_idx
  ON credit_risk_assessments (
    customer_account_id,
    cutoff_at DESC,
    assessed_at DESC,
    id DESC
  );

CREATE INDEX credit_risk_assessments_level_queue_idx
  ON credit_risk_assessments (
    risk_level,
    score DESC,
    cutoff_at DESC,
    id DESC
  );

CREATE INDEX credit_risk_assessments_factors_gin_idx
  ON credit_risk_assessments USING gin (factors);

CREATE OR REPLACE FUNCTION validate_credit_risk_assessment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_customer_id uuid;
  account_currency_code text;
  previous_record credit_risk_assessments%ROWTYPE;
BEGIN
  SELECT customer_id, currency_code
  INTO account_customer_id, account_currency_code
  FROM customer_accounts
  WHERE id = NEW.customer_account_id;

  IF account_customer_id IS NULL THEN
    RAISE EXCEPTION 'credit risk customer account does not exist';
  END IF;

  IF account_customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'credit risk customer does not match customer account';
  END IF;

  IF account_currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'credit risk currency does not match customer account';
  END IF;

  IF NEW.supersedes_assessment_id IS NOT NULL THEN
    SELECT * INTO previous_record
    FROM credit_risk_assessments
    WHERE id = NEW.supersedes_assessment_id;

    IF previous_record.id IS NULL
      OR previous_record.customer_account_id <> NEW.customer_account_id
      OR previous_record.currency_code <> NEW.currency_code THEN
      RAISE EXCEPTION 'superseded credit risk assessment belongs to another account or currency';
    END IF;

    IF previous_record.cutoff_at > NEW.cutoff_at THEN
      RAISE EXCEPTION 'credit risk assessment cannot supersede a newer cutoff';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_risk_assessments_validate
BEFORE INSERT ON credit_risk_assessments
FOR EACH ROW EXECUTE FUNCTION validate_credit_risk_assessment();

CREATE TRIGGER credit_risk_assessments_prevent_update
BEFORE UPDATE ON credit_risk_assessments
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TRIGGER credit_risk_assessments_prevent_delete
BEFORE DELETE ON credit_risk_assessments
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE VIEW current_credit_risk_assessments AS
SELECT DISTINCT ON (assessment.customer_account_id)
  assessment.*
FROM credit_risk_assessments AS assessment
ORDER BY
  assessment.customer_account_id,
  assessment.cutoff_at DESC,
  assessment.assessed_at DESC,
  assessment.id DESC;

CREATE TABLE credit_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IN ('SR', 'RG')),
  decision_type text NOT NULL CHECK (decision_type IN ('LIMIT', 'SUSPEND', 'BLOCK')),
  limit_amount_minor bigint,
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'OLD_DEBT',
    'BROKEN_PROMISE',
    'RECONCILIATION_DIFFERENCE',
    'CLOSED_OR_BANKRUPT',
    'DISPUTE',
    'MISSING_CONTACT',
    'NO_VISIT',
    'UNHANDED_COLLECTION',
    'CREDIT_LIMIT_EXCEEDED',
    'MANAGER_DECISION',
    'OTHER'
  )),
  reason_text text NOT NULL CHECK (NULLIF(btrim(reason_text), '') IS NOT NULL),
  source_assessment_id uuid REFERENCES credit_risk_assessments(id) ON DELETE RESTRICT,
  effective_from timestamptz NOT NULL DEFAULT now(),
  review_due_at timestamptz,
  expires_at timestamptz,
  restoration_conditions text NOT NULL
    CHECK (NULLIF(btrim(restoration_conditions), '') IS NOT NULL),
  proposed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  rejection_reason text,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_restriction_amount_shape CHECK (
    (decision_type = 'LIMIT' AND limit_amount_minor IS NOT NULL AND limit_amount_minor > 0)
    OR
    (decision_type IN ('SUSPEND', 'BLOCK') AND limit_amount_minor IS NULL)
  ),
  CONSTRAINT credit_restriction_time_order CHECK (
    (review_due_at IS NULL OR review_due_at >= effective_from)
    AND (expires_at IS NULL OR expires_at > effective_from)
  ),
  CONSTRAINT credit_restriction_state_shape CHECK (
    (state = 'DRAFT'
      AND submitted_by IS NULL AND submitted_at IS NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'PENDING_APPROVAL'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'ACTIVE'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'REJECTED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL
      AND NULLIF(btrim(rejection_reason), '') IS NOT NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'REVOKED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL
      AND NULLIF(btrim(revocation_reason), '') IS NOT NULL)
    OR
    (state = 'EXPIRED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL
      AND expires_at IS NOT NULL)
  ),
  CONSTRAINT credit_restriction_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE UNIQUE INDEX credit_restrictions_active_account_currency_uidx
  ON credit_restrictions (customer_account_id, currency_code)
  WHERE state = 'ACTIVE';

CREATE INDEX credit_restrictions_review_queue_idx
  ON credit_restrictions (state, review_due_at, effective_from, id);

CREATE OR REPLACE FUNCTION validate_credit_restriction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_customer_id uuid;
  account_currency_code text;
  assessment_record credit_risk_assessments%ROWTYPE;
  allowed_transition boolean;
BEGIN
  SELECT customer_id, currency_code
  INTO account_customer_id, account_currency_code
  FROM customer_accounts
  WHERE id = NEW.customer_account_id;

  IF account_customer_id IS NULL
    OR account_customer_id <> NEW.customer_id
    OR account_currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'credit restriction customer account or currency mismatch';
  END IF;

  IF NEW.source_assessment_id IS NOT NULL THEN
    SELECT * INTO assessment_record
    FROM credit_risk_assessments
    WHERE id = NEW.source_assessment_id;

    IF assessment_record.id IS NULL
      OR assessment_record.customer_account_id <> NEW.customer_account_id
      OR assessment_record.currency_code <> NEW.currency_code THEN
      RAISE EXCEPTION 'credit restriction source assessment mismatch';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'new credit restriction must start as DRAFT';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  allowed_transition :=
    (OLD.state = 'DRAFT' AND NEW.state IN ('DRAFT', 'PENDING_APPROVAL'))
    OR (OLD.state = 'PENDING_APPROVAL' AND NEW.state IN ('ACTIVE', 'REJECTED'))
    OR (OLD.state = 'ACTIVE' AND NEW.state IN ('REVOKED', 'EXPIRED'));

  IF NOT allowed_transition THEN
    RAISE EXCEPTION 'invalid credit restriction transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF NEW.state <> 'DRAFT' AND ROW(
    OLD.id,
    OLD.customer_id,
    OLD.customer_account_id,
    OLD.currency_code,
    OLD.decision_type,
    OLD.limit_amount_minor,
    OLD.reason_code,
    OLD.reason_text,
    OLD.source_assessment_id,
    OLD.effective_from,
    OLD.review_due_at,
    OLD.expires_at,
    OLD.restoration_conditions,
    OLD.proposed_by,
    OLD.proposed_at,
    OLD.idempotency_key,
    OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.customer_id,
    NEW.customer_account_id,
    NEW.currency_code,
    NEW.decision_type,
    NEW.limit_amount_minor,
    NEW.reason_code,
    NEW.reason_text,
    NEW.source_assessment_id,
    NEW.effective_from,
    NEW.review_due_at,
    NEW.expires_at,
    NEW.restoration_conditions,
    NEW.proposed_by,
    NEW.proposed_at,
    NEW.idempotency_key,
    NEW.created_at
  ) THEN
    RAISE EXCEPTION 'submitted credit restriction core fields are immutable';
  END IF;

  IF NEW.state = 'ACTIVE' AND OLD.state <> 'ACTIVE' THEN
    IF NEW.approved_by = NEW.proposed_by
      AND NOT is_single_manager_actor(NEW.approved_by) THEN
      RAISE EXCEPTION 'credit restriction proposer cannot approve the same decision';
    END IF;

    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'active credit restriction cannot already be expired';
    END IF;
  END IF;

  IF NEW.state = 'EXPIRED'
    AND (NEW.expires_at IS NULL OR NEW.expires_at > now()) THEN
    RAISE EXCEPTION 'credit restriction may expire only after expires_at';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_restrictions_validate
BEFORE INSERT OR UPDATE ON credit_restrictions
FOR EACH ROW EXECUTE FUNCTION validate_credit_restriction();

CREATE TRIGGER credit_restrictions_prevent_delete
BEFORE DELETE ON credit_restrictions
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TABLE credit_restriction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restriction_id uuid NOT NULL REFERENCES credit_restrictions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  idempotency_key text NOT NULL UNIQUE,
  CONSTRAINT credit_restriction_event_json_shape CHECK (
    jsonb_typeof(old_values) = 'object' AND jsonb_typeof(new_values) = 'object'
  ),
  CONSTRAINT credit_restriction_event_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX credit_restriction_events_history_idx
  ON credit_restriction_events (restriction_id, occurred_at, id);

CREATE TRIGGER credit_restriction_events_prevent_update
BEFORE UPDATE ON credit_restriction_events
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TRIGGER credit_restriction_events_prevent_delete
BEFORE DELETE ON credit_restriction_events
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TABLE credit_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restriction_id uuid NOT NULL REFERENCES credit_restrictions(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IN ('SR', 'RG')),
  scope text NOT NULL CHECK (scope IN ('SINGLE_TRANSACTION', 'MULTIPLE_TRANSACTIONS')),
  max_amount_minor bigint NOT NULL CHECK (max_amount_minor > 0),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED')),
  reason text NOT NULL CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  conditions text NOT NULL CHECK (NULLIF(btrim(conditions), '') IS NOT NULL),
  proposed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  rejection_reason text,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_exception_time_order CHECK (valid_until > valid_from),
  CONSTRAINT credit_exception_state_shape CHECK (
    (state = 'DRAFT'
      AND submitted_by IS NULL AND submitted_at IS NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'PENDING_APPROVAL'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'ACTIVE'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'REJECTED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL
      AND NULLIF(btrim(rejection_reason), '') IS NOT NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'REVOKED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL
      AND NULLIF(btrim(revocation_reason), '') IS NOT NULL)
    OR
    (state = 'EXPIRED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
  ),
  CONSTRAINT credit_exception_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX credit_exceptions_active_lookup_idx
  ON credit_exceptions (customer_account_id, currency_code, valid_until, id)
  WHERE state = 'ACTIVE';

CREATE INDEX credit_exceptions_review_queue_idx
  ON credit_exceptions (state, valid_from, valid_until, id);

CREATE OR REPLACE FUNCTION validate_credit_exception()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  restriction_record credit_restrictions%ROWTYPE;
  allowed_transition boolean;
BEGIN
  SELECT * INTO restriction_record
  FROM credit_restrictions
  WHERE id = NEW.restriction_id;

  IF restriction_record.id IS NULL
    OR restriction_record.customer_id <> NEW.customer_id
    OR restriction_record.customer_account_id <> NEW.customer_account_id
    OR restriction_record.currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'credit exception restriction, account, or currency mismatch';
  END IF;

  IF NEW.valid_from < restriction_record.effective_from THEN
    RAISE EXCEPTION 'credit exception cannot start before its restriction';
  END IF;

  IF restriction_record.expires_at IS NOT NULL
    AND NEW.valid_until > restriction_record.expires_at THEN
    RAISE EXCEPTION 'credit exception cannot outlive its restriction';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'new credit exception must start as DRAFT';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  allowed_transition :=
    (OLD.state = 'DRAFT' AND NEW.state IN ('DRAFT', 'PENDING_APPROVAL'))
    OR (OLD.state = 'PENDING_APPROVAL' AND NEW.state IN ('ACTIVE', 'REJECTED'))
    OR (OLD.state = 'ACTIVE' AND NEW.state IN ('REVOKED', 'EXPIRED'));

  IF NOT allowed_transition THEN
    RAISE EXCEPTION 'invalid credit exception transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF NEW.state <> 'DRAFT' AND ROW(
    OLD.id,
    OLD.restriction_id,
    OLD.customer_id,
    OLD.customer_account_id,
    OLD.currency_code,
    OLD.scope,
    OLD.max_amount_minor,
    OLD.valid_from,
    OLD.valid_until,
    OLD.reason,
    OLD.conditions,
    OLD.proposed_by,
    OLD.proposed_at,
    OLD.idempotency_key,
    OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.restriction_id,
    NEW.customer_id,
    NEW.customer_account_id,
    NEW.currency_code,
    NEW.scope,
    NEW.max_amount_minor,
    NEW.valid_from,
    NEW.valid_until,
    NEW.reason,
    NEW.conditions,
    NEW.proposed_by,
    NEW.proposed_at,
    NEW.idempotency_key,
    NEW.created_at
  ) THEN
    RAISE EXCEPTION 'submitted credit exception core fields are immutable';
  END IF;

  IF NEW.state = 'ACTIVE' AND OLD.state <> 'ACTIVE' THEN
    IF restriction_record.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'credit exception requires an active restriction';
    END IF;

    IF NEW.approved_by = NEW.proposed_by
      AND NOT is_single_manager_actor(NEW.approved_by) THEN
      RAISE EXCEPTION 'credit exception proposer cannot approve the same exception';
    END IF;

    IF NEW.valid_until <= now() THEN
      RAISE EXCEPTION 'active credit exception cannot already be expired';
    END IF;
  END IF;

  IF NEW.state = 'EXPIRED' AND NEW.valid_until > now() THEN
    RAISE EXCEPTION 'credit exception may expire only after valid_until';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_exceptions_validate
BEFORE INSERT OR UPDATE ON credit_exceptions
FOR EACH ROW EXECUTE FUNCTION validate_credit_exception();

CREATE TRIGGER credit_exceptions_prevent_delete
BEFORE DELETE ON credit_exceptions
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TABLE credit_exception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES credit_exceptions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  idempotency_key text NOT NULL UNIQUE,
  CONSTRAINT credit_exception_event_json_shape CHECK (
    jsonb_typeof(old_values) = 'object' AND jsonb_typeof(new_values) = 'object'
  ),
  CONSTRAINT credit_exception_event_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX credit_exception_events_history_idx
  ON credit_exception_events (exception_id, occurred_at, id);

CREATE TRIGGER credit_exception_events_prevent_update
BEFORE UPDATE ON credit_exception_events
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TRIGGER credit_exception_events_prevent_delete
BEFORE DELETE ON credit_exception_events
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

COMMIT;
