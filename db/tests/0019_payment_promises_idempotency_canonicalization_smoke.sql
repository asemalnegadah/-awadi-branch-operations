BEGIN;

DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('protect_payment_promise_create_payload()'::regprocedure)
  INTO function_definition;

  IF position('AT TIME ZONE ''UTC''' IN function_definition) = 0
    OR position('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'payment promise create timestamp canonicalization is missing';
  END IF;
END;
$$;

ROLLBACK;
