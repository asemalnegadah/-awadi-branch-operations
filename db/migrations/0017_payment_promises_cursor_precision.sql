BEGIN;

CREATE OR REPLACE FUNCTION normalize_payment_promise_cursor_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_at := date_trunc('milliseconds', NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE TRIGGER a_payment_promises_normalize_created_at
BEFORE INSERT ON payment_promises
FOR EACH ROW EXECUTE FUNCTION normalize_payment_promise_cursor_timestamp();

COMMIT;
