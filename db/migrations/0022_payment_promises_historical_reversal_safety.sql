BEGIN;

-- Preserve strict availability checks for operator-driven promise changes, while
-- allowing the allocation synchronization trigger to recalculate historical
-- promises after an allocation reversal even if the customer/account or
-- representative became unavailable later.
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
  financial_write_setting := NULLIF(
    btrim(current_setting('app.promise_financial_write', true)),
    ''
  );

  IF TG_OP = 'INSERT'
    OR financial_write_setting IS DISTINCT FROM NEW.id::text THEN
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

-- New allocations remain forbidden when the historical promise's account,
-- customer, or representative is no longer operational. Reversal updates do
-- not use this INSERT-only availability gate, so financial corrections remain
-- possible and documented.
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
    IF NOT EXISTS (
      SELECT 1
      FROM customer_accounts AS account
      JOIN customers AS customer ON customer.id = account.customer_id
      JOIN sales_representatives AS representative
        ON representative.id = promise_record.representative_id
      WHERE account.id = promise_record.customer_account_id
        AND account.customer_id = promise_record.customer_id
        AND account.currency_code = promise_record.currency_code
        AND account.status = 'ACTIVE'
        AND account.closed_at IS NULL
        AND customer.deleted_at IS NULL
        AND customer.merged_into_customer_id IS NULL
        AND representative.status = 'ACTIVE'
        AND representative.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'promise customer account or representative is unavailable for allocation';
    END IF;

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

COMMIT;
