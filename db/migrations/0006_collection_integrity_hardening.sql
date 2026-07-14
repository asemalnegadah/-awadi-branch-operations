BEGIN;

CREATE OR REPLACE FUNCTION validate_collection_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_reason text;
  linked_entry customer_ledger_entries%ROWTYPE;
BEGIN
  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');

  IF ROW(OLD.id, OLD.created_at, OLD.created_by, OLD.idempotency_key)
    IS DISTINCT FROM
    ROW(NEW.id, NEW.created_at, NEW.created_by, NEW.idempotency_key) THEN
    RAISE EXCEPTION 'collection identity and creation fields are immutable';
  END IF;

  IF OLD.state <> 'DRAFT' OR NEW.state <> OLD.state THEN
    IF ROW(
      OLD.customer_id,
      OLD.customer_account_id,
      OLD.representative_id,
      OLD.currency_code,
      OLD.amount_minor,
      OLD.payment_method,
      OLD.collected_at,
      OLD.receipt_number,
      OLD.evidence_document_id,
      OLD.evidence_note
    ) IS DISTINCT FROM ROW(
      NEW.customer_id,
      NEW.customer_account_id,
      NEW.representative_id,
      NEW.currency_code,
      NEW.amount_minor,
      NEW.payment_method,
      NEW.collected_at,
      NEW.receipt_number,
      NEW.evidence_document_id,
      NEW.evidence_note
    ) THEN
      RAISE EXCEPTION 'collection financial and evidence fields are frozen after draft';
    END IF;
  END IF;

  IF OLD.state <> NEW.state
    AND NOT collection_transition_allowed(OLD.state, NEW.state) THEN
    RAISE EXCEPTION 'invalid collection state transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF OLD.state <> NEW.state
    AND NEW.state IN ('RETURNED', 'CONFLICTED', 'REJECTED')
    AND transition_reason IS NULL THEN
    RAISE EXCEPTION 'transition reason is required for state %', NEW.state;
  END IF;

  IF NEW.state = 'SUBMITTED'
    AND NEW.receipt_number IS NULL
    AND NEW.evidence_document_id IS NULL THEN
    RAISE EXCEPTION 'submitted collection requires receipt or evidence';
  END IF;

  IF ROW(NEW.reviewed_at, NEW.reviewed_by)
    IS DISTINCT FROM ROW(OLD.reviewed_at, OLD.reviewed_by)
    AND NEW.state <> 'REVIEWED' THEN
    RAISE EXCEPTION 'review fields may only be set during review transition';
  END IF;

  IF NEW.state = 'REVIEWED' AND (
    NEW.reviewed_by IS NULL
    OR NEW.reviewed_at IS NULL
    OR NEW.reviewed_by = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'reviewed collection requires independent reviewer and review time';
  END IF;

  IF ROW(NEW.approved_at, NEW.approved_by)
    IS DISTINCT FROM ROW(OLD.approved_at, OLD.approved_by)
    AND NEW.state <> 'APPROVED' THEN
    RAISE EXCEPTION 'approval fields may only be set during approval transition';
  END IF;

  IF NEW.state = 'APPROVED' AND (
    NEW.approved_by IS NULL
    OR NEW.approved_at IS NULL
    OR NEW.approved_by = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'approved collection requires independent approver and approval time';
  END IF;

  IF ROW(NEW.cash_received_at, NEW.cash_received_by)
    IS DISTINCT FROM ROW(OLD.cash_received_at, OLD.cash_received_by)
    AND NEW.state <> 'CASH_RECEIVED' THEN
    RAISE EXCEPTION 'cash receipt fields may only be set during cash receipt transition';
  END IF;

  IF NEW.state = 'CASH_RECEIVED' AND (
    NEW.cash_received_by IS NULL
    OR NEW.cash_received_at IS NULL
    OR NEW.cash_received_by = NEW.created_by
  ) THEN
    RAISE EXCEPTION 'cash receipt requires independent receiver and receipt time';
  END IF;

  IF NEW.ledger_entry_id IS DISTINCT FROM OLD.ledger_entry_id THEN
    IF OLD.ledger_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'linked ledger entry cannot be replaced';
    END IF;

    IF NEW.state <> 'RECONCILED' OR NEW.ledger_entry_id IS NULL THEN
      RAISE EXCEPTION 'ledger entry may only be linked during reconciliation';
    END IF;

    SELECT * INTO linked_entry
    FROM customer_ledger_entries
    WHERE id = NEW.ledger_entry_id;

    IF linked_entry.id IS NULL THEN
      RAISE EXCEPTION 'linked ledger entry does not exist';
    END IF;

    IF linked_entry.entry_type <> 'COLLECTION'
      OR linked_entry.direction <> 'CREDIT'
      OR linked_entry.customer_id <> NEW.customer_id
      OR linked_entry.customer_account_id <> NEW.customer_account_id
      OR linked_entry.currency_code <> NEW.currency_code
      OR linked_entry.amount_minor <> NEW.amount_minor
      OR linked_entry.source_type <> 'COLLECTION'
      OR linked_entry.source_id <> NEW.id::text THEN
      RAISE EXCEPTION 'linked ledger entry does not match collection';
    END IF;
  END IF;

  IF ROW(NEW.reconciled_at, NEW.reconciled_by)
    IS DISTINCT FROM ROW(OLD.reconciled_at, OLD.reconciled_by)
    AND NEW.state <> 'RECONCILED' THEN
    RAISE EXCEPTION 'reconciliation fields may only be set during reconciliation';
  END IF;

  IF NEW.state = 'RECONCILED' AND (
    NEW.ledger_entry_id IS NULL
    OR NEW.reconciled_by IS NULL
    OR NEW.reconciled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'reconciled collection requires ledger entry and reconciliation actor';
  END IF;

  IF ROW(NEW.closed_at, NEW.closed_by)
    IS DISTINCT FROM ROW(OLD.closed_at, OLD.closed_by)
    AND NEW.state <> 'CLOSED' THEN
    RAISE EXCEPTION 'close fields may only be set during close transition';
  END IF;

  IF NEW.state = 'CLOSED' AND (
    NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR NEW.ledger_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'closed collection requires ledger entry, closer, and close time';
  END IF;

  IF ROW(NEW.reversed_at, NEW.reversed_by, NEW.reversal_reason)
    IS DISTINCT FROM ROW(OLD.reversed_at, OLD.reversed_by, OLD.reversal_reason)
    AND NEW.state <> 'REVERSED' THEN
    RAISE EXCEPTION 'reversal fields may only be set during reversal transition';
  END IF;

  IF NEW.state = 'REVERSED' AND (
    NEW.reversed_by IS NULL
    OR NEW.reversed_at IS NULL
    OR NULLIF(btrim(NEW.reversal_reason), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'reversed collection requires actor, time, and reason';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_prevent_delete
BEFORE DELETE ON collections
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION record_collection_state_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_setting text;
  request_value uuid;
  transition_reason text;
BEGIN
  request_setting := NULLIF(btrim(current_setting('app.request_id', true)), '');
  request_value := gen_random_uuid();

  IF request_setting IS NOT NULL THEN
    BEGIN
      request_value := request_setting::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'app.request_id must be a valid UUID';
    END;
  END IF;

  transition_reason := NULLIF(btrim(current_setting('app.transition_reason', true)), '');
  IF transition_reason IS NULL AND NEW.state = 'REVERSED' THEN
    transition_reason := NULLIF(btrim(NEW.reversal_reason), '');
  END IF;

  INSERT INTO collection_state_history (
    collection_id,
    from_state,
    to_state,
    changed_at,
    changed_by,
    reason,
    request_id,
    metadata
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    now(),
    CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.updated_by END,
    transition_reason,
    request_value,
    jsonb_build_object('version', NEW.version)
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_record_initial_state
AFTER INSERT ON collections
FOR EACH ROW EXECUTE FUNCTION record_collection_state_history();

CREATE TRIGGER collections_record_state_change
AFTER UPDATE OF state ON collections
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION record_collection_state_history();

CREATE OR REPLACE FUNCTION validate_collection_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  collection_record collections%ROWTYPE;
  active_total bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.collection_id::text, 0));

  SELECT * INTO collection_record
  FROM collections
  WHERE id = NEW.collection_id
  FOR UPDATE;

  IF collection_record.id IS NULL THEN
    RAISE EXCEPTION 'collection does not exist';
  END IF;

  IF collection_record.state IN ('DRAFT', 'REJECTED', 'REVERSED') THEN
    RAISE EXCEPTION 'collection state % does not allow allocation', collection_record.state;
  END IF;

  IF NEW.currency_code <> collection_record.currency_code THEN
    RAISE EXCEPTION 'allocation currency does not match collection currency';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.id,
      OLD.collection_id,
      OLD.target_type,
      OLD.target_id,
      OLD.currency_code,
      OLD.amount_minor,
      OLD.allocated_at,
      OLD.allocated_by
    ) IS DISTINCT FROM ROW(
      NEW.id,
      NEW.collection_id,
      NEW.target_type,
      NEW.target_id,
      NEW.currency_code,
      NEW.amount_minor,
      NEW.allocated_at,
      NEW.allocated_by
    ) THEN
      RAISE EXCEPTION 'allocation core fields are immutable';
    END IF;

    IF OLD.reversed_at IS NOT NULL THEN
      RAISE EXCEPTION 'reversed allocation cannot be modified';
    END IF;

    IF NEW.reversed_at IS NULL
      OR NEW.reversed_by IS NULL
      OR NULLIF(btrim(NEW.reversal_reason), '') IS NULL THEN
      RAISE EXCEPTION 'allocation update must be a complete documented reversal';
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0)
  INTO active_total
  FROM collection_allocations
  WHERE collection_id = NEW.collection_id
    AND reversed_at IS NULL
    AND id <> NEW.id;

  IF NEW.reversed_at IS NULL THEN
    active_total := active_total + NEW.amount_minor;
  END IF;

  IF active_total > collection_record.amount_minor THEN
    RAISE EXCEPTION 'active allocation total exceeds collection amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_allocations_validate
BEFORE INSERT OR UPDATE ON collection_allocations
FOR EACH ROW EXECUTE FUNCTION validate_collection_allocation();

CREATE TRIGGER collection_allocations_prevent_delete
BEFORE DELETE ON collection_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_custody_source_and_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  collection_record collections%ROWTYPE;
  available_balance bigint;
  collection_uuid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.representative_id::text || ':' || NEW.currency_code, 0)
  );

  IF NEW.event_type = 'COLLECTION_IN' THEN
    IF NEW.direction <> 'IN' OR NEW.source_type <> 'COLLECTION' THEN
      RAISE EXCEPTION 'collection custody event must be an IN event sourced from COLLECTION';
    END IF;

    BEGIN
      collection_uuid := NEW.source_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'collection custody source_id must be a valid UUID';
    END;

    SELECT * INTO collection_record
    FROM collections
    WHERE id = collection_uuid;

    IF collection_record.id IS NULL THEN
      RAISE EXCEPTION 'custody collection does not exist';
    END IF;

    IF collection_record.payment_method <> 'CASH'
      OR collection_record.state NOT IN ('APPROVED', 'CASH_RECEIVED', 'RECONCILED', 'CLOSED')
      OR collection_record.representative_id <> NEW.representative_id
      OR collection_record.currency_code <> NEW.currency_code
      OR collection_record.amount_minor <> NEW.amount_minor THEN
      RAISE EXCEPTION 'custody event does not match approved cash collection';
    END IF;
  ELSIF NEW.event_type = 'HANDOVER_OUT' THEN
    IF NEW.direction <> 'OUT'
      OR NEW.source_type <> 'CASH_HANDOVER'
      OR NEW.received_by IS NULL THEN
      RAISE EXCEPTION 'cash handover must be an OUT event with receiver and handover source';
    END IF;
  END IF;

  IF NEW.direction = 'OUT' THEN
    SELECT COALESCE(SUM(
      CASE direction WHEN 'IN' THEN amount_minor ELSE -amount_minor END
    ), 0)
    INTO available_balance
    FROM representative_cash_custody_events
    WHERE representative_id = NEW.representative_id
      AND currency_code = NEW.currency_code;

    IF NEW.amount_minor > available_balance THEN
      RAISE EXCEPTION 'custody outgoing amount exceeds available representative balance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_source_and_balance_validate
BEFORE INSERT ON representative_cash_custody_events
FOR EACH ROW EXECUTE FUNCTION validate_custody_source_and_balance();

COMMIT;
