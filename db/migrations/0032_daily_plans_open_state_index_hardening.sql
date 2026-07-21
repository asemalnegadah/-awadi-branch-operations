BEGIN;

DROP INDEX daily_plans_one_open_per_rep_date;

CREATE UNIQUE INDEX daily_plans_one_open_per_rep_date
  ON daily_plans (representative_id, plan_date)
  WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS');

COMMIT;
