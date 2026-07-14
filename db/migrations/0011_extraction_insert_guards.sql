BEGIN;

CREATE OR REPLACE FUNCTION validate_report_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.snapshot_status NOT IN ('CANDIDATE', 'CONFLICT') THEN
    RAISE EXCEPTION 'new report snapshot must start as CANDIDATE or CONFLICT';
  END IF;

  IF NEW.reviewed_at IS NOT NULL
    OR NEW.reviewed_by IS NOT NULL
    OR NEW.review_note IS NOT NULL THEN
    RAISE EXCEPTION 'new report snapshot cannot be pre-reviewed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER report_snapshots_validate_insert_lifecycle
BEFORE INSERT ON report_snapshots
FOR EACH ROW EXECUTE FUNCTION validate_report_snapshot_insert();

CREATE OR REPLACE FUNCTION validate_extracted_row_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.review_decision IS NOT NULL
    OR NEW.reviewed_at IS NOT NULL
    OR NEW.reviewed_by IS NOT NULL
    OR NEW.correction_data IS NOT NULL THEN
    RAISE EXCEPTION 'new extracted row cannot be pre-reviewed';
  END IF;

  IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL THEN
    RAISE EXCEPTION 'new extracted row cannot be pre-approved';
  END IF;

  IF NEW.committed_at IS NOT NULL
    OR NEW.committed_by IS NOT NULL
    OR NEW.target_record_type IS NOT NULL
    OR NEW.target_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'new extracted row cannot be pre-committed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER extracted_rows_validate_insert_lifecycle
BEFORE INSERT ON extracted_rows
FOR EACH ROW EXECUTE FUNCTION validate_extracted_row_insert();

COMMIT;
