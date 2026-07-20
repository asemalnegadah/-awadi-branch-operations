BEGIN;

-- 0018 installs a narrowly scoped compatibility trigger that makes the unsafe
-- 0019 UPDATE a no-op. Remove it before the safe backfill.
DROP TRIGGER IF EXISTS a_payment_promises_defer_payload_canonicalization
  ON payment_promises;
DROP FUNCTION IF EXISTS defer_payment_promise_payload_canonicalization();

-- Disable only the two triggers that would reject a controlled create_payload
-- backfill. Trigger state and data changes are transactional, so any failure
-- restores the fully protected pre-migration state.
ALTER TABLE payment_promises
  DISABLE TRIGGER b_payment_promises_protect_create_payload;
ALTER TABLE payment_promises
  DISABLE TRIGGER payment_promises_validate;

UPDATE payment_promises
SET create_payload = jsonb_set(
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
)
WHERE create_payload IS DISTINCT FROM jsonb_set(
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

ALTER TABLE payment_promises
  ENABLE TRIGGER payment_promises_validate;
ALTER TABLE payment_promises
  ENABLE TRIGGER b_payment_promises_protect_create_payload;

DO $$
DECLARE
  invalid_payload_count bigint;
  protection_trigger_state "char";
  validation_trigger_state "char";
BEGIN
  SELECT COUNT(*)
  INTO invalid_payload_count
  FROM payment_promises
  WHERE create_payload IS DISTINCT FROM jsonb_set(
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
    RAISE EXCEPTION 'payment promise create payload backfill left % invalid rows',
      invalid_payload_count;
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
    RAISE EXCEPTION 'payment promise protection triggers were not restored';
  END IF;
END;
$$;

COMMIT;
