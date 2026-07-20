BEGIN;

UPDATE payment_promises
SET create_payload = jsonb_set(
  create_payload,
  '{nextFollowUpAt}',
  CASE
    WHEN next_follow_up_at IS NULL THEN 'null'::jsonb
    ELSE to_jsonb(
      to_char(
        next_follow_up_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    )
  END,
  true
);

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

COMMIT;
