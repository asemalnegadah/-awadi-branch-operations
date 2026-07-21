BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES (
  'credit_exceptions.consume',
  'credit_exceptions',
  'consume',
  'استهلاك استثناء ائتماني نافذ وربطه بعملية بيع آجل موثقة.'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.code = 'credit_exceptions.consume'
WHERE role.code = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE credit_exception_usage_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES credit_exceptions(id) ON DELETE RESTRICT,
  restriction_id uuid NOT NULL REFERENCES credit_restrictions(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IN ('SR', 'RG')),
  direction text NOT NULL DEFAULT 'CONSUME' CHECK (direction IN ('CONSUME', 'REVERSE')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  source_type text NOT NULL CHECK (NULLIF(btrim(source_type), '') IS NOT NULL),
  source_id text NOT NULL CHECK (NULLIF(btrim(source_id), '') IS NOT NULL),
  reversal_of_usage_id uuid REFERENCES credit_exception_usage_entries(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT credit_exception_usage_direction_shape CHECK (
    (direction = 'CONSUME' AND reversal_of_usage_id IS NULL)
    OR
    (direction = 'REVERSE'
      AND reversal_of_usage_id IS NOT NULL
      AND NULLIF(btrim(reason), '') IS NOT NULL)
  ),
  CONSTRAINT credit_exception_usage_idempotency_nonempty
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE UNIQUE INDEX credit_exception_usage_one_consume_source_uidx
  ON credit_exception_usage_entries (source_type, source_id)
  WHERE direction = 'CONSUME';

CREATE UNIQUE INDEX credit_exception_usage_one_reversal_uidx
  ON credit_exception_usage_entries (reversal_of_usage_id)
  WHERE reversal_of_usage_id IS NOT NULL;

CREATE INDEX credit_exception_usage_exception_history_idx
  ON credit_exception_usage_entries (exception_id, occurred_at, id);

CREATE OR REPLACE FUNCTION validate_credit_exception_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exception_record credit_exceptions%ROWTYPE;
  restriction_record credit_restrictions%ROWTYPE;
  original_record credit_exception_usage_entries%ROWTYPE;
  consumed_minor bigint;
BEGIN
  IF NEW.direction = 'REVERSE' THEN
    SELECT * INTO original_record
    FROM credit_exception_usage_entries
    WHERE id = NEW.reversal_of_usage_id
    FOR UPDATE;

    IF original_record.id IS NULL OR original_record.direction <> 'CONSUME' THEN
      RAISE EXCEPTION 'credit exception usage reversal requires an original consume entry';
    END IF;

    IF NEW.exception_id <> original_record.exception_id
      OR NEW.restriction_id <> original_record.restriction_id
      OR NEW.customer_id <> original_record.customer_id
      OR NEW.customer_account_id <> original_record.customer_account_id
      OR NEW.currency_code <> original_record.currency_code
      OR NEW.amount_minor <> original_record.amount_minor
      OR NEW.source_type <> original_record.source_type
      OR NEW.source_id <> original_record.source_id THEN
      RAISE EXCEPTION 'credit exception usage reversal must match the original entry';
    END IF;

    RETURN NEW;
  END IF;

  SELECT * INTO exception_record
  FROM credit_exceptions
  WHERE id = NEW.exception_id
  FOR UPDATE;

  IF exception_record.id IS NULL THEN
    RAISE EXCEPTION 'credit exception does not exist';
  END IF;

  SELECT * INTO restriction_record
  FROM credit_restrictions
  WHERE id = exception_record.restriction_id
  FOR UPDATE;

  IF restriction_record.id IS NULL OR restriction_record.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'credit exception usage requires an active restriction';
  END IF;

  IF exception_record.state <> 'ACTIVE'
    OR exception_record.valid_from > now()
    OR exception_record.valid_until <= now() THEN
    RAISE EXCEPTION 'credit exception is not active within its validity window';
  END IF;

  NEW.restriction_id := exception_record.restriction_id;
  NEW.customer_id := exception_record.customer_id;
  NEW.customer_account_id := exception_record.customer_account_id;
  NEW.currency_code := exception_record.currency_code;

  SELECT COALESCE(SUM(
    CASE WHEN entry.direction = 'CONSUME' THEN entry.amount_minor ELSE -entry.amount_minor END
  ), 0)::bigint
  INTO consumed_minor
  FROM credit_exception_usage_entries AS entry
  WHERE entry.exception_id = exception_record.id;

  IF exception_record.scope = 'SINGLE_TRANSACTION' THEN
    IF consumed_minor <> 0 THEN
      RAISE EXCEPTION 'single-transaction credit exception has already been consumed';
    END IF;
    IF NEW.amount_minor > exception_record.max_amount_minor THEN
      RAISE EXCEPTION 'credit exception usage exceeds the approved amount';
    END IF;
  ELSIF consumed_minor + NEW.amount_minor > exception_record.max_amount_minor THEN
    RAISE EXCEPTION 'credit exception cumulative usage exceeds the approved amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_exception_usage_validate
BEFORE INSERT ON credit_exception_usage_entries
FOR EACH ROW EXECUTE FUNCTION validate_credit_exception_usage();

CREATE TRIGGER credit_exception_usage_prevent_update
BEFORE UPDATE ON credit_exception_usage_entries
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

CREATE TRIGGER credit_exception_usage_prevent_delete
BEFORE DELETE ON credit_exception_usage_entries
FOR EACH ROW EXECUTE FUNCTION prevent_credit_risk_append_only_mutation();

COMMIT;
