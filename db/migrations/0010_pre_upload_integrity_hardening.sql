BEGIN;

DROP INDEX IF EXISTS user_roles_active_lookup;

CREATE UNIQUE INDEX user_roles_one_unrevoked_assignment
  ON user_roles (user_id, role_id)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION validate_collection_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state <> 'DRAFT' THEN
    RAISE EXCEPTION 'new collection must start in DRAFT state';
  END IF;

  IF NEW.version <> 1 THEN
    RAISE EXCEPTION 'new collection must start at version 1';
  END IF;

  IF ROW(
    NEW.reviewed_at,
    NEW.reviewed_by,
    NEW.approved_at,
    NEW.approved_by,
    NEW.cash_received_at,
    NEW.cash_received_by,
    NEW.ledger_entry_id,
    NEW.reconciled_at,
    NEW.reconciled_by,
    NEW.closed_at,
    NEW.closed_by,
    NEW.reversed_at,
    NEW.reversed_by,
    NEW.reversal_reason
  ) IS DISTINCT FROM ROW(
    NULL::timestamptz,
    NULL::uuid,
    NULL::timestamptz,
    NULL::uuid,
    NULL::timestamptz,
    NULL::uuid,
    NULL::uuid,
    NULL::timestamptz,
    NULL::uuid,
    NULL::timestamptz,
    NULL::uuid,
    NULL::timestamptz,
    NULL::uuid,
    NULL::text
  ) THEN
    RAISE EXCEPTION 'new collection cannot contain workflow completion fields';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collections_validate_insert_lifecycle
BEFORE INSERT ON collections
FOR EACH ROW EXECUTE FUNCTION validate_collection_insert();

CREATE OR REPLACE FUNCTION validate_uploaded_file_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'REGISTERED' THEN
    RAISE EXCEPTION 'new uploaded file must start in REGISTERED state';
  END IF;

  IF NEW.uploaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'registered file cannot have uploaded_at before upload completion';
  END IF;

  IF NEW.failure_code IS NOT NULL OR NEW.failure_message IS NOT NULL THEN
    RAISE EXCEPTION 'registered file cannot contain failure fields';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER uploaded_files_validate_insert_lifecycle
BEFORE INSERT ON uploaded_files
FOR EACH ROW EXECUTE FUNCTION validate_uploaded_file_insert();

CREATE OR REPLACE FUNCTION validate_uploaded_file_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.id,
    OLD.original_name,
    OLD.media_type,
    OLD.size_bytes,
    OLD.sha256,
    OLD.storage_provider,
    OLD.storage_key,
    OLD.uploaded_by,
    OLD.created_at,
    OLD.idempotency_key
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.original_name,
    NEW.media_type,
    NEW.size_bytes,
    NEW.sha256,
    NEW.storage_provider,
    NEW.storage_key,
    NEW.uploaded_by,
    NEW.created_at,
    NEW.idempotency_key
  ) THEN
    RAISE EXCEPTION 'uploaded file identity and storage metadata are immutable';
  END IF;

  IF OLD.status <> NEW.status
    AND NOT file_status_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid uploaded file status transition: % -> %', OLD.status, NEW.status;
  END IF;

  IF OLD.status IN (
    'EXTRACTED',
    'REVIEW_REQUIRED',
    'APPROVED',
    'COMMITTED',
    'REJECTED',
    'FAILED'
  ) AND ROW(
    OLD.document_type,
    OLD.page_count,
    OLD.source_system,
    OLD.document_period_start,
    OLD.document_period_end,
    OLD.data_as_of_date,
    OLD.report_generated_at,
    OLD.report_series_key,
    OLD.coverage_scope_type,
    OLD.coverage_scope_identifier,
    OLD.aging_scheme_code,
    OLD.metadata_confidence,
    OLD.metadata_source
  ) IS DISTINCT FROM ROW(
    NEW.document_type,
    NEW.page_count,
    NEW.source_system,
    NEW.document_period_start,
    NEW.document_period_end,
    NEW.data_as_of_date,
    NEW.report_generated_at,
    NEW.report_series_key,
    NEW.coverage_scope_type,
    NEW.coverage_scope_identifier,
    NEW.aging_scheme_code,
    NEW.metadata_confidence,
    NEW.metadata_source
  ) THEN
    RAISE EXCEPTION 'extracted file document and temporal metadata are immutable';
  END IF;

  IF NEW.status = 'UPLOADED' AND NEW.uploaded_at IS NULL THEN
    RAISE EXCEPTION 'uploaded file requires uploaded_at';
  END IF;

  IF NEW.status = 'FAILED' THEN
    IF NULLIF(btrim(NEW.failure_code), '') IS NULL THEN
      RAISE EXCEPTION 'failed file requires failure_code';
    END IF;
  ELSIF NEW.failure_code IS NOT NULL OR NEW.failure_message IS NOT NULL THEN
    RAISE EXCEPTION 'failure fields are only allowed for FAILED files';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION report_snapshot_transition_allowed(
  old_status text,
  new_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_status
    WHEN 'CANDIDATE' THEN new_status IN ('CURRENT', 'HISTORICAL', 'CONFLICT', 'REJECTED')
    WHEN 'CONFLICT' THEN new_status IN ('CURRENT', 'HISTORICAL', 'REJECTED')
    WHEN 'CURRENT' THEN new_status IN ('HISTORICAL')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION validate_report_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  file_record uploaded_files%ROWTYPE;
  superseded_record report_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO file_record
  FROM uploaded_files
  WHERE id = NEW.uploaded_file_id;

  IF file_record.id IS NULL THEN
    RAISE EXCEPTION 'uploaded report file does not exist';
  END IF;

  IF file_record.document_type <> NEW.report_type THEN
    RAISE EXCEPTION 'report snapshot type does not match uploaded file type';
  END IF;

  IF file_record.report_series_key IS DISTINCT FROM NEW.report_series_key
    OR file_record.document_period_start IS DISTINCT FROM NEW.period_start
    OR file_record.document_period_end IS DISTINCT FROM NEW.period_end
    OR file_record.data_as_of_date IS DISTINCT FROM NEW.as_of_date THEN
    RAISE EXCEPTION 'report snapshot temporal metadata does not match uploaded file';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.id,
      OLD.uploaded_file_id,
      OLD.report_type,
      OLD.report_series_key,
      OLD.period_start,
      OLD.period_end,
      OLD.as_of_date,
      OLD.generated_at,
      OLD.relation_to_current,
      OLD.supersedes_snapshot_id,
      OLD.metadata,
      OLD.created_at,
      OLD.created_by
    ) IS DISTINCT FROM ROW(
      NEW.id,
      NEW.uploaded_file_id,
      NEW.report_type,
      NEW.report_series_key,
      NEW.period_start,
      NEW.period_end,
      NEW.as_of_date,
      NEW.generated_at,
      NEW.relation_to_current,
      NEW.supersedes_snapshot_id,
      NEW.metadata,
      NEW.created_at,
      NEW.created_by
    ) THEN
      RAISE EXCEPTION 'report snapshot identity and source metadata are immutable';
    END IF;

    IF OLD.snapshot_status <> NEW.snapshot_status
      AND NOT report_snapshot_transition_allowed(
        OLD.snapshot_status,
        NEW.snapshot_status
      ) THEN
      RAISE EXCEPTION 'invalid report snapshot transition: % -> %',
        OLD.snapshot_status,
        NEW.snapshot_status;
    END IF;

    IF OLD.reviewed_at IS NOT NULL AND ROW(
      OLD.reviewed_at,
      OLD.reviewed_by,
      OLD.review_note
    ) IS DISTINCT FROM ROW(
      NEW.reviewed_at,
      NEW.reviewed_by,
      NEW.review_note
    ) THEN
      RAISE EXCEPTION 'report snapshot review fields cannot be replaced';
    END IF;
  END IF;

  IF NEW.supersedes_snapshot_id IS NOT NULL THEN
    SELECT * INTO superseded_record
    FROM report_snapshots
    WHERE id = NEW.supersedes_snapshot_id;

    IF superseded_record.id IS NULL THEN
      RAISE EXCEPTION 'superseded snapshot does not exist';
    END IF;

    IF superseded_record.report_series_key <> NEW.report_series_key THEN
      RAISE EXCEPTION 'new snapshot cannot supersede a different report series';
    END IF;

    IF superseded_record.as_of_date >= NEW.as_of_date THEN
      RAISE EXCEPTION 'new snapshot must have a later as-of date';
    END IF;
  END IF;

  IF NEW.snapshot_status = 'CURRENT'
    AND NEW.relation_to_current NOT IN ('FIRST_SNAPSHOT', 'NEWER_SNAPSHOT') THEN
    RAISE EXCEPTION 'only first or newer snapshots may become current';
  END IF;

  IF NEW.snapshot_status IN ('CURRENT', 'HISTORICAL', 'REJECTED')
    AND TG_OP = 'UPDATE'
    AND OLD.snapshot_status <> NEW.snapshot_status
    AND (NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL) THEN
    RAISE EXCEPTION 'resolved report snapshot requires reviewer and review time';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_extracted_row_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.id,
    OLD.extraction_id,
    OLD.row_index,
    OLD.source_page,
    OLD.source_line,
    OLD.row_type,
    OLD.raw_data,
    OLD.normalized_data,
    OLD.confidence,
    OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id,
    NEW.extraction_id,
    NEW.row_index,
    NEW.source_page,
    NEW.source_line,
    NEW.row_type,
    NEW.raw_data,
    NEW.normalized_data,
    NEW.confidence,
    NEW.created_at
  ) THEN
    RAISE EXCEPTION 'extracted row source and normalized extractor output are immutable';
  END IF;

  IF OLD.reviewed_at IS NOT NULL AND ROW(
    OLD.reviewed_at,
    OLD.reviewed_by,
    OLD.review_decision,
    OLD.correction_data
  ) IS DISTINCT FROM ROW(
    NEW.reviewed_at,
    NEW.reviewed_by,
    NEW.review_decision,
    NEW.correction_data
  ) THEN
    RAISE EXCEPTION 'extracted row review cannot be replaced';
  END IF;

  IF OLD.approved_at IS NOT NULL AND ROW(
    OLD.approved_at,
    OLD.approved_by
  ) IS DISTINCT FROM ROW(
    NEW.approved_at,
    NEW.approved_by
  ) THEN
    RAISE EXCEPTION 'extracted row approval cannot be replaced';
  END IF;

  IF OLD.committed_at IS NOT NULL AND ROW(
    OLD.committed_at,
    OLD.committed_by,
    OLD.target_record_type,
    OLD.target_record_id
  ) IS DISTINCT FROM ROW(
    NEW.committed_at,
    NEW.committed_by,
    NEW.target_record_type,
    NEW.target_record_id
  ) THEN
    RAISE EXCEPTION 'committed extracted row cannot be changed';
  END IF;

  IF NEW.review_decision = 'ACCEPT'
    AND NEW.validation_status NOT IN ('VALID', 'WARNING') THEN
    RAISE EXCEPTION 'accepted row must be VALID or WARNING';
  END IF;

  IF NEW.review_decision = 'CORRECT'
    AND (
      NEW.correction_data IS NULL
      OR NEW.correction_data = '{}'::jsonb
    ) THEN
    RAISE EXCEPTION 'corrected row requires correction_data';
  END IF;

  IF NEW.approved_at IS NOT NULL THEN
    IF NEW.review_decision NOT IN ('ACCEPT', 'CORRECT') THEN
      RAISE EXCEPTION 'row approval requires accepted or corrected review';
    END IF;

    IF NEW.approved_by = NEW.reviewed_by THEN
      RAISE EXCEPTION 'row approver must be independent from reviewer';
    END IF;
  END IF;

  IF NEW.committed_at IS NOT NULL AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'row commit requires prior approval';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER extracted_rows_validate_update
BEFORE UPDATE ON extracted_rows
FOR EACH ROW EXECUTE FUNCTION validate_extracted_row_update();

COMMIT;
