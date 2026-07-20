BEGIN;

DO $$
DECLARE
  status_count integer;
  invalid_payload_count integer;
  target_promise_id uuid;
  actor_id uuid;
  protection_trigger_state "char";
  validation_trigger_state "char";
  fulfilled_create_followup text;
BEGIN
  SELECT COUNT(DISTINCT base_status)
  INTO status_count
  FROM payment_promises
  WHERE idempotency_key IN (
    'promise-upgrade-fulfilled',
    'promise-upgrade-rejected',
    'promise-upgrade-cancelled',
    'promise-upgrade-partial'
  )
    AND base_status IN (
      'FULFILLED', 'REJECTED', 'CANCELLED', 'PARTIALLY_FULFILLED'
    );

  IF status_count <> 4 THEN
    RAISE EXCEPTION 'expected all four legacy promise statuses after upgrade';
  END IF;

  SELECT COUNT(*)
  INTO invalid_payload_count
  FROM payment_promises
  WHERE idempotency_key LIKE 'promise-upgrade-%'
    AND create_payload IS DISTINCT FROM jsonb_set(
      create_payload,
      '{nextFollowUpAt}',
      CASE
        WHEN create_payload -> 'nextFollowUpAt' IS NULL
          OR create_payload -> 'nextFollowUpAt' = 'null'::jsonb
          THEN 'null'::jsonb
        ELSE to_jsonb(
          to_char(
            (create_payload ->> 'nextFollowUpAt')::timestamptz AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        )
      END,
      true
    );

  IF invalid_payload_count <> 0 THEN
    RAISE EXCEPTION 'legacy create payloads were not canonicalized safely';
  END IF;

  SELECT create_payload ->> 'nextFollowUpAt'
  INTO fulfilled_create_followup
  FROM payment_promises
  WHERE idempotency_key = 'promise-upgrade-fulfilled';

  IF fulfilled_create_followup <> '2026-07-20T09:00:00.000Z' THEN
    RAISE EXCEPTION 'fulfilled promise lost its immutable create timestamp: %',
      fulfilled_create_followup;
  END IF;

  SELECT tgenabled
  INTO protection_trigger_state
  FROM pg_trigger
  WHERE tgrelid = 'payment_promises'::regclass
    AND tgname = 'b_payment_promises_protect_create_payload'
    AND NOT tgisinternal;

  SELECT tgenabled
  INTO validation_trigger_state
  FROM pg_trigger
  WHERE tgrelid = 'payment_promises'::regclass
    AND tgname = 'payment_promises_validate'
    AND NOT tgisinternal;

  IF protection_trigger_state IS DISTINCT FROM 'O'
    OR validation_trigger_state IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'promise protection triggers are not enabled after upgrade';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'payment_promises'::regclass
      AND tgname = 'a_payment_promises_defer_payload_canonicalization'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'temporary payload deferral trigger survived migration 0020';
  END IF;

  SELECT id, created_by
  INTO target_promise_id, actor_id
  FROM payment_promises
  WHERE idempotency_key = 'promise-upgrade-partial';

  BEGIN
    UPDATE payment_promises
    SET create_payload = jsonb_set(create_payload, '{notes}', '"tampered"'::jsonb)
    WHERE id = target_promise_id;
    RAISE EXCEPTION 'expected immutable create payload update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected immutable create payload update to fail' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE payment_promises
    SET fulfilled_amount_minor = fulfilled_amount_minor + 1,
        updated_by = actor_id
    WHERE id = target_promise_id;
    RAISE EXCEPTION 'expected manual fulfilled amount update to fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'expected manual fulfilled amount update to fail' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
