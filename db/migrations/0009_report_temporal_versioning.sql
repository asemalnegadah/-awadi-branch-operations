BEGIN;

ALTER TABLE uploaded_files
  ADD COLUMN source_system text CHECK (source_system IN ('ONYX', 'MANUAL', 'OTHER')),
  ADD COLUMN document_period_start date,
  ADD COLUMN document_period_end date,
  ADD COLUMN data_as_of_date date,
  ADD COLUMN report_generated_at timestamptz,
  ADD COLUMN report_series_key text,
  ADD COLUMN coverage_scope_type text NOT NULL DEFAULT 'UNKNOWN' CHECK (
    coverage_scope_type IN (
      'FULL_BRANCH',
      'REPRESENTATIVE',
      'CURRENCY',
      'CUSTOMER_SET',
      'UNKNOWN'
    )
  ),
  ADD COLUMN coverage_scope_identifier text,
  ADD COLUMN aging_scheme_code text CHECK (
    aging_scheme_code IN (
      'ONYX_0_30_60_90_120',
      'STANDARD_0_30_60_90_180'
    )
  ),
  ADD COLUMN metadata_confidence numeric(5,4) CHECK (
    metadata_confidence IS NULL OR
    (metadata_confidence >= 0 AND metadata_confidence <= 1)
  ),
  ADD COLUMN metadata_source text CHECK (
    metadata_source IN ('PDF_CONTENT', 'FILE_NAME', 'PDF_METADATA', 'MANUAL', 'MIXED')
  );

ALTER TABLE uploaded_files
  ADD CONSTRAINT uploaded_file_period_shape CHECK (
    (
      document_period_start IS NULL
      AND document_period_end IS NULL
      AND data_as_of_date IS NULL
    )
    OR (
      document_period_start IS NOT NULL
      AND document_period_end IS NOT NULL
      AND data_as_of_date IS NOT NULL
      AND document_period_start <= document_period_end
      AND data_as_of_date = document_period_end
    )
  ),
  ADD CONSTRAINT uploaded_file_scope_shape CHECK (
    (coverage_scope_type = 'UNKNOWN' AND coverage_scope_identifier IS NULL)
    OR (coverage_scope_type <> 'UNKNOWN' AND coverage_scope_identifier IS NOT NULL)
  );

CREATE INDEX uploaded_files_report_series_date_idx
  ON uploaded_files (report_series_key, data_as_of_date DESC, created_at DESC)
  WHERE report_series_key IS NOT NULL;

CREATE TABLE report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_file_id uuid NOT NULL UNIQUE REFERENCES uploaded_files(id) ON DELETE RESTRICT,
  report_type text NOT NULL CHECK (report_type IN (
    'DEBT_AGING',
    'CUSTOMER_LIST',
    'COLLECTIONS',
    'SALES',
    'PROMISES',
    'INVENTORY',
    'RECONCILIATION'
  )),
  report_series_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  as_of_date date NOT NULL,
  generated_at timestamptz,
  relation_to_current text NOT NULL CHECK (relation_to_current IN (
    'FIRST_SNAPSHOT',
    'NEWER_SNAPSHOT',
    'SAME_SNAPSHOT_DUPLICATE',
    'SAME_SNAPSHOT_CONFLICT',
    'HISTORICAL_BACKFILL',
    'DIFFERENT_SERIES',
    'OVERLAPPING_PERIOD'
  )),
  snapshot_status text NOT NULL DEFAULT 'CANDIDATE' CHECK (snapshot_status IN (
    'CANDIDATE',
    'CURRENT',
    'HISTORICAL',
    'CONFLICT',
    'REJECTED'
  )),
  supersedes_snapshot_id uuid REFERENCES report_snapshots(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  review_note text,
  CONSTRAINT report_snapshot_dates CHECK (
    period_start <= period_end AND as_of_date = period_end
  ),
  CONSTRAINT report_snapshot_review_shape CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT report_snapshot_supersedes_shape CHECK (
    (relation_to_current = 'NEWER_SNAPSHOT' AND supersedes_snapshot_id IS NOT NULL)
    OR relation_to_current <> 'NEWER_SNAPSHOT'
  )
);

CREATE UNIQUE INDEX report_snapshots_one_current_per_series
  ON report_snapshots (report_series_key)
  WHERE snapshot_status = 'CURRENT';

CREATE INDEX report_snapshots_series_as_of_idx
  ON report_snapshots (report_series_key, as_of_date DESC, created_at DESC);

CREATE INDEX report_snapshots_review_queue_idx
  ON report_snapshots (snapshot_status, created_at)
  WHERE snapshot_status IN ('CANDIDATE', 'CONFLICT');

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

  RETURN NEW;
END;
$$;

CREATE TRIGGER report_snapshots_validate
BEFORE INSERT OR UPDATE ON report_snapshots
FOR EACH ROW EXECUTE FUNCTION validate_report_snapshot();

CREATE TRIGGER report_snapshots_prevent_delete
BEFORE DELETE ON report_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

COMMIT;
