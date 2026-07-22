BEGIN;

CREATE TABLE reconciliation_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliation_cases(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN (
    'SUBMIT', 'REVIEW', 'REQUEST_APPROVAL', 'APPROVE',
    'RETURN', 'REJECT', 'SETTLE'
  )),
  canonical_payload jsonb NOT NULL,
  result_state text NOT NULL CHECK (result_state IN (
    'PENDING_REVIEW', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED',
    'RETURNED', 'REJECTED', 'MATCHED', 'SETTLED'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_id uuid NOT NULL
);

CREATE INDEX reconciliation_commands_case_time_idx
  ON reconciliation_commands (reconciliation_id, occurred_at, id);

CREATE TRIGGER reconciliation_commands_immutable
BEFORE UPDATE OR DELETE ON reconciliation_commands
FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_append_only_mutation();

COMMIT;
