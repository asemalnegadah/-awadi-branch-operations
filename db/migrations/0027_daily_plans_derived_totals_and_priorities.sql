BEGIN;

CREATE UNIQUE INDEX daily_plan_candidates_unique_selected_rank
  ON daily_plan_candidates (plan_id, selection_rank)
  WHERE selected = true;

CREATE TABLE planning_priority_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  representative_id uuid REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason text,
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT planning_priority_valid_range CHECK (valid_until >= valid_from),
  CONSTRAINT planning_priority_state_shape CHECK (
    (state IN ('ACTIVE', 'EXPIRED')
      AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (state = 'REVOKED'
      AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL
      AND NULLIF(btrim(revocation_reason), '') IS NOT NULL)
  )
);

CREATE INDEX planning_priority_active_lookup_idx
  ON planning_priority_overrides (
    customer_id,
    representative_id,
    state,
    valid_from,
    valid_until,
    priority DESC,
    id
  );

CREATE OR REPLACE FUNCTION validate_planning_priority_override()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_active boolean;
  representative_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT deleted_at IS NULL AND merged_into_customer_id IS NULL
    INTO customer_active
    FROM customers
    WHERE id = NEW.customer_id;

    IF customer_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'planning priority requires an active customer';
    END IF;

    IF NEW.representative_id IS NOT NULL THEN
      SELECT status = 'ACTIVE' AND deleted_at IS NULL
      INTO representative_active
      FROM sales_representatives
      WHERE id = NEW.representative_id;

      IF representative_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'planning priority representative must be active';
      END IF;
    END IF;

    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'new planning priority must start as ACTIVE';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.state = 'ACTIVE' AND NEW.state IN ('REVOKED', 'EXPIRED') THEN
    IF ROW(
      OLD.id,
      OLD.customer_id,
      OLD.representative_id,
      OLD.valid_from,
      OLD.valid_until,
      OLD.priority,
      OLD.reason,
      OLD.created_by,
      OLD.created_at,
      OLD.request_id,
      OLD.idempotency_key
    ) IS DISTINCT FROM ROW(
      NEW.id,
      NEW.customer_id,
      NEW.representative_id,
      NEW.valid_from,
      NEW.valid_until,
      NEW.priority,
      NEW.reason,
      NEW.created_by,
      NEW.created_at,
      NEW.request_id,
      NEW.idempotency_key
    ) THEN
      RAISE EXCEPTION 'planning priority core fields are immutable';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid planning priority transition: % -> %', OLD.state, NEW.state;
END;
$$;

CREATE TRIGGER planning_priority_overrides_validate
BEFORE INSERT OR UPDATE ON planning_priority_overrides
FOR EACH ROW EXECUTE FUNCTION validate_planning_priority_override();

CREATE TRIGGER planning_priority_overrides_prevent_delete
BEFORE DELETE ON planning_priority_overrides
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE OR REPLACE FUNCTION derive_daily_plan_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_plan_id uuid;
  plan_state text;
BEGIN
  target_plan_id := COALESCE(NEW.id, OLD.id);
  SELECT state INTO plan_state FROM daily_plans WHERE id = target_plan_id;

  IF TG_OP = 'UPDATE' AND OLD.state = 'DRAFT' THEN
    SELECT
      COALESCE(SUM(target_collection_sr_minor), 0)::bigint,
      COALESCE(SUM(target_collection_rg_minor), 0)::bigint,
      COALESCE(SUM(target_sales_sr_minor), 0)::bigint,
      COALESCE(SUM(target_sales_rg_minor), 0)::bigint,
      COALESCE(SUM(estimated_visit_minutes + estimated_travel_minutes), 0)::integer
    INTO
      NEW.target_collection_sr_minor,
      NEW.target_collection_rg_minor,
      NEW.target_sales_sr_minor,
      NEW.target_sales_rg_minor,
      NEW.estimated_work_minutes
    FROM daily_plan_items
    WHERE plan_id = OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER a_daily_plans_derive_totals
BEFORE UPDATE ON daily_plans
FOR EACH ROW EXECUTE FUNCTION derive_daily_plan_totals();

CREATE OR REPLACE FUNCTION refresh_daily_plan_totals_after_item_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_plan_id uuid;
  plan_state text;
BEGIN
  target_plan_id := COALESCE(NEW.plan_id, OLD.plan_id);
  SELECT state INTO plan_state FROM daily_plans WHERE id = target_plan_id;

  IF plan_state = 'DRAFT' THEN
    UPDATE daily_plans
    SET updated_at = now()
    WHERE id = target_plan_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER daily_plan_items_refresh_totals
AFTER INSERT OR UPDATE OR DELETE ON daily_plan_items
FOR EACH ROW EXECUTE FUNCTION refresh_daily_plan_totals_after_item_change();

CREATE OR REPLACE FUNCTION validate_daily_plan_candidate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record daily_plans%ROWTYPE;
  promise_customer_id uuid;
  assignment_exists boolean;
BEGIN
  SELECT * INTO plan_record FROM daily_plans WHERE id = NEW.plan_id;
  IF plan_record.id IS NULL OR plan_record.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'daily plan candidates may be created only for a draft plan';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM customer_rep_assignments AS assignment
    WHERE assignment.customer_id = NEW.customer_id
      AND assignment.representative_id = plan_record.representative_id
      AND assignment.valid_from <= plan_record.cutoff_at
      AND (assignment.valid_until IS NULL OR assignment.valid_until > plan_record.cutoff_at)
  ) INTO assignment_exists;

  IF assignment_exists IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'daily plan candidate customer is not assigned to the representative at cutoff';
  END IF;

  IF NEW.linked_promise_id IS NOT NULL THEN
    SELECT customer_id INTO promise_customer_id
    FROM payment_promises
    WHERE id = NEW.linked_promise_id;
    IF promise_customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'daily plan candidate promise belongs to another customer';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_daily_plan_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record daily_plans%ROWTYPE;
  promise_customer_id uuid;
  route_area_id uuid;
  assignment_exists boolean;
BEGIN
  SELECT * INTO plan_record FROM daily_plans WHERE id = NEW.plan_id;
  IF plan_record.id IS NULL OR plan_record.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'daily plan items may change only while the plan is DRAFT';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM customer_rep_assignments AS assignment
    WHERE assignment.customer_id = NEW.customer_id
      AND assignment.representative_id = plan_record.representative_id
      AND assignment.valid_from <= plan_record.cutoff_at
      AND (assignment.valid_until IS NULL OR assignment.valid_until > plan_record.cutoff_at)
  ) INTO assignment_exists;

  IF assignment_exists IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'daily plan item customer is not assigned to the representative at cutoff';
  END IF;

  IF NEW.linked_promise_id IS NOT NULL THEN
    SELECT customer_id INTO promise_customer_id
    FROM payment_promises
    WHERE id = NEW.linked_promise_id;
    IF promise_customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'daily plan item promise belongs to another customer';
    END IF;
  END IF;

  IF NEW.route_id IS NOT NULL THEN
    SELECT area_id INTO route_area_id FROM routes WHERE id = NEW.route_id AND is_active = true;
    IF route_area_id IS NULL THEN
      RAISE EXCEPTION 'daily plan item route is missing or inactive';
    END IF;
    IF NEW.area_id IS NOT NULL AND NEW.area_id <> route_area_id THEN
      RAISE EXCEPTION 'daily plan item area does not match route area';
    END IF;
    NEW.area_id := route_area_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
