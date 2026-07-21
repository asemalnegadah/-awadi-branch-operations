BEGIN;

CREATE OR REPLACE FUNCTION protect_credit_restriction_workflow_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL
    AND ROW(OLD.submitted_by, OLD.submitted_at)
      IS DISTINCT FROM ROW(NEW.submitted_by, NEW.submitted_at) THEN
    RAISE EXCEPTION 'credit restriction submission actor is immutable';
  END IF;

  IF OLD.approved_at IS NOT NULL
    AND ROW(OLD.approved_by, OLD.approved_at)
      IS DISTINCT FROM ROW(NEW.approved_by, NEW.approved_at) THEN
    RAISE EXCEPTION 'credit restriction approval actor is immutable';
  END IF;

  IF OLD.rejected_at IS NOT NULL
    AND ROW(OLD.rejected_by, OLD.rejected_at, OLD.rejection_reason)
      IS DISTINCT FROM ROW(NEW.rejected_by, NEW.rejected_at, NEW.rejection_reason) THEN
    RAISE EXCEPTION 'credit restriction rejection decision is immutable';
  END IF;

  IF OLD.revoked_at IS NOT NULL
    AND ROW(OLD.revoked_by, OLD.revoked_at, OLD.revocation_reason)
      IS DISTINCT FROM ROW(NEW.revoked_by, NEW.revoked_at, NEW.revocation_reason) THEN
    RAISE EXCEPTION 'credit restriction revocation decision is immutable';
  END IF;

  IF OLD.state = 'ACTIVE'
    AND NEW.state IN ('REVOKED', 'EXPIRED')
    AND EXISTS (
      SELECT 1
      FROM credit_exceptions AS exception
      WHERE exception.restriction_id = OLD.id
        AND exception.state = 'ACTIVE'
    ) THEN
    RAISE EXCEPTION 'active credit exceptions must be revoked or expired before ending the restriction';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER a_credit_restrictions_protect_workflow_history
BEFORE UPDATE ON credit_restrictions
FOR EACH ROW EXECUTE FUNCTION protect_credit_restriction_workflow_history();

CREATE OR REPLACE FUNCTION protect_credit_exception_workflow_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL
    AND ROW(OLD.submitted_by, OLD.submitted_at)
      IS DISTINCT FROM ROW(NEW.submitted_by, NEW.submitted_at) THEN
    RAISE EXCEPTION 'credit exception submission actor is immutable';
  END IF;

  IF OLD.approved_at IS NOT NULL
    AND ROW(OLD.approved_by, OLD.approved_at)
      IS DISTINCT FROM ROW(NEW.approved_by, NEW.approved_at) THEN
    RAISE EXCEPTION 'credit exception approval actor is immutable';
  END IF;

  IF OLD.rejected_at IS NOT NULL
    AND ROW(OLD.rejected_by, OLD.rejected_at, OLD.rejection_reason)
      IS DISTINCT FROM ROW(NEW.rejected_by, NEW.rejected_at, NEW.rejection_reason) THEN
    RAISE EXCEPTION 'credit exception rejection decision is immutable';
  END IF;

  IF OLD.revoked_at IS NOT NULL
    AND ROW(OLD.revoked_by, OLD.revoked_at, OLD.revocation_reason)
      IS DISTINCT FROM ROW(NEW.revoked_by, NEW.revoked_at, NEW.revocation_reason) THEN
    RAISE EXCEPTION 'credit exception revocation decision is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER a_credit_exceptions_protect_workflow_history
BEFORE UPDATE ON credit_exceptions
FOR EACH ROW EXECUTE FUNCTION protect_credit_exception_workflow_history();

COMMIT;
