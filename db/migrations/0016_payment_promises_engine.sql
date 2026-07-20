BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('promises.read', 'promises', 'read', 'عرض وعود السداد ضمن فرع عدن.'),
  ('promises.create', 'promises', 'create', 'إنشاء وعد سداد.'),
  ('promises.update', 'promises', 'update', 'تحديث بيانات وعد سداد مفتوح.'),
  ('promises.follow_up', 'promises', 'follow_up', 'إضافة متابعة لوعد سداد.'),
  ('promises.reject', 'promises', 'reject', 'رفض وعد سداد غير منفذ.'),
  ('promises.cancel', 'promises', 'cancel', 'إلغاء وعد سداد غير منفذ.'),
  ('promises.allocate_collection', 'promises', 'allocate_collection', 'ربط تحصيل مؤكد بوعد سداد.'),
  ('promises.reverse_allocation', 'promises', 'reverse_allocation', 'عكس ربط تحصيل بوعد سداد.'),
  ('promises.escalate', 'promises', 'escalate', 'تصعيد وعد سداد.'),
  ('promises.view_history', 'promises', 'view_history', 'عرض سجل أحداث وعد السداد.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.resource = 'promises'
WHERE role.code = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN ('promises.read', 'promises.view_history')
WHERE role.code IN ('OWNER_AUDITOR', 'AUDITOR', 'SYSTEM_ADMIN')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN (
    'promises.read',
    'promises.allocate_collection',
    'promises.reverse_allocation',
    'promises.view_history'
  )
WHERE role.code = 'ACCOUNTING_CASHIER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN (
    'promises.read',
    'promises.create',
    'promises.update',
    'promises.follow_up',
    'promises.view_history'
  )
WHERE role.code = 'SALES_REP'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE payment_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IN ('SR', 'RG')),
  promised_amount_minor bigint NOT NULL CHECK (promised_amount_minor > 0),
  fulfilled_amount_minor bigint NOT NULL DEFAULT 0 CHECK (fulfilled_amount_minor >= 0),
  remaining_amount_minor bigint GENERATED ALWAYS AS (
    promised_amount_minor - fulfilled_amount_minor
  ) STORED,
  promise_date date NOT NULL,
  due_date date NOT NULL,
  next_follow_up_at timestamptz,
  debt_reason text NOT NULL CHECK (NULLIF(btrim(debt_reason), '') IS NOT NULL),
  delay_reason text,
  notes text,
  base_status text NOT NULL DEFAULT 'NEW' CHECK (base_status IN (
    'NEW',
    'UPCOMING',
    'PARTIALLY_FULFILLED',
    'FULFILLED',
    'REJECTED',
    'CANCELLED'
  )),
  escalation_level smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 5),
  rejected_at timestamptz,
  rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejection_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancellation_reason text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL UNIQUE,
  CONSTRAINT payment_promises_due_after_promise
    CHECK (due_date >= promise_date),
  CONSTRAINT payment_promises_fulfilled_within_amount
    CHECK (fulfilled_amount_minor <= promised_amount_minor),
  CONSTRAINT payment_promises_idempotency_key_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT payment_promises_status_amount_shape CHECK (
    (base_status IN ('NEW', 'UPCOMING') AND fulfilled_amount_minor = 0)
    OR
    (base_status = 'PARTIALLY_FULFILLED'
      AND fulfilled_amount_minor > 0
      AND fulfilled_amount_minor < promised_amount_minor)
    OR
    (base_status = 'FULFILLED'
      AND fulfilled_amount_minor = promised_amount_minor)
    OR
    (base_status IN ('REJECTED', 'CANCELLED')
      AND fulfilled_amount_minor = 0)
  ),
  CONSTRAINT payment_promises_rejection_shape CHECK (
    (
      base_status = 'REJECTED'
      AND rejected_at IS NOT NULL
      AND rejected_by IS NOT NULL
      AND NULLIF(btrim(rejection_reason), '') IS NOT NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancellation_reason IS NULL
    )
    OR
    (
      base_status <> 'REJECTED'
      AND rejected_at IS NULL
      AND rejected_by IS NULL
      AND rejection_reason IS NULL
    )
  ),
  CONSTRAINT payment_promises_cancellation_shape CHECK (
    (
      base_status = 'CANCELLED'
      AND cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND NULLIF(btrim(cancellation_reason), '') IS NOT NULL
      AND rejected_at IS NULL
      AND rejected_by IS NULL
      AND rejection_reason IS NULL
    )
    OR
    (
      base_status <> 'CANCELLED'
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancellation_reason IS NULL
    )
  ),
  CONSTRAINT payment_promises_terminal_followup_clear CHECK (
    base_status NOT IN ('FULFILLED', 'REJECTED', 'CANCELLED')
    OR next_follow_up_at IS NULL
  )
);

CREATE INDEX payment_promises_due_queue_idx
  ON payment_promises (base_status, due_date, created_at, id);

CREATE INDEX payment_promises_customer_currency_idx
  ON payment_promises (customer_id, currency_code, due_date, id);

CREATE INDEX payment_promises_representative_queue_idx
  ON payment_promises (representative_id, base_status, due_date, id);

CREATE INDEX payment_promises_escalation_queue_idx
  ON payment_promises (escalation_level DESC, due_date, id)
  WHERE base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED');

CREATE TABLE payment_promise_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id uuid NOT NULL REFERENCES payment_promises(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED',
    'UPDATED',
    'FOLLOW_UP_ADDED',
    'ASSIGNED',
    'DUE_DATE_CHANGED',
    'AMOUNT_CHANGED',
    'COLLECTION_ALLOCATED',
    'COLLECTION_REVERSED',
    'PARTIALLY_FULFILLED',
    'FULFILLED',
    'REJECTED',
    'CANCELLED',
    'ESCALATED',
    'REOPENED'
  )),
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  operation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  source_entity text,
  source_id text,
  idempotency_key text,
  CONSTRAINT payment_promise_events_source_shape CHECK (
    (source_entity IS NULL AND source_id IS NULL)
    OR
    (NULLIF(btrim(source_entity), '') IS NOT NULL
      AND NULLIF(btrim(source_id), '') IS NOT NULL)
  ),
  CONSTRAINT payment_promise_events_idempotency_nonempty CHECK (
    idempotency_key IS NULL OR NULLIF(btrim(idempotency_key), '') IS NOT NULL
  )
);

CREATE INDEX payment_promise_events_history_idx
  ON payment_promise_events (promise_id, occurred_at, id);

CREATE UNIQUE INDEX payment_promise_events_idempotency_uidx
  ON payment_promise_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE payment_promise_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id uuid NOT NULL REFERENCES payment_promises(id) ON DELETE RESTRICT,
  scheduled_at timestamptz NOT NULL,
  completed_at timestamptz,
  outcome text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  CONSTRAINT payment_promise_followups_time_order CHECK (
    completed_at IS NULL OR completed_at >= scheduled_at
  ),
  CONSTRAINT payment_promise_followups_completion_shape CHECK (
    (completed_at IS NULL AND outcome IS NULL)
    OR
    (completed_at IS NOT NULL AND NULLIF(btrim(outcome), '') IS NOT NULL)
  ),
  CONSTRAINT payment_promise_followups_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX payment_promise_followups_schedule_idx
  ON payment_promise_followups (promise_id, scheduled_at, id);

CREATE INDEX payment_promise_followups_open_schedule_idx
  ON payment_promise_followups (scheduled_at, promise_id)
  WHERE completed_at IS NULL;

CREATE TABLE payment_promise_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promise_id uuid NOT NULL REFERENCES payment_promises(id) ON DELETE RESTRICT,
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IN ('SR', 'RG')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  allocated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reversal_reason text,
  reversal_request_id uuid,
  reversal_idempotency_key text,
  CONSTRAINT payment_promise_allocations_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT payment_promise_allocations_reversal_shape CHECK (
    (
      reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND reversal_request_id IS NULL
      AND reversal_idempotency_key IS NULL
    )
    OR
    (
      reversed_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND NULLIF(btrim(reversal_reason), '') IS NOT NULL
      AND reversal_request_id IS NOT NULL
      AND NULLIF(btrim(reversal_idempotency_key), '') IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX payment_promise_allocations_active_pair_uidx
  ON payment_promise_allocations (promise_id, collection_id)
  WHERE reversed_at IS NULL;

CREATE UNIQUE INDEX payment_promise_allocations_reversal_idempotency_uidx
  ON payment_promise_allocations (reversal_idempotency_key)
  WHERE reversal_idempotency_key IS NOT NULL;

CREATE INDEX payment_promise_allocations_promise_idx
  ON payment_promise_allocations (promise_id, allocated_at, id);

CREATE INDEX payment_promise_allocations_collection_idx
  ON payment_promise_allocations (collection_id, allocated_at, id)
  WHERE reversed_at IS NULL;

CREATE OR REPLACE FUNCTION payment_promise_open_status(target_due_date date)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN target_due_date > (now() AT TIME ZONE 'Asia/Aden')::date THEN 'UPCOMING'
    ELSE 'NEW'
  END;
$$;

CREATE OR REPLACE FUNCTION prevent_payment_promise_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION validate_payment_promise_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_customer_id uuid;
  account_currency_code text;
  active_allocation_total bigint;
  financial_write_setting text;
BEGIN
  SELECT account.customer_id, account.currency_code
  INTO account_customer_id, account_currency_code
  FROM customer_accounts AS account
  JOIN customers AS customer ON customer.id = account.customer_id
  WHERE account.id = NEW.customer_account_id
    AND account.status = 'ACTIVE'
    AND account.closed_at IS NULL
    AND customer.deleted_at IS NULL
    AND customer.merged_into_customer_id IS NULL;

  IF account_customer_id IS NULL THEN
    RAISE EXCEPTION 'promise customer account is unavailable';
  END IF;

  IF account_customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'promise customer does not match customer account';
  END IF;

  IF account_currency_code <> NEW.currency_code THEN
    RAISE EXCEPTION 'promise currency does not match customer account';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sales_representatives AS representative
    WHERE representative.id = NEW.representative_id
      AND representative.status = 'ACTIVE'
      AND representative.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'promise representative is unavailable';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.fulfilled_amount_minor <> 0 THEN
      RAISE EXCEPTION 'fulfilled amount cannot be set when creating a promise';
    END IF;

    IF NEW.base_status NOT IN ('NEW', 'UPCOMING') THEN
      RAISE EXCEPTION 'new promise must use an open base status';
    END IF;

    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;

  IF ROW(
    OLD.id,
    OLD.customer_id,
    OLD.customer_account_id,
    OLD.currency_code,
    OLD.created_by,
    OLD.created_at,
    OLD.idempotency_key
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.customer_id,
    NEW.customer_account_id,
    NEW.currency_code,
    NEW.created_by,
    NEW.created_at,
    NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'promise identity, customer, currency, and creation fields are immutable';
  END IF;

  financial_write_setting := NULLIF(
    btrim(current_setting('app.promise_financial_write', true)),
    ''
  );

  IF NEW.fulfilled_amount_minor IS DISTINCT FROM OLD.fulfilled_amount_minor
    AND financial_write_setting IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'fulfilled amount is managed only by collection allocations';
  END IF;

  SELECT COALESCE(SUM(allocation.amount_minor), 0)
  INTO active_allocation_total
  FROM payment_promise_allocations AS allocation
  WHERE allocation.promise_id = NEW.id
    AND allocation.reversed_at IS NULL;

  IF NEW.fulfilled_amount_minor <> active_allocation_total THEN
    RAISE EXCEPTION 'fulfilled amount must equal active promise allocations';
  END IF;

  IF OLD.base_status IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'rejected or cancelled promise cannot be modified';
  END IF;

  IF OLD.base_status = 'FULFILLED'
    AND financial_write_setting IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'fulfilled promise can only be reopened by allocation reversal';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_promises_validate
BEFORE INSERT OR UPDATE ON payment_promises
FOR EACH ROW EXECUTE FUNCTION validate_payment_promise_record();

CREATE TRIGGER payment_promises_prevent_delete
BEFORE DELETE ON payment_promises
FOR EACH ROW EXECUTE FUNCTION prevent_payment_promise_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_payment_promise_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  promise_record payment_promises%ROWTYPE;
  collection_record collections%ROWTYPE;
  promise_active_total bigint;
  collection_active_total bigint;
BEGIN
  SELECT * INTO promise_record
  FROM payment_promises
  WHERE id = NEW.promise_id
  FOR UPDATE;

  IF promise_record.id IS NULL THEN
    RAISE EXCEPTION 'payment promise does not exist';
  END IF;

  SELECT * INTO collection_record
  FROM collections
  WHERE id = NEW.collection_id
  FOR UPDATE;

  IF collection_record.id IS NULL THEN
    RAISE EXCEPTION 'collection does not exist';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF promise_record.base_status NOT IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED') THEN
      RAISE EXCEPTION 'promise status does not allow collection allocation';
    END IF;

    IF collection_record.state NOT IN ('RECONCILED', 'CLOSED')
      OR collection_record.ledger_entry_id IS NULL
      OR collection_record.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'collection is not financially confirmed';
    END IF;

  ELSE
    IF ROW(
      OLD.id,
      OLD.promise_id,
      OLD.collection_id,
      OLD.currency_code,
      OLD.amount_minor,
      OLD.allocated_at,
      OLD.allocated_by,
      OLD.request_id,
      OLD.idempotency_key
    ) IS DISTINCT FROM ROW(
      NEW.id,
      NEW.promise_id,
      NEW.collection_id,
      NEW.currency_code,
      NEW.amount_minor,
      NEW.allocated_at,
      NEW.allocated_by,
      NEW.request_id,
      NEW.idempotency_key
    ) THEN
      RAISE EXCEPTION 'promise allocation core fields are immutable';
    END IF;

    IF OLD.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'reversed promise allocation cannot be modified';
    END IF;

    IF NEW.reversed_at IS NULL
      OR NEW.reversed_by IS NULL
      OR NULLIF(btrim(NEW.reversal_reason), '') IS NULL
      OR NEW.reversal_request_id IS NULL
      OR NULLIF(btrim(NEW.reversal_idempotency_key), '') IS NULL THEN
      RAISE EXCEPTION 'allocation update must be a complete documented reversal';
    END IF;
  END IF;

  IF promise_record.customer_id <> collection_record.customer_id
    OR promise_record.customer_account_id <> collection_record.customer_account_id THEN
    RAISE EXCEPTION 'collection customer account does not match promise';
  END IF;

  IF NEW.currency_code <> promise_record.currency_code
    OR NEW.currency_code <> collection_record.currency_code THEN
    RAISE EXCEPTION 'allocation currency does not match promise and collection';
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0)
  INTO promise_active_total
  FROM payment_promise_allocations
  WHERE promise_id = NEW.promise_id
    AND reversed_at IS NULL
    AND id <> NEW.id;

  SELECT COALESCE(SUM(amount_minor), 0)
  INTO collection_active_total
  FROM payment_promise_allocations
  WHERE collection_id = NEW.collection_id
    AND reversed_at IS NULL
    AND id <> NEW.id;

  IF NEW.reversed_at IS NULL THEN
    promise_active_total := promise_active_total + NEW.amount_minor;
    collection_active_total := collection_active_total + NEW.amount_minor;
  END IF;

  IF promise_active_total > promise_record.promised_amount_minor THEN
    RAISE EXCEPTION 'active promise allocations exceed promised amount';
  END IF;

  IF collection_active_total > collection_record.amount_minor THEN
    RAISE EXCEPTION 'active promise allocations exceed collection amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_promise_allocations_validate
BEFORE INSERT OR UPDATE ON payment_promise_allocations
FOR EACH ROW EXECUTE FUNCTION validate_payment_promise_allocation();

CREATE TRIGGER payment_promise_allocations_prevent_delete
BEFORE DELETE ON payment_promise_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_payment_promise_append_only_mutation();

CREATE OR REPLACE FUNCTION synchronize_payment_promise_financial_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_total bigint;
  target_status text;
  actor_id uuid;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0)
  INTO active_total
  FROM payment_promise_allocations
  WHERE promise_id = NEW.promise_id
    AND reversed_at IS NULL;

  SELECT CASE
    WHEN active_total = 0 THEN payment_promise_open_status(due_date)
    WHEN active_total < promised_amount_minor THEN 'PARTIALLY_FULFILLED'
    ELSE 'FULFILLED'
  END
  INTO target_status
  FROM payment_promises
  WHERE id = NEW.promise_id
  FOR UPDATE;

  actor_id := COALESCE(NEW.reversed_by, NEW.allocated_by);

  PERFORM set_config('app.promise_financial_write', NEW.promise_id::text, true);

  UPDATE payment_promises
  SET fulfilled_amount_minor = active_total,
      base_status = target_status,
      next_follow_up_at = CASE
        WHEN target_status = 'FULFILLED' THEN NULL
        ELSE next_follow_up_at
      END,
      updated_by = actor_id
  WHERE id = NEW.promise_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_promise_allocations_sync_totals
AFTER INSERT OR UPDATE OF reversed_at ON payment_promise_allocations
FOR EACH ROW EXECUTE FUNCTION synchronize_payment_promise_financial_totals();

CREATE OR REPLACE FUNCTION validate_payment_promise_followup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  promise_status text;
BEGIN
  SELECT base_status INTO promise_status
  FROM payment_promises
  WHERE id = NEW.promise_id
  FOR UPDATE;

  IF promise_status IS NULL THEN
    RAISE EXCEPTION 'payment promise does not exist';
  END IF;

  IF promise_status NOT IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED') THEN
    RAISE EXCEPTION 'promise status does not allow follow-up';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_promise_followups_validate
BEFORE INSERT ON payment_promise_followups
FOR EACH ROW EXECUTE FUNCTION validate_payment_promise_followup();

CREATE TRIGGER payment_promise_followups_prevent_update
BEFORE UPDATE ON payment_promise_followups
FOR EACH ROW EXECUTE FUNCTION prevent_payment_promise_append_only_mutation();

CREATE TRIGGER payment_promise_followups_prevent_delete
BEFORE DELETE ON payment_promise_followups
FOR EACH ROW EXECUTE FUNCTION prevent_payment_promise_append_only_mutation();

CREATE OR REPLACE FUNCTION synchronize_payment_promise_next_followup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_open_followup timestamptz;
BEGIN
  SELECT MIN(scheduled_at)
  INTO next_open_followup
  FROM payment_promise_followups
  WHERE promise_id = NEW.promise_id
    AND completed_at IS NULL;

  UPDATE payment_promises
  SET next_follow_up_at = next_open_followup,
      updated_by = NEW.created_by
  WHERE id = NEW.promise_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_promise_followups_sync_next
AFTER INSERT ON payment_promise_followups
FOR EACH ROW EXECUTE FUNCTION synchronize_payment_promise_next_followup();

CREATE TRIGGER payment_promise_events_prevent_update
BEFORE UPDATE ON payment_promise_events
FOR EACH ROW EXECUTE FUNCTION prevent_payment_promise_append_only_mutation();

CREATE TRIGGER payment_promise_events_prevent_delete
BEFORE DELETE ON payment_promise_events
FOR EACH ROW EXECUTE FUNCTION prevent_payment_promise_append_only_mutation();

COMMIT;
