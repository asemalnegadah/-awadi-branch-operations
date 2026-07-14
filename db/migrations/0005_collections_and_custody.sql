BEGIN;

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CHECK', 'OTHER')),
  collected_at timestamptz NOT NULL,
  receipt_number text,
  evidence_document_id uuid,
  evidence_note text,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT', 'SUBMITTED', 'RETURNED', 'REVIEWED', 'CONFLICTED',
    'APPROVED', 'CASH_RECEIVED', 'RECONCILED', 'CLOSED',
    'REJECTED', 'REVERSED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  cash_received_at timestamptz,
  cash_received_by uuid REFERENCES users(id),
  ledger_entry_id uuid UNIQUE REFERENCES customer_ledger_entries(id) ON DELETE RESTRICT,
  reconciled_at timestamptz,
  reconciled_by uuid REFERENCES users(id),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users(id),
  reversal_reason text,
  idempotency_key text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id)
);

CREATE UNIQUE INDEX collections_receipt_unique_active
  ON collections (receipt_number)
  WHERE receipt_number IS NOT NULL AND state NOT IN ('REJECTED', 'REVERSED');

CREATE INDEX collections_rep_state_date_idx
  ON collections (representative_id, state, collected_at);

CREATE INDEX collections_customer_currency_idx
  ON collections (customer_id, currency_code, collected_at);

CREATE TABLE collection_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NOT NULL REFERENCES users(id),
  reason text,
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX collection_state_history_lookup_idx
  ON collection_state_history (collection_id, changed_at);

CREATE TABLE collection_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('INVOICE', 'OPENING_BALANCE', 'OTHER_DEBIT')),
  target_id text NOT NULL,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  allocated_by uuid NOT NULL REFERENCES users(id),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users(id),
  reversal_reason text,
  CONSTRAINT collection_allocation_unique_target UNIQUE (collection_id, target_type, target_id)
);

CREATE TABLE representative_cash_custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  event_type text NOT NULL CHECK (event_type IN ('COLLECTION_IN', 'HANDOVER_OUT', 'REVERSAL')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  received_by uuid REFERENCES users(id),
  source_type text NOT NULL,
  source_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reversal_of_event_id uuid REFERENCES representative_cash_custody_events(id) ON DELETE RESTRICT,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT custody_reversal_shape CHECK (
    (event_type = 'REVERSAL' AND reversal_of_event_id IS NOT NULL AND reason IS NOT NULL)
    OR (event_type <> 'REVERSAL' AND reversal_of_event_id IS NULL)
  ),
  CONSTRAINT custody_handover_receiver CHECK (
    event_type <> 'HANDOVER_OUT' OR received_by IS NOT NULL
  )
);

CREATE UNIQUE INDEX custody_one_reversal_per_event
  ON representative_cash_custody_events (reversal_of_event_id)
  WHERE reversal_of_event_id IS NOT NULL;

CREATE UNIQUE INDEX custody_collection_once
  ON representative_cash_custody_events (source_id)
  WHERE event_type = 'COLLECTION_IN' AND source_type = 'COLLECTION';

CREATE INDEX custody_rep_currency_time_idx
  ON representative_cash_custody_events (representative_id, currency_code, occurred_at);

CREATE OR REPLACE FUNCTION collection_transition_allowed(old_state text, new_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_state
    WHEN 'DRAFT' THEN new_state IN ('SUBMITTED')
    WHEN 'SUBMITTED' THEN new_state IN ('RETURNED', 'REVIEWED', 'CONFLICTED', 'REJECTED')
    WHEN 'RETURNED' THEN new_state IN ('SUBMITTED')
    WHEN 'REVIEWED' THEN new_state IN ('APPROVED', 'CONFLICTED', 'RETURNED', 'REJECTED')
    WHEN 'CONFLICTED' THEN new_state IN ('RETURNED', 'REVIEWED', 'REJECTED')
    WHEN 'APPROVED' THEN new_state IN ('CASH_RECEIVED', 'REVERSED')
    WHEN 'CASH_RECEIVED' THEN new_state IN ('RECONCILED', 'CONFLICTED', 'REVERSED')
    WHEN 'RECONCILED' THEN new_state IN ('CLOSED', 'CONFLICTED', 'REVERSED')
    WHEN 'CLOSED' THEN new_state IN ('REVERSED')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION validate_collection_account()
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
    RAISE EXCEPTION 'customer account does not exist';
  END IF;

  IF account_customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'collection customer does not match customer account';
  END IF;

  IF account_currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'collection currency does not match customer account';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_validate_account
BEFORE INSERT OR UPDATE OF customer_id, customer_account_id, currency_code
ON collections
FOR EACH ROW EXECUTE FUNCTION validate_collection_account();

CREATE OR REPLACE FUNCTION validate_collection_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.customer_id,
    OLD.customer_account_id,
    OLD.representative_id,
    OLD.currency_code,
    OLD.amount_minor,
    OLD.payment_method,
    OLD.collected_at,
    OLD.created_at,
    OLD.created_by,
    OLD.idempotency_key
  ) IS DISTINCT FROM ROW(
    NEW.customer_id,
    NEW.customer_account_id,
    NEW.representative_id,
    NEW.currency_code,
    NEW.amount_minor,
    NEW.payment_method,
    NEW.collected_at,
    NEW.created_at,
    NEW.created_by,
    NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'immutable collection fields cannot be changed';
  END IF;

  IF OLD.state <> NEW.state AND NOT collection_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'invalid collection state transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF NEW.state = 'SUBMITTED' AND NEW.receipt_number IS NULL AND NEW.evidence_document_id IS NULL THEN
    RAISE EXCEPTION 'submitted collection requires receipt or evidence';
  END IF;

  IF NEW.state = 'REVIEWED' AND (NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL) THEN
    RAISE EXCEPTION 'reviewed collection requires reviewer and review time';
  END IF;

  IF NEW.state = 'APPROVED' AND (
    NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'approved collection requires independent approver';
  END IF;

  IF NEW.state = 'CASH_RECEIVED' AND (
    NEW.cash_received_by IS NULL OR NEW.cash_received_at IS NULL OR NEW.cash_received_by = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'cash receipt requires independent receiver';
  END IF;

  IF NEW.state = 'RECONCILED' AND (
    NEW.ledger_entry_id IS NULL OR NEW.reconciled_by IS NULL OR NEW.reconciled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'reconciled collection requires ledger entry and reconciliation actor';
  END IF;

  IF NEW.state = 'CLOSED' AND (NEW.closed_by IS NULL OR NEW.closed_at IS NULL) THEN
    RAISE EXCEPTION 'closed collection requires closer and close time';
  END IF;

  IF NEW.state = 'REVERSED' AND (
    NEW.reversed_by IS NULL OR NEW.reversed_at IS NULL OR NULLIF(trim(NEW.reversal_reason), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'reversed collection requires actor, time, and reason';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_validate_update
BEFORE UPDATE ON collections
FOR EACH ROW EXECUTE FUNCTION validate_collection_update();

CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER collection_history_prevent_update
BEFORE UPDATE OR DELETE ON collection_state_history
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER custody_events_prevent_update
BEFORE UPDATE OR DELETE ON representative_cash_custody_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_custody_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original representative_cash_custody_events%ROWTYPE;
BEGIN
  IF NEW.reversal_of_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original
  FROM representative_cash_custody_events
  WHERE id = NEW.reversal_of_event_id;

  IF original.id IS NULL THEN
    RAISE EXCEPTION 'original custody event does not exist';
  END IF;

  IF original.event_type = 'REVERSAL' THEN
    RAISE EXCEPTION 'a custody reversal cannot be reversed directly';
  END IF;

  IF original.representative_id <> NEW.representative_id
    OR original.currency_code <> NEW.currency_code
    OR original.amount_minor <> NEW.amount_minor
    OR original.direction = NEW.direction THEN
    RAISE EXCEPTION 'custody reversal must be equal and opposite';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_validate_reversal
BEFORE INSERT ON representative_cash_custody_events
FOR EACH ROW EXECUTE FUNCTION validate_custody_reversal();

COMMIT;
