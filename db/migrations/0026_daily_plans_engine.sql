BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('plans.read_own', 'plans', 'read_own', 'عرض المندوب لخططه اليومية المكلف بها.'),
  ('plans.read_all', 'plans', 'read_all', 'عرض جميع خطط المندوبين اليومية.'),
  ('plans.generate', 'plans', 'generate', 'توليد خطة يومية حتمية من آخر البيانات المعتمدة.'),
  ('plans.manage', 'plans', 'manage', 'إدارة مسودة الخطة وعناصرها قبل الاعتماد.'),
  ('plans.approve', 'plans', 'approve', 'اعتماد أو رفض خطة مندوب يومية.'),
  ('plans.view_history', 'plans', 'view_history', 'عرض Snapshot المرشحين وسجل تغييرات الخطة.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN (
    'plans.read_all',
    'plans.generate',
    'plans.manage',
    'plans.approve',
    'plans.view_history'
  )
WHERE role.code = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN ('plans.read_all', 'plans.view_history')
WHERE role.code IN ('OWNER_AUDITOR', 'AUDITOR')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.code = 'plans.read_own'
WHERE role.code = 'SALES_REP'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name_ar text NOT NULL CHECK (NULLIF(btrim(name_ar), '') IS NOT NULL),
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  estimated_travel_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_travel_minutes >= 0),
  default_visit_minutes integer NOT NULL DEFAULT 30 CHECK (default_visit_minutes BETWEEN 5 AND 480),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX routes_name_area_unique_active
  ON routes (area_id, lower(name_ar))
  WHERE is_active = true;

CREATE TABLE customer_route_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  assignment_type text NOT NULL DEFAULT 'PRIMARY'
    CHECK (assignment_type IN ('PRIMARY', 'TEMPORARY', 'BACKUP')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  reason text NOT NULL CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  approved_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT customer_route_assignment_valid_range
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX customer_route_one_active_primary
  ON customer_route_assignments (customer_id)
  WHERE assignment_type = 'PRIMARY' AND valid_until IS NULL;

CREATE INDEX customer_route_active_lookup
  ON customer_route_assignments (route_id, valid_from, valid_until);

CREATE TABLE daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  plan_date date NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
  )),
  generation_mode text NOT NULL DEFAULT 'AUTO'
    CHECK (generation_mode IN ('AUTO', 'MANUAL', 'HYBRID')),
  cutoff_at timestamptz NOT NULL,
  ruleset_version text NOT NULL CHECK (NULLIF(btrim(ruleset_version), '') IS NOT NULL),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  target_collection_sr_minor bigint NOT NULL DEFAULT 0 CHECK (target_collection_sr_minor >= 0),
  target_collection_rg_minor bigint NOT NULL DEFAULT 0 CHECK (target_collection_rg_minor >= 0),
  target_sales_sr_minor bigint NOT NULL DEFAULT 0 CHECK (target_sales_sr_minor >= 0),
  target_sales_rg_minor bigint NOT NULL DEFAULT 0 CHECK (target_sales_rg_minor >= 0),
  fuel_budget_currency_code text REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (fuel_budget_currency_code IS NULL OR fuel_budget_currency_code IN ('SR', 'RG')),
  fuel_budget_minor bigint CHECK (fuel_budget_minor IS NULL OR fuel_budget_minor >= 0),
  estimated_work_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_work_minutes >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  rejected_at timestamptz,
  rejection_reason text,
  started_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  started_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL UNIQUE
    CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_plan_fuel_budget_shape CHECK (
    (fuel_budget_currency_code IS NULL AND fuel_budget_minor IS NULL)
    OR
    (fuel_budget_currency_code IS NOT NULL AND fuel_budget_minor IS NOT NULL)
  ),
  CONSTRAINT daily_plan_plan_date_cutoff CHECK (
    plan_date >= (cutoff_at AT TIME ZONE 'Asia/Aden')::date
  ),
  CONSTRAINT daily_plan_state_shape CHECK (
    (state = 'DRAFT'
      AND submitted_by IS NULL AND submitted_at IS NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND started_by IS NULL AND started_at IS NULL
      AND completed_by IS NULL AND completed_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'PENDING_APPROVAL'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND started_by IS NULL AND started_at IS NULL
      AND completed_by IS NULL AND completed_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'APPROVED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND started_by IS NULL AND started_at IS NULL
      AND completed_by IS NULL AND completed_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'REJECTED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NULL AND approved_at IS NULL
      AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL
      AND NULLIF(btrim(rejection_reason), '') IS NOT NULL
      AND started_by IS NULL AND started_at IS NULL
      AND completed_by IS NULL AND completed_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'IN_PROGRESS'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND started_by IS NOT NULL AND started_at IS NOT NULL
      AND completed_by IS NULL AND completed_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'COMPLETED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND started_by IS NOT NULL AND started_at IS NOT NULL
      AND completed_by IS NOT NULL AND completed_at IS NOT NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'CANCELLED'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL
      AND rejected_by IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL
      AND completed_by IS NULL AND completed_at IS NULL
      AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
      AND NULLIF(btrim(cancellation_reason), '') IS NOT NULL)
  )
);

CREATE UNIQUE INDEX daily_plans_one_open_per_rep_date
  ON daily_plans (representative_id, plan_date)
  WHERE state NOT IN ('REJECTED', 'CANCELLED');

CREATE INDEX daily_plans_queue_idx
  ON daily_plans (state, plan_date, representative_id, id);

CREATE TABLE daily_plan_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES daily_plans(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  route_id uuid REFERENCES routes(id) ON DELETE RESTRICT,
  area_id uuid REFERENCES areas(id) ON DELETE RESTRICT,
  computed_score integer NOT NULL CHECK (computed_score BETWEEN 0 AND 1000),
  selected boolean NOT NULL,
  selection_rank integer CHECK (selection_rank IS NULL OR selection_rank > 0),
  decision_reason text NOT NULL CHECK (NULLIF(btrim(decision_reason), '') IS NOT NULL),
  exclusion_reason text,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(factors) = 'array'),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshot) = 'object'),
  linked_promise_id uuid REFERENCES payment_promises(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_plan_candidate_selection_shape CHECK (
    (selected = true AND selection_rank IS NOT NULL AND exclusion_reason IS NULL)
    OR
    (selected = false AND selection_rank IS NULL AND NULLIF(btrim(exclusion_reason), '') IS NOT NULL)
  ),
  CONSTRAINT daily_plan_candidate_unique_customer UNIQUE (plan_id, customer_id)
);

CREATE INDEX daily_plan_candidates_rank_idx
  ON daily_plan_candidates (plan_id, selected DESC, selection_rank, computed_score DESC, id);

CREATE TABLE daily_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES daily_plans(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  linked_promise_id uuid REFERENCES payment_promises(id) ON DELETE RESTRICT,
  task_type text NOT NULL CHECK (task_type IN (
    'COLLECTION',
    'PROMISE_FOLLOWUP',
    'RECONCILIATION',
    'SALES',
    'DATA_UPDATE',
    'PROBLEM_RESOLUTION',
    'MIXED'
  )),
  priority_level text NOT NULL CHECK (priority_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  priority_score integer NOT NULL CHECK (priority_score BETWEEN 0 AND 1000),
  selection_reason text NOT NULL CHECK (NULLIF(btrim(selection_reason), '') IS NOT NULL),
  objective text NOT NULL CHECK (NULLIF(btrim(objective), '') IS NOT NULL),
  expected_result text NOT NULL CHECK (NULLIF(btrim(expected_result), '') IS NOT NULL),
  target_collection_sr_minor bigint NOT NULL DEFAULT 0 CHECK (target_collection_sr_minor >= 0),
  target_collection_rg_minor bigint NOT NULL DEFAULT 0 CHECK (target_collection_rg_minor >= 0),
  target_sales_sr_minor bigint NOT NULL DEFAULT 0 CHECK (target_sales_sr_minor >= 0),
  target_sales_rg_minor bigint NOT NULL DEFAULT 0 CHECK (target_sales_rg_minor >= 0),
  area_id uuid REFERENCES areas(id) ON DELETE RESTRICT,
  route_id uuid REFERENCES routes(id) ON DELETE RESTRICT,
  estimated_visit_minutes integer NOT NULL DEFAULT 30 CHECK (estimated_visit_minutes BETWEEN 5 AND 480),
  estimated_travel_minutes integer NOT NULL DEFAULT 0 CHECK (estimated_travel_minutes >= 0),
  manual_override boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT daily_plan_item_unique_sequence UNIQUE (plan_id, sequence_number),
  CONSTRAINT daily_plan_item_unique_customer_task UNIQUE (plan_id, customer_id, task_type)
);

CREATE INDEX daily_plan_items_customer_idx
  ON daily_plan_items (customer_id, plan_id, sequence_number);

CREATE TABLE daily_plan_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES daily_plans(id) ON DELETE RESTRICT,
  plan_item_id uuid REFERENCES daily_plan_items(id) ON DELETE RESTRICT,
  adjustment_type text NOT NULL CHECK (adjustment_type IN (
    'ADD_ITEM',
    'REMOVE_ITEM',
    'REORDER',
    'CHANGE_TASK',
    'CHANGE_TARGET',
    'CHANGE_ROUTE',
    'CHANGE_TIMING',
    'CHANGE_PLAN_TARGET',
    'CHANGE_FUEL_BUDGET'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(old_values) = 'object'),
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(new_values) = 'object'),
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX daily_plan_adjustments_history_idx
  ON daily_plan_adjustments (plan_id, occurred_at, id);

CREATE TABLE daily_plan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES daily_plans(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'GENERATED',
    'CREATED',
    'UPDATED',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'STARTED',
    'COMPLETED',
    'CANCELLED'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(old_values) = 'object'),
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(new_values) = 'object'),
  operation_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(operation_payload) = 'object'),
  reason text,
  idempotency_key text UNIQUE,
  CONSTRAINT daily_plan_event_idempotency_nonempty
    CHECK (idempotency_key IS NULL OR NULLIF(btrim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX daily_plan_events_history_idx
  ON daily_plan_events (plan_id, occurred_at, id);

CREATE OR REPLACE FUNCTION prevent_daily_plan_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION validate_customer_route_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_active boolean;
  route_active boolean;
BEGIN
  SELECT deleted_at IS NULL AND merged_into_customer_id IS NULL
  INTO customer_active
  FROM customers
  WHERE id = NEW.customer_id;

  SELECT is_active INTO route_active
  FROM routes
  WHERE id = NEW.route_id;

  IF customer_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'customer route assignment requires an active customer';
  END IF;

  IF route_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'customer route assignment requires an active route';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_route_assignments_validate
BEFORE INSERT OR UPDATE ON customer_route_assignments
FOR EACH ROW EXECUTE FUNCTION validate_customer_route_assignment();

CREATE OR REPLACE FUNCTION validate_daily_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  representative_active boolean;
  allowed_transition boolean;
  item_count integer;
BEGIN
  SELECT status = 'ACTIVE' AND deleted_at IS NULL
  INTO representative_active
  FROM sales_representatives
  WHERE id = NEW.representative_id;

  IF representative_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'daily plan requires an active representative';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'new daily plan must start as DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  allowed_transition :=
    (OLD.state = 'DRAFT' AND NEW.state IN ('DRAFT', 'PENDING_APPROVAL'))
    OR (OLD.state = 'PENDING_APPROVAL' AND NEW.state IN ('APPROVED', 'REJECTED'))
    OR (OLD.state = 'APPROVED' AND NEW.state IN ('IN_PROGRESS', 'CANCELLED'))
    OR (OLD.state = 'IN_PROGRESS' AND NEW.state IN ('COMPLETED', 'CANCELLED'));

  IF NOT allowed_transition THEN
    RAISE EXCEPTION 'invalid daily plan transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF OLD.submitted_at IS NOT NULL
    AND ROW(OLD.submitted_by, OLD.submitted_at)
      IS DISTINCT FROM ROW(NEW.submitted_by, NEW.submitted_at) THEN
    RAISE EXCEPTION 'daily plan submission actor is immutable';
  END IF;

  IF OLD.approved_at IS NOT NULL
    AND ROW(OLD.approved_by, OLD.approved_at)
      IS DISTINCT FROM ROW(NEW.approved_by, NEW.approved_at) THEN
    RAISE EXCEPTION 'daily plan approval actor is immutable';
  END IF;

  IF OLD.rejected_at IS NOT NULL
    AND ROW(OLD.rejected_by, OLD.rejected_at, OLD.rejection_reason)
      IS DISTINCT FROM ROW(NEW.rejected_by, NEW.rejected_at, NEW.rejection_reason) THEN
    RAISE EXCEPTION 'daily plan rejection decision is immutable';
  END IF;

  IF OLD.cancelled_at IS NOT NULL
    AND ROW(OLD.cancelled_by, OLD.cancelled_at, OLD.cancellation_reason)
      IS DISTINCT FROM ROW(NEW.cancelled_by, NEW.cancelled_at, NEW.cancellation_reason) THEN
    RAISE EXCEPTION 'daily plan cancellation decision is immutable';
  END IF;

  IF NEW.state <> 'DRAFT' AND ROW(
    OLD.id,
    OLD.representative_id,
    OLD.plan_date,
    OLD.generation_mode,
    OLD.cutoff_at,
    OLD.ruleset_version,
    OLD.source_snapshot,
    OLD.input_fingerprint,
    OLD.created_by,
    OLD.created_at,
    OLD.idempotency_key
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.representative_id,
    NEW.plan_date,
    NEW.generation_mode,
    NEW.cutoff_at,
    NEW.ruleset_version,
    NEW.source_snapshot,
    NEW.input_fingerprint,
    NEW.created_by,
    NEW.created_at,
    NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'submitted daily plan source and identity are immutable';
  END IF;

  IF NEW.state = 'PENDING_APPROVAL' AND OLD.state = 'DRAFT' THEN
    SELECT COUNT(*) INTO item_count
    FROM daily_plan_items
    WHERE plan_id = OLD.id;
    IF item_count = 0 THEN
      RAISE EXCEPTION 'daily plan cannot be submitted without items';
    END IF;
  END IF;

  IF NEW.state = 'APPROVED' AND OLD.state = 'PENDING_APPROVAL' THEN
    IF NEW.approved_by = NEW.submitted_by
      AND NOT is_single_manager_actor(NEW.approved_by) THEN
      RAISE EXCEPTION 'daily plan submitter cannot approve the same plan';
    END IF;
  END IF;

  IF NEW.state = 'IN_PROGRESS' AND NEW.plan_date <> (now() AT TIME ZONE 'Asia/Aden')::date THEN
    RAISE EXCEPTION 'daily plan may start only on its plan date';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_plans_validate
BEFORE INSERT OR UPDATE ON daily_plans
FOR EACH ROW EXECUTE FUNCTION validate_daily_plan();

CREATE TRIGGER daily_plans_prevent_delete
BEFORE DELETE ON daily_plans
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_daily_plan_candidate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record daily_plans%ROWTYPE;
  promise_customer_id uuid;
BEGIN
  SELECT * INTO plan_record FROM daily_plans WHERE id = NEW.plan_id;
  IF plan_record.id IS NULL OR plan_record.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'daily plan candidates may be created only for a draft plan';
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

CREATE TRIGGER daily_plan_candidates_validate
BEFORE INSERT ON daily_plan_candidates
FOR EACH ROW EXECUTE FUNCTION validate_daily_plan_candidate();

CREATE TRIGGER daily_plan_candidates_prevent_update
BEFORE UPDATE ON daily_plan_candidates
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE TRIGGER daily_plan_candidates_prevent_delete
BEFORE DELETE ON daily_plan_candidates
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_daily_plan_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record daily_plans%ROWTYPE;
  promise_customer_id uuid;
  route_area_id uuid;
BEGIN
  SELECT * INTO plan_record FROM daily_plans WHERE id = NEW.plan_id;
  IF plan_record.id IS NULL OR plan_record.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'daily plan items may change only while the plan is DRAFT';
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

CREATE TRIGGER daily_plan_items_validate
BEFORE INSERT OR UPDATE ON daily_plan_items
FOR EACH ROW EXECUTE FUNCTION validate_daily_plan_item();

CREATE OR REPLACE FUNCTION prevent_submitted_plan_item_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  plan_state text;
BEGIN
  SELECT state INTO plan_state FROM daily_plans WHERE id = OLD.plan_id;
  IF plan_state <> 'DRAFT' THEN
    RAISE EXCEPTION 'daily plan items cannot be deleted after submission';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER daily_plan_items_delete_guard
BEFORE DELETE ON daily_plan_items
FOR EACH ROW EXECUTE FUNCTION prevent_submitted_plan_item_delete();

CREATE TRIGGER daily_plan_adjustments_prevent_update
BEFORE UPDATE ON daily_plan_adjustments
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE TRIGGER daily_plan_adjustments_prevent_delete
BEFORE DELETE ON daily_plan_adjustments
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE TRIGGER daily_plan_events_prevent_update
BEFORE UPDATE ON daily_plan_events
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

CREATE TRIGGER daily_plan_events_prevent_delete
BEFORE DELETE ON daily_plan_events
FOR EACH ROW EXECUTE FUNCTION prevent_daily_plan_append_only_mutation();

COMMIT;
