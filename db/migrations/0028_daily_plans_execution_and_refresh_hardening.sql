BEGIN;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES (
  'plans.execute',
  'plans',
  'execute',
  'بدء الخطة اليومية المكلف بها وإكمالها أو إلغاؤها بسبب موثق.'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.code = 'plans.execute'
WHERE role.code IN ('BRANCH_MANAGER', 'SALES_REP')
ON CONFLICT (role_id, permission_id) DO NOTHING;

ALTER TABLE daily_plans
  ADD CONSTRAINT daily_plan_started_pair_shape CHECK (
    (started_by IS NULL AND started_at IS NULL)
    OR
    (started_by IS NOT NULL AND started_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION refresh_daily_plan_totals_after_item_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_plan_id uuid;
  plan_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_plan_id := OLD.plan_id;
  ELSE
    target_plan_id := NEW.plan_id;
  END IF;

  SELECT state INTO plan_state
  FROM daily_plans
  WHERE id = target_plan_id;

  IF plan_state = 'DRAFT' THEN
    UPDATE daily_plans
    SET updated_at = now()
    WHERE id = target_plan_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
