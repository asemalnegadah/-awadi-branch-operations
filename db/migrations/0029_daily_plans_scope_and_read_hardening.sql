BEGIN;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles AS role
JOIN permissions AS permission ON permission.code = 'plans.read_own'
WHERE role.code IN ('BRANCH_MANAGER', 'OWNER_AUDITOR', 'AUDITOR')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS daily_plans_rep_date_cursor_idx
  ON daily_plans (representative_id, plan_date DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_overlapping_customer_rep_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM customer_rep_assignments AS existing
    WHERE existing.customer_id = NEW.customer_id
      AND existing.representative_id = NEW.representative_id
      AND existing.id <> NEW.id
      AND tstzrange(
        existing.valid_from,
        COALESCE(existing.valid_until, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        NEW.valid_from,
        COALESCE(NEW.valid_until, 'infinity'::timestamptz),
        '[)'
      )
  ) THEN
    RAISE EXCEPTION 'customer representative assignment period overlaps an existing assignment';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_rep_assignments_prevent_overlap
BEFORE INSERT OR UPDATE OF customer_id, representative_id, valid_from, valid_until
ON customer_rep_assignments
FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_customer_rep_assignment();

COMMIT;
