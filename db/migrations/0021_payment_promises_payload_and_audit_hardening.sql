BEGIN;

-- Always derive the immutable idempotency payload from the actual inserted columns.
-- Direct SQL/import callers may not supply a competing payload.
CREATE OR REPLACE FUNCTION protect_payment_promise_create_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.create_payload := jsonb_build_object(
      'customerId', NEW.customer_id,
      'customerAccountId', NEW.customer_account_id,
      'representativeId', NEW.representative_id,
      'currencyCode', NEW.currency_code,
      'promisedAmountMinor', NEW.promised_amount_minor,
      'promiseDate', NEW.promise_date,
      'dueDate', NEW.due_date,
      'nextFollowUpAt', CASE
        WHEN NEW.next_follow_up_at IS NULL THEN NULL
        ELSE to_char(
          NEW.next_follow_up_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      END,
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

-- Enforce the real application operating mode on payment-promise audit rows at
-- the database boundary. This replaces any stale or caller-supplied value.
CREATE OR REPLACE FUNCTION enforce_payment_promise_audit_operating_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_operating_mode text;
BEGIN
  IF NEW.resource_type = 'PAYMENT_PROMISE' THEN
    SELECT operating_mode
    INTO STRICT current_operating_mode
    FROM organization_settings
    WHERE singleton_id = 1;

    NEW.metadata := jsonb_set(
      COALESCE(NEW.metadata, '{}'::jsonb),
      '{operating_mode}',
      to_jsonb(current_operating_mode),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_enforce_payment_promise_operating_mode
  ON audit_logs;

CREATE TRIGGER audit_logs_enforce_payment_promise_operating_mode
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION enforce_payment_promise_audit_operating_mode();

COMMIT;
