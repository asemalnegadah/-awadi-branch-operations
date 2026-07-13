BEGIN;

CREATE TABLE customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  credit_limit_minor bigint CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  CONSTRAINT customer_accounts_unique_currency UNIQUE (customer_id, currency_code),
  CONSTRAINT customer_accounts_closed_state CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL)
    OR (status <> 'CLOSED' AND closed_at IS NULL)
  )
);

CREATE TABLE customer_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  entry_type text NOT NULL CHECK (entry_type IN (
    'OPENING_BALANCE',
    'INVOICE',
    'COLLECTION',
    'CREDIT_NOTE',
    'RETURN',
    'APPROVED_DISCOUNT',
    'RECONCILIATION_ADJUSTMENT',
    'REVERSAL'
  )),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  accounting_date date NOT NULL,
  description text,
  source_type text NOT NULL,
  source_id text NOT NULL,
  idempotency_key text NOT NULL,
  reversal_of_entry_id uuid REFERENCES customer_ledger_entries(id) ON DELETE RESTRICT,
  posted_at timestamptz NOT NULL,
  posted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ledger_reversal_shape CHECK (
    (entry_type = 'REVERSAL' AND reversal_of_entry_id IS NOT NULL)
    OR (entry_type <> 'REVERSAL' AND reversal_of_entry_id IS NULL)
  ),
  CONSTRAINT ledger_not_self_reversal CHECK (
    reversal_of_entry_id IS NULL OR reversal_of_entry_id <> id
  ),
  CONSTRAINT ledger_idempotency_unique UNIQUE (source_type, idempotency_key)
);

CREATE UNIQUE INDEX ledger_one_reversal_per_entry
  ON customer_ledger_entries (reversal_of_entry_id)
  WHERE reversal_of_entry_id IS NOT NULL;

CREATE INDEX ledger_customer_account_date_idx
  ON customer_ledger_entries (customer_account_id, accounting_date, posted_at);

CREATE INDEX ledger_customer_currency_idx
  ON customer_ledger_entries (customer_id, currency_code, accounting_date);

CREATE INDEX ledger_source_idx
  ON customer_ledger_entries (source_type, source_id);

CREATE OR REPLACE FUNCTION validate_ledger_account_currency()
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
    RAISE EXCEPTION 'ledger customer does not match account customer';
  END IF;

  IF account_currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'ledger currency does not match account currency';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_validate_account_currency
BEFORE INSERT ON customer_ledger_entries
FOR EACH ROW EXECUTE FUNCTION validate_ledger_account_currency();

CREATE OR REPLACE FUNCTION validate_ledger_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original_record customer_ledger_entries%ROWTYPE;
BEGIN
  IF NEW.reversal_of_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original_record
  FROM customer_ledger_entries
  WHERE id = NEW.reversal_of_entry_id;

  IF original_record.id IS NULL THEN
    RAISE EXCEPTION 'original ledger entry does not exist';
  END IF;

  IF original_record.entry_type = 'REVERSAL' THEN
    RAISE EXCEPTION 'a reversal entry cannot be reversed directly';
  END IF;

  IF original_record.customer_account_id <> NEW.customer_account_id
    OR original_record.customer_id <> NEW.customer_id
    OR original_record.currency_code <> NEW.currency_code
    OR original_record.amount_minor <> NEW.amount_minor
    OR original_record.direction = NEW.direction THEN
    RAISE EXCEPTION 'reversal entry must be equal and opposite to original entry';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_validate_reversal
BEFORE INSERT ON customer_ledger_entries
FOR EACH ROW EXECUTE FUNCTION validate_ledger_reversal();

CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer_ledger_entries is append-only';
END;
$$;

CREATE TRIGGER ledger_prevent_update
BEFORE UPDATE ON customer_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

CREATE TRIGGER ledger_prevent_delete
BEFORE DELETE ON customer_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

COMMIT;
