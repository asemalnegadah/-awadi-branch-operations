BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('cash_custody.read', 'cash_custody', 'read', 'قراءة عهدة المندوب النقدية'),
  ('cash_custody.handover', 'cash_custody', 'handover', 'تسجيل تسليم نقدية من عهدة المندوب'),
  ('cash_closings.read', 'cash_closings', 'read', 'قراءة الإغلاقات النقدية اليومية'),
  ('cash_closings.create', 'cash_closings', 'create', 'إنشاء وتصحيح وإرسال إغلاق نقدي يومي'),
  ('cash_closings.review', 'cash_closings', 'review', 'مراجعة الإغلاق النقدي اليومي'),
  ('cash_closings.approve', 'cash_closings', 'approve', 'اعتماد الإغلاق النقدي اليومي'),
  ('cash_closings.view_history', 'cash_closings', 'view_history', 'عرض السجل التاريخي للإغلاق النقدي')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.code = ANY (
  CASE role.code
    WHEN 'BRANCH_MANAGER' THEN ARRAY[
      'cash_custody.read', 'cash_custody.handover',
      'cash_closings.read', 'cash_closings.create', 'cash_closings.review',
      'cash_closings.approve', 'cash_closings.view_history'
    ]::text[]
    WHEN 'ACCOUNTING_CASHIER' THEN ARRAY[
      'cash_custody.read', 'cash_custody.handover',
      'cash_closings.read', 'cash_closings.create', 'cash_closings.review',
      'cash_closings.view_history'
    ]::text[]
    WHEN 'AUDITOR' THEN ARRAY[
      'cash_custody.read', 'cash_closings.read', 'cash_closings.review',
      'cash_closings.approve', 'cash_closings.view_history'
    ]::text[]
    WHEN 'OWNER_AUDITOR' THEN ARRAY[
      'cash_custody.read', 'cash_closings.read',
      'cash_closings.approve', 'cash_closings.view_history'
    ]::text[]
    WHEN 'SALES_REP' THEN ARRAY[
      'cash_custody.read', 'cash_closings.read', 'cash_closings.create'
    ]::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE role.code IN (
  'BRANCH_MANAGER', 'ACCOUNTING_CASHIER', 'AUDITOR', 'OWNER_AUDITOR', 'SALES_REP'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE cash_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  handed_over_at timestamptz NOT NULL,
  received_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 120),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 3 AND 1000),
  custody_event_id uuid NOT NULL UNIQUE
    REFERENCES representative_cash_custody_events(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  create_payload jsonb NOT NULL,
  CONSTRAINT cash_handover_reference_unique UNIQUE (
    representative_id, currency_code, reference
  ),
  CONSTRAINT cash_handover_payload_object CHECK (jsonb_typeof(create_payload) = 'object')
);

CREATE INDEX cash_handovers_rep_currency_time_idx
  ON cash_handovers (representative_id, currency_code, handed_over_at DESC, id DESC);

CREATE UNIQUE INDEX custody_handover_source_once
  ON representative_cash_custody_events (source_id)
  WHERE event_type = 'HANDOVER_OUT' AND source_type = 'CASH_HANDOVER';

CREATE TABLE cash_daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  opening_balance_minor bigint NOT NULL DEFAULT 0 CHECK (opening_balance_minor >= 0),
  collections_in_minor bigint NOT NULL DEFAULT 0 CHECK (collections_in_minor >= 0),
  reversals_in_minor bigint NOT NULL DEFAULT 0 CHECK (reversals_in_minor >= 0),
  handovers_out_minor bigint NOT NULL DEFAULT 0 CHECK (handovers_out_minor >= 0),
  reversals_out_minor bigint NOT NULL DEFAULT 0 CHECK (reversals_out_minor >= 0),
  declared_cash_minor bigint NOT NULL CHECK (declared_cash_minor >= 0),
  expected_cash_minor bigint GENERATED ALWAYS AS (
    opening_balance_minor + collections_in_minor + reversals_in_minor
      - handovers_out_minor - reversals_out_minor
  ) STORED,
  variance_minor bigint GENERATED ALWAYS AS (
    declared_cash_minor - (
      opening_balance_minor + collections_in_minor + reversals_in_minor
        - handovers_out_minor - reversals_out_minor
    )
  ) STORED,
  variance_reason text CHECK (
    variance_reason IS NULL OR length(btrim(variance_reason)) BETWEEN 3 AND 2000
  ),
  snapshot_revision integer NOT NULL DEFAULT 0 CHECK (snapshot_revision >= 0),
  snapshot_at timestamptz,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'PENDING_APPROVAL',
    'APPROVED', 'RETURNED', 'REJECTED'
  )),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  returned_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  returned_at timestamptz,
  return_reason text,
  rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  rejection_reason text,
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  create_payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_closing_expected_nonnegative CHECK (
    opening_balance_minor + collections_in_minor + reversals_in_minor
      >= handovers_out_minor + reversals_out_minor
  ),
  CONSTRAINT cash_closing_payload_object CHECK (jsonb_typeof(create_payload) = 'object')
);

CREATE UNIQUE INDEX cash_daily_closings_one_active
  ON cash_daily_closings (representative_id, business_date, currency_code)
  WHERE state <> 'REJECTED';

CREATE INDEX cash_daily_closings_state_date_idx
  ON cash_daily_closings (state, business_date DESC, created_at DESC, id DESC);

CREATE INDEX cash_daily_closings_rep_currency_idx
  ON cash_daily_closings (representative_id, currency_code, business_date DESC, id DESC);

CREATE TABLE cash_daily_closing_snapshot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id uuid NOT NULL REFERENCES cash_daily_closings(id) ON DELETE RESTRICT,
  snapshot_revision integer NOT NULL CHECK (snapshot_revision > 0),
  custody_event_id uuid NOT NULL REFERENCES representative_cash_custody_events(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('COLLECTION_IN', 'HANDOVER_OUT', 'REVERSAL')),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_closing_snapshot_item_unique UNIQUE (
    closing_id, snapshot_revision, custody_event_id
  )
);

CREATE INDEX cash_closing_snapshot_items_lookup_idx
  ON cash_daily_closing_snapshot_items (closing_id, snapshot_revision, occurred_at, id);

CREATE TABLE cash_daily_closing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id uuid NOT NULL REFERENCES cash_daily_closings(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'REVISED', 'SUBMITTED', 'REVIEWED',
    'PENDING_APPROVAL', 'APPROVED', 'RETURNED', 'REJECTED'
  )),
  from_state text,
  to_state text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  request_id uuid NOT NULL,
  operating_mode text NOT NULL CHECK (operating_mode IN ('SINGLE_MANAGER', 'MULTI_USER')),
  self_approved boolean NOT NULL DEFAULT false,
  snapshot_revision integer NOT NULL CHECK (snapshot_revision >= 0),
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX cash_daily_closing_events_lookup_idx
  ON cash_daily_closing_events (closing_id, occurred_at, id);

CREATE TABLE cash_daily_closing_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id uuid NOT NULL REFERENCES cash_daily_closings(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN (
    'REVISE', 'SUBMIT', 'REVIEW', 'REQUEST_APPROVAL',
    'APPROVE', 'RETURN', 'REJECT'
  )),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  canonical_payload jsonb NOT NULL,
  result_version integer NOT NULL CHECK (result_version > 0),
  request_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_closing_command_payload_object CHECK (jsonb_typeof(canonical_payload) = 'object')
);

CREATE INDEX cash_daily_closing_commands_lookup_idx
  ON cash_daily_closing_commands (closing_id, created_at, id);

CREATE OR REPLACE FUNCTION cash_closing_transition_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_state
    WHEN 'DRAFT' THEN new_state = 'PENDING_REVIEW'
    WHEN 'RETURNED' THEN new_state = 'PENDING_REVIEW'
    WHEN 'PENDING_REVIEW' THEN new_state IN ('REVIEWED', 'RETURNED', 'REJECTED')
    WHEN 'REVIEWED' THEN new_state = 'PENDING_APPROVAL'
    WHEN 'PENDING_APPROVAL' THEN new_state IN ('APPROVED', 'RETURNED', 'REJECTED')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION validate_cash_daily_closing_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_reason text;
BEGIN
  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');

  IF ROW(OLD.id, OLD.representative_id, OLD.business_date, OLD.currency_code,
         OLD.created_by, OLD.created_at, OLD.idempotency_key, OLD.create_payload)
    IS DISTINCT FROM
     ROW(NEW.id, NEW.representative_id, NEW.business_date, NEW.currency_code,
         NEW.created_by, NEW.created_at, NEW.idempotency_key, NEW.create_payload) THEN
    RAISE EXCEPTION 'cash closing identity and creation fields are immutable';
  END IF;

  IF OLD.state NOT IN ('DRAFT', 'RETURNED') AND ROW(
      OLD.declared_cash_minor, OLD.variance_reason
    ) IS DISTINCT FROM ROW(
      NEW.declared_cash_minor, NEW.variance_reason
    ) THEN
    RAISE EXCEPTION 'cash closing declaration is frozen outside draft or returned state';
  END IF;

  IF ROW(
      OLD.opening_balance_minor, OLD.collections_in_minor, OLD.reversals_in_minor,
      OLD.handovers_out_minor, OLD.reversals_out_minor,
      OLD.snapshot_revision, OLD.snapshot_at
    ) IS DISTINCT FROM ROW(
      NEW.opening_balance_minor, NEW.collections_in_minor, NEW.reversals_in_minor,
      NEW.handovers_out_minor, NEW.reversals_out_minor,
      NEW.snapshot_revision, NEW.snapshot_at
    ) THEN
    IF NEW.state <> 'PENDING_REVIEW'
      OR OLD.state NOT IN ('DRAFT', 'RETURNED')
      OR NEW.snapshot_revision <> OLD.snapshot_revision + 1
      OR NEW.snapshot_at IS NULL THEN
      RAISE EXCEPTION 'cash closing snapshot may only be refreshed during submission';
    END IF;
  END IF;

  IF OLD.state <> NEW.state AND NOT cash_closing_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'invalid cash closing state transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF OLD.state <> NEW.state
    AND NEW.state IN ('RETURNED', 'REJECTED')
    AND transition_reason IS NULL THEN
    RAISE EXCEPTION 'transition reason is required for cash closing state %', NEW.state;
  END IF;

  IF NEW.state = 'PENDING_REVIEW' AND (
    NEW.snapshot_at IS NULL
    OR NEW.snapshot_revision <= 0
    OR (NEW.variance_minor <> 0 AND NULLIF(btrim(NEW.variance_reason), '') IS NULL)
  ) THEN
    RAISE EXCEPTION 'submitted cash closing requires a current snapshot and variance reason';
  END IF;

  IF ROW(NEW.reviewed_by, NEW.reviewed_at)
    IS DISTINCT FROM ROW(OLD.reviewed_by, OLD.reviewed_at)
    AND NEW.state <> 'REVIEWED' THEN
    RAISE EXCEPTION 'cash closing review fields may only be set during review';
  END IF;

  IF NEW.state = 'REVIEWED' AND (
    NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
    OR (NEW.reviewed_by = NEW.created_by AND NOT is_single_manager_actor(NEW.reviewed_by))
  ) THEN
    RAISE EXCEPTION 'cash closing review requires an independent reviewer outside single-manager mode';
  END IF;

  IF ROW(NEW.approved_by, NEW.approved_at)
    IS DISTINCT FROM ROW(OLD.approved_by, OLD.approved_at)
    AND NEW.state <> 'APPROVED' THEN
    RAISE EXCEPTION 'cash closing approval fields may only be set during approval';
  END IF;

  IF NEW.state = 'APPROVED' AND (
    NEW.approved_by IS NULL OR NEW.approved_at IS NULL
    OR (
      (NEW.approved_by = NEW.created_by OR NEW.approved_by = NEW.reviewed_by)
      AND NOT is_single_manager_actor(NEW.approved_by)
    )
  ) THEN
    RAISE EXCEPTION 'cash closing approval requires an independent approver outside single-manager mode';
  END IF;

  IF NEW.state = 'RETURNED' AND (
    NEW.returned_by IS NULL OR NEW.returned_at IS NULL
    OR NULLIF(btrim(NEW.return_reason), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'returned cash closing requires actor, time, and reason';
  END IF;

  IF NEW.state = 'REJECTED' AND (
    NEW.rejected_by IS NULL OR NEW.rejected_at IS NULL
    OR NULLIF(btrim(NEW.rejection_reason), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'rejected cash closing requires actor, time, and reason';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_daily_closings_validate_update
BEFORE UPDATE ON cash_daily_closings
FOR EACH ROW EXECUTE FUNCTION validate_cash_daily_closing_update();

CREATE TRIGGER cash_daily_closings_prevent_delete
BEFORE DELETE ON cash_daily_closings
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION record_cash_daily_closing_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_value uuid;
  request_setting text;
  transition_reason text;
  mode_value text;
  event_value text;
BEGIN
  request_setting := NULLIF(btrim(current_setting('app.request_id', true)), '');
  request_value := COALESCE(request_setting::uuid, gen_random_uuid());
  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');
  SELECT operating_mode INTO mode_value FROM organization_settings WHERE singleton_id = 1;

  event_value := CASE
    WHEN TG_OP = 'INSERT' THEN 'CREATED'
    WHEN OLD.state = NEW.state THEN 'REVISED'
    WHEN NEW.state = 'PENDING_REVIEW' THEN 'SUBMITTED'
    WHEN NEW.state = 'REVIEWED' THEN 'REVIEWED'
    WHEN NEW.state = 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'
    WHEN NEW.state = 'APPROVED' THEN 'APPROVED'
    WHEN NEW.state = 'RETURNED' THEN 'RETURNED'
    WHEN NEW.state = 'REJECTED' THEN 'REJECTED'
    ELSE NULL
  END;

  IF event_value IS NULL THEN RETURN NEW; END IF;

  INSERT INTO cash_daily_closing_events (
    closing_id, event_type, from_state, to_state, actor_user_id,
    reason, request_id, operating_mode, self_approved,
    snapshot_revision, old_values, new_values
  ) VALUES (
    NEW.id,
    event_value,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END,
    transition_reason,
    request_value,
    mode_value,
    NEW.state = 'APPROVED' AND NEW.approved_by = NEW.created_by,
    NEW.snapshot_revision,
    CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE jsonb_build_object(
      'state', OLD.state,
      'declaredCashMinor', OLD.declared_cash_minor,
      'expectedCashMinor', OLD.expected_cash_minor,
      'varianceMinor', OLD.variance_minor,
      'snapshotRevision', OLD.snapshot_revision,
      'version', OLD.version
    ) END,
    jsonb_build_object(
      'state', NEW.state,
      'declaredCashMinor', NEW.declared_cash_minor,
      'expectedCashMinor', NEW.expected_cash_minor,
      'varianceMinor', NEW.variance_minor,
      'snapshotRevision', NEW.snapshot_revision,
      'version', NEW.version
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_daily_closings_record_insert
AFTER INSERT ON cash_daily_closings
FOR EACH ROW EXECUTE FUNCTION record_cash_daily_closing_event();

CREATE TRIGGER cash_daily_closings_record_update
AFTER UPDATE ON cash_daily_closings
FOR EACH ROW
WHEN (
  OLD.state IS DISTINCT FROM NEW.state
  OR OLD.declared_cash_minor IS DISTINCT FROM NEW.declared_cash_minor
  OR OLD.variance_reason IS DISTINCT FROM NEW.variance_reason
)
EXECUTE FUNCTION record_cash_daily_closing_event();

CREATE TRIGGER cash_handovers_prevent_mutation
BEFORE UPDATE OR DELETE ON cash_handovers
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER cash_closing_snapshot_items_prevent_mutation
BEFORE UPDATE OR DELETE ON cash_daily_closing_snapshot_items
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER cash_closing_events_prevent_mutation
BEFORE UPDATE OR DELETE ON cash_daily_closing_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER cash_closing_commands_prevent_mutation
BEFORE UPDATE OR DELETE ON cash_daily_closing_commands
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_cash_handover_custody_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  handover cash_handovers%ROWTYPE;
BEGIN
  IF NEW.event_type <> 'HANDOVER_OUT' OR NEW.source_type <> 'CASH_HANDOVER' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT * INTO handover
    FROM cash_handovers
    WHERE id = NEW.source_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'cash handover source_id must be a valid UUID';
  END;

  IF handover.id IS NULL
    OR handover.custody_event_id <> NEW.id
    OR handover.representative_id <> NEW.representative_id
    OR handover.currency_code <> NEW.currency_code
    OR handover.amount_minor <> NEW.amount_minor
    OR handover.received_by <> NEW.received_by
    OR NEW.direction <> 'OUT' THEN
    RAISE EXCEPTION 'cash handover custody event does not match governed handover';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_validate_cash_handover_source
BEFORE INSERT ON representative_cash_custody_events
FOR EACH ROW EXECUTE FUNCTION validate_cash_handover_custody_event();

CREATE OR REPLACE FUNCTION prevent_custody_event_in_locked_closing_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  local_business_date date;
BEGIN
  local_business_date := (NEW.occurred_at AT TIME ZONE 'Asia/Aden')::date;

  IF EXISTS (
    SELECT 1
    FROM cash_daily_closings
    WHERE representative_id = NEW.representative_id
      AND currency_code = NEW.currency_code
      AND business_date = local_business_date
      AND state IN ('PENDING_REVIEW', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'custody date is locked by an active or approved daily closing';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_prevent_locked_closing_date_insert
BEFORE INSERT ON representative_cash_custody_events
FOR EACH ROW EXECUTE FUNCTION prevent_custody_event_in_locked_closing_date();

COMMIT;
