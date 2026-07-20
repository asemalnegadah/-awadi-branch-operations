BEGIN;

DO $$
DECLARE
  protection_trigger_state "char";
  validation_trigger_state "char";
  function_definition text;
BEGIN
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
    RAISE EXCEPTION 'payment promise protection triggers must remain enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'payment_promises'::regclass
      AND tgname = 'a_payment_promises_defer_payload_canonicalization'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'temporary payment promise backfill trigger still exists';
  END IF;

  SELECT pg_get_functiondef('protect_payment_promise_create_payload()'::regprocedure)
  INTO function_definition;

  IF position('AT TIME ZONE ''UTC''' IN function_definition) = 0
    OR position('payment promise create payload is immutable' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'canonical immutable create payload protection is missing';
  END IF;
END;
$$;

ROLLBACK;
