BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('reconciliations.read', 'reconciliations', 'read', 'قراءة المطابقات والفروقات'),
  ('reconciliations.create', 'reconciliations', 'create', 'إنشاء مطابقة مالية'),
  ('reconciliations.review', 'reconciliations', 'review', 'مراجعة وتصنيف فروقات المطابقة'),
  ('reconciliations.approve', 'reconciliations', 'approve', 'اعتماد المطابقات'),
  ('reconciliations.settle', 'reconciliations', 'settle', 'تسوية فروقات المطابقة المعتمدة'),
  ('reconciliations.view_history', 'reconciliations', 'view_history', 'عرض سجل المطابقة غير القابل للتعديل')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.code = ANY (
  CASE role.code
    WHEN 'BRANCH_MANAGER' THEN ARRAY[
      'reconciliations.read', 'reconciliations.create', 'reconciliations.review',
      'reconciliations.approve', 'reconciliations.settle', 'reconciliations.view_history'
    ]::text[]
    WHEN 'ACCOUNTING_CASHIER' THEN ARRAY[
      'reconciliations.read', 'reconciliations.create', 'reconciliations.review',
      'reconciliations.settle', 'reconciliations.view_history'
    ]::text[]
    WHEN 'AUDITOR' THEN ARRAY[
      'reconciliations.read', 'reconciliations.review',
      'reconciliations.approve', 'reconciliations.view_history'
    ]::text[]
    WHEN 'OWNER_AUDITOR' THEN ARRAY[
      'reconciliations.read', 'reconciliations.approve', 'reconciliations.view_history'
    ]::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE role.code IN ('BRANCH_MANAGER', 'ACCOUNTING_CASHIER', 'AUDITOR', 'OWNER_AUDITOR')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN (
    'LEDGER_TO_STATEMENT', 'COLLECTION_TO_LEDGER',
    'IMPORT_TO_LEDGER', 'CUSTODY_TO_COLLECTION'
  )),
  source_type text NOT NULL CHECK (length(btrim(source_type)) BETWEEN 1 AND 80),
  source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 160),
  cutoff_date date NOT NULL,
  expected_amount_minor bigint NOT NULL,
  observed_amount_minor bigint NOT NULL,
  difference_amount_minor bigint GENERATED ALWAYS AS (
    observed_amount_minor - expected_amount_minor
  ) STORED,
  reason_code text CHECK (reason_code IS NULL OR reason_code IN (
    'TIMING_DIFFERENCE', 'MISSING_COLLECTION', 'UNPOSTED_INVOICE',
    'DUPLICATE_ENTRY', 'WRONG_ACCOUNT', 'WRONG_CURRENCY', 'WRONG_AMOUNT',
    'UNALLOCATED_COLLECTION', 'IMPORT_VARIANCE', 'CUSTODY_VARIANCE',
    'MANUAL_ERROR', 'OTHER'
  )),
  reason_text text,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'PENDING_APPROVAL',
    'APPROVED', 'RETURNED', 'REJECTED', 'MATCHED', 'SETTLED'
  )),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  rejection_reason text,
  returned_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  returned_at timestamptz,
  return_reason text,
  settled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  settled_at timestamptz,
  settlement_ledger_entry_id uuid UNIQUE REFERENCES customer_ledger_entries(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  create_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_reason_text_shape CHECK (
    reason_text IS NULL OR length(btrim(reason_text)) BETWEEN 3 AND 2000
  ),
  CONSTRAINT reconciliation_terminal_actor_shape CHECK (
    (state <> 'REJECTED' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND NULLIF(btrim(rejection_reason), '') IS NOT NULL))
    AND (state <> 'RETURNED' OR (returned_by IS NOT NULL AND returned_at IS NOT NULL AND NULLIF(btrim(return_reason), '') IS NOT NULL))
    AND (state <> 'SETTLED' OR (settled_by IS NOT NULL AND settled_at IS NOT NULL AND settlement_ledger_entry_id IS NOT NULL))
  ),
  CONSTRAINT reconciliation_source_unique UNIQUE (
    source_kind, source_type, source_id, customer_account_id, cutoff_date
  )
);

CREATE INDEX reconciliation_cases_state_cutoff_idx
  ON reconciliation_cases (state, cutoff_date DESC, created_at DESC, id DESC);
CREATE INDEX reconciliation_cases_account_idx
  ON reconciliation_cases (customer_account_id, created_at DESC);
CREATE INDEX reconciliation_cases_currency_state_idx
  ON reconciliation_cases (currency_code, state, created_at DESC);

CREATE TABLE reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliation_cases(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'SUBMITTED', 'REVIEWED', 'PENDING_APPROVAL',
    'APPROVED', 'RETURNED', 'REJECTED', 'MATCHED', 'SETTLED'
  )),
  from_state text,
  to_state text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  request_id uuid NOT NULL,
  operating_mode text NOT NULL CHECK (operating_mode IN ('SINGLE_MANAGER', 'MULTI_USER')),
  self_approved boolean NOT NULL DEFAULT false,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX reconciliation_events_lookup_idx
  ON reconciliation_events (reconciliation_id, occurred_at, id);

CREATE TABLE reconciliation_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES reconciliation_cases(id) ON DELETE RESTRICT,
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES customer_ledger_entries(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  settled_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settled_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION reconciliation_transition_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_state
    WHEN 'DRAFT' THEN new_state IN ('PENDING_REVIEW', 'MATCHED')
    WHEN 'RETURNED' THEN new_state = 'PENDING_REVIEW'
    WHEN 'PENDING_REVIEW' THEN new_state IN ('REVIEWED', 'RETURNED', 'REJECTED')
    WHEN 'REVIEWED' THEN new_state = 'PENDING_APPROVAL'
    WHEN 'PENDING_APPROVAL' THEN new_state IN ('APPROVED', 'RETURNED', 'REJECTED')
    WHEN 'APPROVED' THEN new_state = 'SETTLED'
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION validate_reconciliation_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_customer_id uuid;
  account_currency_code text;
BEGIN
  SELECT customer_id, currency_code
  INTO account_customer_id, account_currency_code
  FROM customer_accounts
  WHERE id = NEW.customer_account_id;

  IF account_customer_id IS NULL THEN
    RAISE EXCEPTION 'reconciliation customer account does not exist';
  END IF;
  IF account_customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'reconciliation customer does not match customer account';
  END IF;
  IF account_currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'reconciliation currency does not match customer account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_validate_account
BEFORE INSERT OR UPDATE OF customer_id, customer_account_id, currency_code
ON reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION validate_reconciliation_account();

CREATE OR REPLACE FUNCTION derive_reconciliation_create_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.create_payload := jsonb_build_object(
    'customerAccountId', NEW.customer_account_id,
    'sourceKind', NEW.source_kind,
    'sourceType', NEW.source_type,
    'sourceId', NEW.source_id,
    'cutoffDate', NEW.cutoff_date,
    'expectedAmountMinor', NEW.expected_amount_minor,
    'observedAmountMinor', NEW.observed_amount_minor,
    'reasonCode', NEW.reason_code,
    'reasonText', NEW.reason_text,
    'createdBy', NEW.created_by
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_derive_create_payload
BEFORE INSERT ON reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION derive_reconciliation_create_payload();

CREATE OR REPLACE FUNCTION validate_reconciliation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_entry customer_ledger_entries%ROWTYPE;
  derived_difference bigint;
BEGIN
  derived_difference := NEW.observed_amount_minor - NEW.expected_amount_minor;
  IF ROW(OLD.id, OLD.created_by, OLD.created_at, OLD.idempotency_key, OLD.create_payload)
    IS DISTINCT FROM
    ROW(NEW.id, NEW.created_by, NEW.created_at, NEW.idempotency_key, NEW.create_payload) THEN
    RAISE EXCEPTION 'reconciliation identity and create payload are immutable';
  END IF;

  IF OLD.state <> 'DRAFT' OR NEW.state <> OLD.state THEN
    IF ROW(
      OLD.customer_id, OLD.customer_account_id, OLD.currency_code,
      OLD.source_kind, OLD.source_type, OLD.source_id, OLD.cutoff_date,
      OLD.expected_amount_minor, OLD.observed_amount_minor
    ) IS DISTINCT FROM ROW(
      NEW.customer_id, NEW.customer_account_id, NEW.currency_code,
      NEW.source_kind, NEW.source_type, NEW.source_id, NEW.cutoff_date,
      NEW.expected_amount_minor, NEW.observed_amount_minor
    ) THEN
      RAISE EXCEPTION 'reconciliation financial and source fields are frozen after draft';
    END IF;
  END IF;

  IF OLD.state <> NEW.state AND NOT reconciliation_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'invalid reconciliation transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF NEW.state = 'MATCHED' AND derived_difference <> 0 THEN
    RAISE EXCEPTION 'only a zero difference can be marked matched';
  END IF;
  IF NEW.state IN ('PENDING_REVIEW', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED', 'SETTLED')
    AND derived_difference = 0 THEN
    RAISE EXCEPTION 'zero difference reconciliation must be marked matched';
  END IF;
  IF NEW.state IN ('REVIEWED', 'PENDING_APPROVAL', 'APPROVED', 'SETTLED')
    AND (NEW.reason_code IS NULL OR NULLIF(btrim(NEW.reason_text), '') IS NULL) THEN
    RAISE EXCEPTION 'reviewed reconciliation requires a classified reason';
  END IF;

  IF NEW.state = 'PENDING_REVIEW' AND (NEW.submitted_by IS NULL OR NEW.submitted_at IS NULL) THEN
    RAISE EXCEPTION 'submitted reconciliation requires submitter and timestamp';
  END IF;
  IF NEW.state = 'REVIEWED' AND (
    NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
    OR (NEW.reviewed_by = NEW.created_by AND NOT is_single_manager_actor(NEW.reviewed_by))
  ) THEN
    RAISE EXCEPTION 'review requires an independent reviewer outside single-manager mode';
  END IF;
  IF NEW.state = 'APPROVED' AND (
    NEW.approved_by IS NULL OR NEW.approved_at IS NULL
    OR (
      (NEW.approved_by = NEW.created_by OR NEW.approved_by = NEW.reviewed_by)
      AND NOT is_single_manager_actor(NEW.approved_by)
    )
  ) THEN
    RAISE EXCEPTION 'approval requires an independent approver outside single-manager mode';
  END IF;

  IF NEW.settlement_ledger_entry_id IS DISTINCT FROM OLD.settlement_ledger_entry_id THEN
    IF OLD.settlement_ledger_entry_id IS NOT NULL OR NEW.state <> 'SETTLED' THEN
      RAISE EXCEPTION 'settlement ledger entry can only be linked once during settlement';
    END IF;
    SELECT * INTO linked_entry
    FROM customer_ledger_entries
    WHERE id = NEW.settlement_ledger_entry_id;
    IF linked_entry.id IS NULL THEN
      RAISE EXCEPTION 'settlement ledger entry does not exist';
    END IF;
    IF linked_entry.entry_type <> 'RECONCILIATION_ADJUSTMENT'
      OR linked_entry.customer_id <> NEW.customer_id
      OR linked_entry.customer_account_id <> NEW.customer_account_id
      OR linked_entry.currency_code <> NEW.currency_code
      OR linked_entry.amount_minor <> abs(derived_difference)
      OR linked_entry.direction <> (CASE WHEN derived_difference > 0 THEN 'DEBIT' ELSE 'CREDIT' END)
      OR linked_entry.source_type <> 'RECONCILIATION'
      OR linked_entry.source_id <> NEW.id::text THEN
      RAISE EXCEPTION 'settlement ledger entry does not match reconciliation';
    END IF;
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_validate_update
BEFORE UPDATE ON reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION validate_reconciliation_update();

CREATE OR REPLACE FUNCTION record_reconciliation_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_setting text;
  request_value uuid := gen_random_uuid();
  transition_reason text;
  current_operating_mode text;
  actor_id uuid;
BEGIN
  request_setting := NULLIF(btrim(current_setting('app.request_id', true)), '');
  IF request_setting IS NOT NULL THEN
    BEGIN
      request_value := request_setting::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'app.request_id must be a valid UUID';
    END;
  END IF;
  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');
  SELECT operating_mode INTO current_operating_mode
  FROM organization_settings WHERE singleton_id = 1;
  actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END;

  IF TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state THEN
    INSERT INTO reconciliation_events (
      reconciliation_id, event_type, from_state, to_state, actor_user_id,
      occurred_at, reason, request_id, operating_mode, self_approved,
      old_values, new_values
    ) VALUES (
      NEW.id,
      CASE NEW.state
        WHEN 'DRAFT' THEN 'CREATED'
        WHEN 'PENDING_REVIEW' THEN 'SUBMITTED'
        ELSE NEW.state
      END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
      NEW.state,
      actor_id,
      now(),
      transition_reason,
      request_value,
      current_operating_mode,
      actor_id = NEW.created_by AND NEW.state IN ('REVIEWED', 'APPROVED', 'SETTLED'),
      CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE jsonb_build_object('state', OLD.state, 'version', OLD.version) END,
      jsonb_build_object('state', NEW.state, 'version', NEW.version, 'differenceAmountMinor', NEW.difference_amount_minor)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_record_event
AFTER INSERT OR UPDATE ON reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION record_reconciliation_event();

CREATE OR REPLACE FUNCTION validate_reconciliation_settlement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reconciliation reconciliation_cases%ROWTYPE;
  linked_entry customer_ledger_entries%ROWTYPE;
BEGIN
  SELECT * INTO reconciliation
  FROM reconciliation_cases
  WHERE id = NEW.reconciliation_id
  FOR SHARE;
  IF reconciliation.id IS NULL OR reconciliation.state <> 'APPROVED' THEN
    RAISE EXCEPTION 'only an approved reconciliation can be settled';
  END IF;
  IF reconciliation.difference_amount_minor = 0 THEN
    RAISE EXCEPTION 'zero difference reconciliation cannot be settled';
  END IF;
  IF NEW.direction <> (CASE WHEN reconciliation.difference_amount_minor > 0 THEN 'DEBIT' ELSE 'CREDIT' END)
    OR NEW.amount_minor <> abs(reconciliation.difference_amount_minor) THEN
    RAISE EXCEPTION 'settlement amount and direction must match reconciliation difference';
  END IF;
  SELECT * INTO linked_entry FROM customer_ledger_entries WHERE id = NEW.ledger_entry_id;
  IF linked_entry.id IS NULL
    OR linked_entry.entry_type <> 'RECONCILIATION_ADJUSTMENT'
    OR linked_entry.customer_id <> reconciliation.customer_id
    OR linked_entry.customer_account_id <> reconciliation.customer_account_id
    OR linked_entry.currency_code <> reconciliation.currency_code
    OR linked_entry.direction <> NEW.direction
    OR linked_entry.amount_minor <> NEW.amount_minor
    OR linked_entry.source_type <> 'RECONCILIATION'
    OR linked_entry.source_id <> reconciliation.id::text THEN
    RAISE EXCEPTION 'settlement ledger entry is inconsistent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_validate_settlement
BEFORE INSERT ON reconciliation_settlements
FOR EACH ROW EXECUTE FUNCTION validate_reconciliation_settlement();

CREATE OR REPLACE FUNCTION prevent_reconciliation_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER reconciliation_events_immutable
BEFORE UPDATE OR DELETE ON reconciliation_events
FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_append_only_mutation();
CREATE TRIGGER reconciliation_settlements_immutable
BEFORE UPDATE OR DELETE ON reconciliation_settlements
FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_append_only_mutation();
CREATE TRIGGER reconciliation_cases_no_delete
BEFORE DELETE ON reconciliation_cases
FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_append_only_mutation();

CREATE VIEW current_unresolved_reconciliations AS
SELECT
  reconciliation.id,
  reconciliation.customer_id,
  reconciliation.customer_account_id,
  reconciliation.currency_code,
  reconciliation.difference_amount_minor,
  reconciliation.reason_code,
  reconciliation.state,
  reconciliation.cutoff_date,
  reconciliation.created_at
FROM reconciliation_cases AS reconciliation
WHERE reconciliation.state NOT IN ('MATCHED', 'REJECTED', 'SETTLED');

COMMIT;
