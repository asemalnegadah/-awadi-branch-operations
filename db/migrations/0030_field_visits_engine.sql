BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('visits.read_own', 'visits', 'read_own', 'عرض المندوب لزياراته ونتائج تنفيذ خطته.'),
  ('visits.read_all', 'visits', 'read_all', 'عرض جميع زيارات المندوبين ونتائجها.'),
  ('visits.create', 'visits', 'create', 'إنشاء زيارة ميدانية وتسجيل الوصول والمغادرة.'),
  ('visits.manage', 'visits', 'manage', 'إدارة نتائج الزيارة ومرفقاتها قبل الإرسال.'),
  ('visits.verify', 'visits', 'verify', 'التحقق من الزيارة أو إعادتها بسبب موثق.'),
  ('visits.view_history', 'visits', 'view_history', 'عرض سجل أحداث الزيارة ونتائج عنصر الخطة.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.resource = 'visits'
WHERE role.code = 'BRANCH_MANAGER'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN ('visits.read_all', 'visits.view_history')
WHERE role.code IN ('OWNER_AUDITOR', 'AUDITOR')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission
  ON permission.code IN (
    'visits.read_own',
    'visits.create',
    'visits.manage',
    'visits.view_history'
  )
WHERE role.code = 'SALES_REP'
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE TABLE field_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES daily_plans(id) ON DELETE RESTRICT,
  plan_item_id uuid REFERENCES daily_plan_items(id) ON DELETE RESTRICT,
  visit_source text NOT NULL CHECK (visit_source IN ('PLAN', 'OUT_OF_PLAN')),
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT',
    'CHECKED_IN',
    'CHECKED_OUT',
    'SUBMITTED',
    'VERIFIED',
    'RETURNED',
    'CANCELLED'
  )),
  visit_type text NOT NULL CHECK (visit_type IN (
    'COLLECTION',
    'SALES',
    'PROMISE_FOLLOWUP',
    'RECONCILIATION',
    'DATA_UPDATE',
    'PROBLEM_RESOLUTION',
    'MIXED'
  )),
  objective text NOT NULL CHECK (NULLIF(btrim(objective), '') IS NOT NULL),
  declared_result text CHECK (declared_result IN ('SUCCESS', 'PARTIAL', 'FAILED', 'NO_CONTACT')),
  outcome_summary text,
  arrived_at timestamptz,
  departed_at timestamptz,
  device_arrived_at timestamptz,
  device_departed_at timestamptz,
  checkin_latitude numeric(9, 6) CHECK (checkin_latitude BETWEEN -90 AND 90),
  checkin_longitude numeric(9, 6) CHECK (checkin_longitude BETWEEN -180 AND 180),
  checkin_accuracy_meters numeric(9, 2) CHECK (checkin_accuracy_meters IS NULL OR checkin_accuracy_meters >= 0),
  checkout_latitude numeric(9, 6) CHECK (checkout_latitude BETWEEN -90 AND 90),
  checkout_longitude numeric(9, 6) CHECK (checkout_longitude BETWEEN -180 AND 180),
  checkout_accuracy_meters numeric(9, 2) CHECK (checkout_accuracy_meters IS NULL OR checkout_accuracy_meters >= 0),
  sync_status text NOT NULL DEFAULT 'ONLINE' CHECK (sync_status IN ('ONLINE', 'PENDING_UPLOAD', 'SYNCED', 'CONFLICT')),
  sync_received_at timestamptz,
  out_of_plan_reason text,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  verified_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  cancellation_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_visit_plan_link_shape CHECK (
    (visit_source = 'PLAN' AND plan_id IS NOT NULL AND plan_item_id IS NOT NULL AND out_of_plan_reason IS NULL)
    OR
    (visit_source = 'OUT_OF_PLAN' AND plan_id IS NULL AND plan_item_id IS NULL
      AND NULLIF(btrim(out_of_plan_reason), '') IS NOT NULL)
  ),
  CONSTRAINT field_visit_device_time_shape CHECK (
    device_departed_at IS NULL
    OR (device_arrived_at IS NOT NULL AND device_departed_at >= device_arrived_at)
  ),
  CONSTRAINT field_visit_server_time_shape CHECK (
    departed_at IS NULL OR (arrived_at IS NOT NULL AND departed_at >= arrived_at)
  ),
  CONSTRAINT field_visit_state_shape CHECK (
    (state = 'DRAFT'
      AND arrived_at IS NULL AND departed_at IS NULL
      AND declared_result IS NULL AND outcome_summary IS NULL
      AND submitted_by IS NULL AND submitted_at IS NULL
      AND verified_by IS NULL AND verified_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'CHECKED_IN'
      AND arrived_at IS NOT NULL AND departed_at IS NULL
      AND declared_result IS NULL AND outcome_summary IS NULL
      AND submitted_by IS NULL AND submitted_at IS NULL
      AND verified_by IS NULL AND verified_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'CHECKED_OUT'
      AND arrived_at IS NOT NULL AND departed_at IS NOT NULL
      AND declared_result IS NULL
      AND submitted_by IS NULL AND submitted_at IS NULL
      AND verified_by IS NULL AND verified_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state IN ('SUBMITTED', 'RETURNED')
      AND arrived_at IS NOT NULL AND departed_at IS NOT NULL
      AND declared_result IS NOT NULL
      AND NULLIF(btrim(outcome_summary), '') IS NOT NULL
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND verified_by IS NULL AND verified_at IS NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'VERIFIED'
      AND arrived_at IS NOT NULL AND departed_at IS NOT NULL
      AND declared_result IS NOT NULL
      AND NULLIF(btrim(outcome_summary), '') IS NOT NULL
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND verified_by IS NOT NULL AND verified_at IS NOT NULL
      AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR
    (state = 'CANCELLED'
      AND verified_by IS NULL AND verified_at IS NULL
      AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
      AND NULLIF(btrim(cancellation_reason), '') IS NOT NULL)
  )
);

CREATE INDEX field_visits_rep_date_idx
  ON field_visits (representative_id, arrived_at DESC NULLS LAST, created_at DESC, id DESC);

CREATE INDEX field_visits_customer_idx
  ON field_visits (customer_id, created_at DESC, id DESC);

CREATE INDEX field_visits_plan_item_idx
  ON field_visits (plan_item_id, state, created_at DESC)
  WHERE plan_item_id IS NOT NULL;

CREATE INDEX field_visits_verification_queue_idx
  ON field_visits (state, submitted_at, id)
  WHERE state IN ('SUBMITTED', 'RETURNED');

CREATE TABLE field_visit_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES field_visits(id) ON DELETE RESTRICT,
  outcome_type text NOT NULL CHECK (outcome_type IN (
    'COLLECTION',
    'SALES_ORDER',
    'PAYMENT_PROMISE',
    'RECONCILIATION',
    'CUSTOMER_DATA_UPDATE',
    'PROBLEM_RESOLUTION',
    'NO_RESULT'
  )),
  collection_id uuid REFERENCES collections(id) ON DELETE RESTRICT,
  promise_id uuid REFERENCES payment_promises(id) ON DELETE RESTRICT,
  reference_id text,
  currency_code text REFERENCES currencies(code) ON DELETE RESTRICT
    CHECK (currency_code IS NULL OR currency_code IN ('SR', 'RG')),
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor > 0),
  summary text NOT NULL CHECK (NULLIF(btrim(summary), '') IS NOT NULL),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  qualifies_success boolean GENERATED ALWAYS AS (
    outcome_type IN (
      'COLLECTION',
      'SALES_ORDER',
      'PAYMENT_PROMISE',
      'RECONCILIATION',
      'CUSTOMER_DATA_UPDATE',
      'PROBLEM_RESOLUTION'
    )
  ) STORED,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT field_visit_outcome_reference_shape CHECK (
    (outcome_type = 'COLLECTION' AND collection_id IS NOT NULL AND promise_id IS NULL)
    OR
    (outcome_type = 'PAYMENT_PROMISE' AND promise_id IS NOT NULL AND collection_id IS NULL)
    OR
    (outcome_type NOT IN ('COLLECTION', 'PAYMENT_PROMISE')
      AND collection_id IS NULL AND promise_id IS NULL)
  ),
  CONSTRAINT field_visit_outcome_amount_shape CHECK (
    (currency_code IS NULL AND amount_minor IS NULL)
    OR
    (currency_code IS NOT NULL AND amount_minor IS NOT NULL)
  ),
  CONSTRAINT field_visit_no_result_shape CHECK (
    outcome_type <> 'NO_RESULT'
    OR (reference_id IS NULL AND currency_code IS NULL AND amount_minor IS NULL)
  )
);

CREATE UNIQUE INDEX field_visit_outcome_collection_once
  ON field_visit_outcomes (visit_id, collection_id)
  WHERE collection_id IS NOT NULL;

CREATE UNIQUE INDEX field_visit_outcome_promise_once
  ON field_visit_outcomes (visit_id, promise_id)
  WHERE promise_id IS NOT NULL;

CREATE INDEX field_visit_outcomes_visit_idx
  ON field_visit_outcomes (visit_id, recorded_at, id);

CREATE TABLE field_visit_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES field_visits(id) ON DELETE RESTRICT,
  uploaded_file_id uuid NOT NULL REFERENCES uploaded_files(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'RECEIPT',
    'CUSTOMER_LOCATION',
    'SHOP_FRONT',
    'DOCUMENT',
    'SIGNATURE',
    'OTHER'
  )),
  caption text,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  CONSTRAINT field_visit_evidence_unique_file UNIQUE (visit_id, uploaded_file_id)
);

CREATE INDEX field_visit_evidence_visit_idx
  ON field_visit_evidence (visit_id, recorded_at, id);

CREATE TABLE field_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES field_visits(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED',
    'CHECKED_IN',
    'CHECKED_OUT',
    'OUTCOME_ADDED',
    'EVIDENCE_ADDED',
    'SUBMITTED',
    'RETURNED',
    'VERIFIED',
    'CANCELLED'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(old_values) = 'object'),
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(new_values) = 'object'),
  reason text,
  idempotency_key text UNIQUE,
  CONSTRAINT field_visit_event_idempotency_nonempty CHECK (
    idempotency_key IS NULL OR NULLIF(btrim(idempotency_key), '') IS NOT NULL
  )
);

CREATE INDEX field_visit_events_history_idx
  ON field_visit_events (visit_id, occurred_at, id);

CREATE TABLE daily_plan_item_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id uuid NOT NULL REFERENCES daily_plan_items(id) ON DELETE RESTRICT,
  visit_id uuid REFERENCES field_visits(id) ON DELETE RESTRICT,
  result_type text NOT NULL CHECK (result_type IN (
    'VISITED_SUCCESS',
    'VISITED_PARTIAL',
    'VISITED_FAILED',
    'CUSTOMER_ABSENT',
    'REFUSED',
    'CLOSED',
    'NOT_FOUND',
    'RESCHEDULED',
    'SKIPPED',
    'OTHER'
  )),
  reason text NOT NULL CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  next_action_at timestamptz,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (NULLIF(btrim(idempotency_key), '') IS NOT NULL),
  supersedes_result_id uuid UNIQUE REFERENCES daily_plan_item_results(id) ON DELETE RESTRICT,
  CONSTRAINT daily_plan_item_result_visit_shape CHECK (
    (result_type IN ('VISITED_SUCCESS', 'VISITED_PARTIAL', 'VISITED_FAILED') AND visit_id IS NOT NULL)
    OR
    (result_type NOT IN ('VISITED_SUCCESS', 'VISITED_PARTIAL', 'VISITED_FAILED') AND visit_id IS NULL)
  ),
  CONSTRAINT daily_plan_item_result_next_action_shape CHECK (
    result_type NOT IN ('RESCHEDULED', 'CUSTOMER_ABSENT', 'REFUSED') OR next_action_at IS NOT NULL
  )
);

CREATE INDEX daily_plan_item_results_history_idx
  ON daily_plan_item_results (plan_item_id, recorded_at, id);

CREATE VIEW current_daily_plan_item_results AS
SELECT result.*
FROM daily_plan_item_results AS result
WHERE NOT EXISTS (
  SELECT 1
  FROM daily_plan_item_results AS newer
  WHERE newer.supersedes_result_id = result.id
);

CREATE VIEW field_visit_summaries AS
SELECT
  visit.id AS visit_id,
  COUNT(outcome.id)::integer AS outcome_count,
  COUNT(outcome.id) FILTER (WHERE outcome.qualifies_success)::integer AS qualifying_outcome_count,
  COUNT(evidence.id)::integer AS evidence_count,
  EXISTS (
    SELECT 1
    FROM field_visit_outcomes AS qualifying
    WHERE qualifying.visit_id = visit.id
      AND qualifying.qualifies_success = true
  ) AS has_qualifying_outcome
FROM field_visits AS visit
LEFT JOIN field_visit_outcomes AS outcome ON outcome.visit_id = visit.id
LEFT JOIN field_visit_evidence AS evidence ON evidence.visit_id = visit.id
GROUP BY visit.id;

CREATE OR REPLACE FUNCTION prevent_field_visit_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION field_visit_actor_is_branch_manager(actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles AS user_role
    JOIN roles AS role ON role.id = user_role.role_id
    WHERE user_role.user_id = actor_id
      AND role.code = 'BRANCH_MANAGER'
      AND user_role.revoked_at IS NULL
      AND user_role.valid_from <= now()
      AND (user_role.valid_until IS NULL OR user_role.valid_until > now())
  );
$$;

CREATE OR REPLACE FUNCTION validate_field_visit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  representative_active boolean;
  customer_active boolean;
  plan_record daily_plans%ROWTYPE;
  item_record daily_plan_items%ROWTYPE;
  allowed_transition boolean;
  qualifying_count integer;
BEGIN
  SELECT status = 'ACTIVE' AND deleted_at IS NULL
  INTO representative_active
  FROM sales_representatives
  WHERE id = NEW.representative_id;

  SELECT deleted_at IS NULL AND merged_into_customer_id IS NULL
  INTO customer_active
  FROM customers
  WHERE id = NEW.customer_id;

  IF representative_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'field visit requires an active representative';
  END IF;
  IF customer_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'field visit requires an active customer';
  END IF;

  IF NEW.visit_source = 'PLAN' THEN
    SELECT * INTO plan_record FROM daily_plans WHERE id = NEW.plan_id;
    SELECT * INTO item_record FROM daily_plan_items WHERE id = NEW.plan_item_id;
    IF plan_record.id IS NULL OR item_record.id IS NULL OR item_record.plan_id <> plan_record.id THEN
      RAISE EXCEPTION 'field visit plan item does not belong to the supplied plan';
    END IF;
    IF plan_record.representative_id <> NEW.representative_id
      OR item_record.customer_id <> NEW.customer_id THEN
      RAISE EXCEPTION 'field visit representative or customer does not match the plan item';
    END IF;
    IF plan_record.state NOT IN ('APPROVED', 'IN_PROGRESS') THEN
      RAISE EXCEPTION 'planned field visit requires an approved or in-progress plan';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'new field visit must start as DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(OLD.id, OLD.representative_id, OLD.customer_id, OLD.plan_id, OLD.plan_item_id,
         OLD.visit_source, OLD.created_by, OLD.created_at, OLD.idempotency_key)
    IS DISTINCT FROM
     ROW(NEW.id, NEW.representative_id, NEW.customer_id, NEW.plan_id, NEW.plan_item_id,
         NEW.visit_source, NEW.created_by, NEW.created_at, NEW.idempotency_key) THEN
    RAISE EXCEPTION 'field visit identity and source are immutable';
  END IF;

  IF OLD.arrived_at IS NOT NULL AND ROW(OLD.arrived_at, OLD.checkin_latitude,
      OLD.checkin_longitude, OLD.checkin_accuracy_meters)
    IS DISTINCT FROM ROW(NEW.arrived_at, NEW.checkin_latitude,
      NEW.checkin_longitude, NEW.checkin_accuracy_meters) THEN
    RAISE EXCEPTION 'field visit check-in is immutable after recording';
  END IF;

  IF OLD.departed_at IS NOT NULL AND ROW(OLD.departed_at, OLD.checkout_latitude,
      OLD.checkout_longitude, OLD.checkout_accuracy_meters)
    IS DISTINCT FROM ROW(NEW.departed_at, NEW.checkout_latitude,
      NEW.checkout_longitude, NEW.checkout_accuracy_meters) THEN
    RAISE EXCEPTION 'field visit check-out is immutable after recording';
  END IF;

  IF OLD.submitted_at IS NOT NULL
    AND ROW(OLD.submitted_by, OLD.submitted_at)
      IS DISTINCT FROM ROW(NEW.submitted_by, NEW.submitted_at) THEN
    RAISE EXCEPTION 'field visit first submission actor is immutable';
  END IF;

  IF OLD.verified_at IS NOT NULL
    AND ROW(OLD.verified_by, OLD.verified_at)
      IS DISTINCT FROM ROW(NEW.verified_by, NEW.verified_at) THEN
    RAISE EXCEPTION 'field visit verification actor is immutable';
  END IF;

  allowed_transition :=
    (OLD.state = 'DRAFT' AND NEW.state IN ('DRAFT', 'CHECKED_IN', 'CANCELLED'))
    OR (OLD.state = 'CHECKED_IN' AND NEW.state IN ('CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'))
    OR (OLD.state = 'CHECKED_OUT' AND NEW.state IN ('CHECKED_OUT', 'SUBMITTED', 'CANCELLED'))
    OR (OLD.state = 'SUBMITTED' AND NEW.state IN ('VERIFIED', 'RETURNED'))
    OR (OLD.state = 'RETURNED' AND NEW.state IN ('RETURNED', 'SUBMITTED', 'CANCELLED'));

  IF NOT allowed_transition THEN
    RAISE EXCEPTION 'invalid field visit transition: % -> %', OLD.state, NEW.state;
  END IF;

  IF NEW.state = 'SUBMITTED' AND OLD.state IN ('CHECKED_OUT', 'RETURNED') THEN
    SELECT COUNT(*) INTO qualifying_count
    FROM field_visit_outcomes
    WHERE visit_id = OLD.id
      AND qualifies_success = true;

    IF NEW.declared_result = 'SUCCESS' AND qualifying_count = 0 THEN
      RAISE EXCEPTION 'successful field visit requires at least one qualifying outcome';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM field_visit_outcomes WHERE visit_id = OLD.id) THEN
      RAISE EXCEPTION 'field visit cannot be submitted without a recorded outcome';
    END IF;
  END IF;

  IF NEW.state = 'VERIFIED' AND NEW.visit_source = 'OUT_OF_PLAN'
    AND NOT field_visit_actor_is_branch_manager(NEW.verified_by) THEN
    RAISE EXCEPTION 'out-of-plan field visit must be verified by a branch manager';
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER field_visits_validate
BEFORE INSERT OR UPDATE ON field_visits
FOR EACH ROW EXECUTE FUNCTION validate_field_visit();

CREATE TRIGGER field_visits_prevent_delete
BEFORE DELETE ON field_visits
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_field_visit_outcome()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  visit_record field_visits%ROWTYPE;
  collection_record collections%ROWTYPE;
  promise_record payment_promises%ROWTYPE;
BEGIN
  SELECT * INTO visit_record FROM field_visits WHERE id = NEW.visit_id;
  IF visit_record.id IS NULL OR visit_record.state NOT IN ('CHECKED_IN', 'CHECKED_OUT', 'RETURNED') THEN
    RAISE EXCEPTION 'field visit outcomes may be added only before submission or after return';
  END IF;

  IF NEW.outcome_type = 'COLLECTION' THEN
    SELECT * INTO collection_record FROM collections WHERE id = NEW.collection_id;
    IF collection_record.id IS NULL
      OR collection_record.customer_id <> visit_record.customer_id
      OR collection_record.representative_id <> visit_record.representative_id
      OR collection_record.state IN ('REJECTED', 'REVERSED') THEN
      RAISE EXCEPTION 'collection outcome does not match the field visit or is inactive';
    END IF;
    NEW.currency_code := collection_record.currency_code;
    NEW.amount_minor := collection_record.amount_minor;
    NEW.reference_id := collection_record.id::text;
  ELSIF NEW.outcome_type = 'PAYMENT_PROMISE' THEN
    SELECT * INTO promise_record FROM payment_promises WHERE id = NEW.promise_id;
    IF promise_record.id IS NULL
      OR promise_record.customer_id <> visit_record.customer_id
      OR promise_record.representative_id <> visit_record.representative_id
      OR promise_record.base_status IN ('REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'promise outcome does not match the field visit or is inactive';
    END IF;
    NEW.currency_code := promise_record.currency_code;
    NEW.amount_minor := promise_record.promised_amount_minor;
    NEW.reference_id := promise_record.id::text;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER field_visit_outcomes_validate
BEFORE INSERT ON field_visit_outcomes
FOR EACH ROW EXECUTE FUNCTION validate_field_visit_outcome();

CREATE TRIGGER field_visit_outcomes_prevent_update
BEFORE UPDATE ON field_visit_outcomes
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE TRIGGER field_visit_outcomes_prevent_delete
BEFORE DELETE ON field_visit_outcomes
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_field_visit_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  visit_state text;
  file_record uploaded_files%ROWTYPE;
BEGIN
  SELECT state INTO visit_state FROM field_visits WHERE id = NEW.visit_id;
  IF visit_state IS NULL OR visit_state NOT IN ('CHECKED_IN', 'CHECKED_OUT', 'RETURNED') THEN
    RAISE EXCEPTION 'field visit evidence may be added only before submission or after return';
  END IF;

  SELECT * INTO file_record FROM uploaded_files WHERE id = NEW.uploaded_file_id;
  IF file_record.id IS NULL
    OR file_record.status IN ('REJECTED', 'FAILED')
    OR file_record.media_type NOT IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp') THEN
    RAISE EXCEPTION 'field visit evidence file is missing, invalid, or unsupported';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER field_visit_evidence_validate
BEFORE INSERT ON field_visit_evidence
FOR EACH ROW EXECUTE FUNCTION validate_field_visit_evidence();

CREATE TRIGGER field_visit_evidence_prevent_update
BEFORE UPDATE ON field_visit_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE TRIGGER field_visit_evidence_prevent_delete
BEFORE DELETE ON field_visit_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE TRIGGER field_visit_events_prevent_update
BEFORE UPDATE ON field_visit_events
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE TRIGGER field_visit_events_prevent_delete
BEFORE DELETE ON field_visit_events
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_daily_plan_item_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_record daily_plan_items%ROWTYPE;
  plan_record daily_plans%ROWTYPE;
  visit_record field_visits%ROWTYPE;
  superseded_record daily_plan_item_results%ROWTYPE;
BEGIN
  SELECT * INTO item_record FROM daily_plan_items WHERE id = NEW.plan_item_id FOR UPDATE;
  SELECT * INTO plan_record FROM daily_plans WHERE id = item_record.plan_id;
  IF item_record.id IS NULL OR plan_record.id IS NULL OR plan_record.state <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'daily plan item result requires an in-progress plan';
  END IF;

  IF NEW.visit_id IS NOT NULL THEN
    SELECT * INTO visit_record FROM field_visits WHERE id = NEW.visit_id;
    IF visit_record.id IS NULL
      OR visit_record.plan_item_id <> NEW.plan_item_id
      OR visit_record.state NOT IN ('SUBMITTED', 'VERIFIED') THEN
      RAISE EXCEPTION 'daily plan item result visit is not a submitted visit for the item';
    END IF;
    IF NEW.result_type = 'VISITED_SUCCESS' AND visit_record.declared_result <> 'SUCCESS' THEN
      RAISE EXCEPTION 'visited-success item result requires a successful visit';
    END IF;
    IF NEW.result_type = 'VISITED_PARTIAL' AND visit_record.declared_result <> 'PARTIAL' THEN
      RAISE EXCEPTION 'visited-partial item result requires a partial visit';
    END IF;
    IF NEW.result_type = 'VISITED_FAILED'
      AND visit_record.declared_result NOT IN ('FAILED', 'NO_CONTACT') THEN
      RAISE EXCEPTION 'visited-failed item result requires a failed or no-contact visit';
    END IF;
  END IF;

  IF NEW.supersedes_result_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM current_daily_plan_item_results
      WHERE plan_item_id = NEW.plan_item_id
    ) THEN
      RAISE EXCEPTION 'daily plan item already has a current result';
    END IF;
  ELSE
    SELECT * INTO superseded_record
    FROM current_daily_plan_item_results
    WHERE id = NEW.supersedes_result_id;
    IF superseded_record.id IS NULL OR superseded_record.plan_item_id <> NEW.plan_item_id THEN
      RAISE EXCEPTION 'superseded daily plan item result is not the current result for this item';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_plan_item_results_validate
BEFORE INSERT ON daily_plan_item_results
FOR EACH ROW EXECUTE FUNCTION validate_daily_plan_item_result();

CREATE TRIGGER daily_plan_item_results_prevent_update
BEFORE UPDATE ON daily_plan_item_results
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE TRIGGER daily_plan_item_results_prevent_delete
BEFORE DELETE ON daily_plan_item_results
FOR EACH ROW EXECUTE FUNCTION prevent_field_visit_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_daily_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  representative_active boolean;
  allowed_transition boolean;
  item_count integer;
  unresolved_item_count integer;
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
    OLD.id, OLD.representative_id, OLD.plan_date, OLD.generation_mode,
    OLD.cutoff_at, OLD.ruleset_version, OLD.source_snapshot,
    OLD.input_fingerprint, OLD.created_by, OLD.created_at, OLD.idempotency_key
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.representative_id, NEW.plan_date, NEW.generation_mode,
    NEW.cutoff_at, NEW.ruleset_version, NEW.source_snapshot,
    NEW.input_fingerprint, NEW.created_by, NEW.created_at, NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'submitted daily plan source and identity are immutable';
  END IF;

  IF NEW.state = 'PENDING_APPROVAL' AND OLD.state = 'DRAFT' THEN
    SELECT COUNT(*) INTO item_count FROM daily_plan_items WHERE plan_id = OLD.id;
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

  IF NEW.state = 'COMPLETED' AND OLD.state = 'IN_PROGRESS' THEN
    SELECT COUNT(*) INTO unresolved_item_count
    FROM daily_plan_items AS item
    LEFT JOIN current_daily_plan_item_results AS result
      ON result.plan_item_id = item.id
    WHERE item.plan_id = OLD.id
      AND result.id IS NULL;
    IF unresolved_item_count > 0 THEN
      RAISE EXCEPTION 'daily plan cannot be completed while items lack execution results';
    END IF;
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
