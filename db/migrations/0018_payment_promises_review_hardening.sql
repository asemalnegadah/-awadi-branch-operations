BEGIN;

-- Technical system administrators do not receive business debt visibility by default.
DELETE FROM role_permissions AS role_permission
USING roles AS role, permissions AS permission
WHERE role_permission.role_id = role.id
  AND role_permission.permission_id = permission.id
  AND role.code = 'SYSTEM_ADMIN'
  AND permission.code IN ('promises.read', 'promises.view_history');

-- Preserve the immutable create request used by the idempotency key. The current
-- promise row may change later and therefore cannot be used to validate a retry.
ALTER TABLE payment_promises
  ADD COLUMN create_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE payment_promises
SET create_payload = jsonb_build_object(
  'customerId', customer_id,
  'customerAccountId', customer_account_id,
  'representativeId', representative_id,
  'currencyCode', currency_code,
  'promisedAmountMinor', promised_amount_minor,
  'promiseDate', promise_date,
  'dueDate', due_date,
  'nextFollowUpAt', next_follow_up_at,
  'debtReason', debt_reason,
  'delayReason', delay_reason,
  'notes', notes
)
WHERE create_payload = '{}'::jsonb;

ALTER TABLE payment_promises
  ADD CONSTRAINT payment_promises_create_payload_object
  CHECK (jsonb_typeof(create_payload) = 'object');

CREATE OR REPLACE FUNCTION protect_payment_promise_create_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.create_payload = '{}'::jsonb THEN
    NEW.create_payload := jsonb_build_object(
      'customerId', NEW.customer_id,
      'customerAccountId', NEW.customer_account_id,
      'representativeId', NEW.representative_id,
      'currencyCode', NEW.currency_code,
      'promisedAmountMinor', NEW.promised_amount_minor,
      'promiseDate', NEW.promise_date,
      'dueDate', NEW.due_date,
      'nextFollowUpAt', NEW.next_follow_up_at,
      'debtReason', NEW.debt_reason,
      'delayReason', NEW.delay_reason,
      'notes', NEW.notes
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.create_payload IS DISTINCT FROM OLD.create_payload THEN
    RAISE EXCEPTION 'payment promise create payload is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER b_payment_promises_protect_create_payload
BEFORE INSERT OR UPDATE OF create_payload ON payment_promises
FOR EACH ROW EXECUTE FUNCTION protect_payment_promise_create_payload();

-- A financially reversed collection may not remain allocated to a promise. The
-- allocation reversal endpoint must run first so its append-only event and audit
-- records are preserved and the promise is reopened transactionally.
CREATE OR REPLACE FUNCTION guard_collection_reversal_with_promise_allocations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state IS DISTINCT FROM 'REVERSED'
    AND NEW.state = 'REVERSED'
    AND EXISTS (
      SELECT 1
      FROM payment_promise_allocations AS allocation
      WHERE allocation.collection_id = NEW.id
        AND allocation.reversed_at IS NULL
    ) THEN
    RAISE EXCEPTION 'reverse active payment promise allocations before reversing collection';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER a_collections_guard_promise_allocations_before_reversal
BEFORE UPDATE OF state ON collections
FOR EACH ROW EXECUTE FUNCTION guard_collection_reversal_with_promise_allocations();

COMMIT;
