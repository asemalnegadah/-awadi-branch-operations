BEGIN;

CREATE TABLE uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/csv',
    'text/tab-separated-values',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/json'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN (
    'REGISTERED',
    'UPLOADED',
    'QUEUED',
    'EXTRACTING',
    'EXTRACTED',
    'REVIEW_REQUIRED',
    'APPROVED',
    'COMMITTED',
    'REJECTED',
    'FAILED'
  )),
  document_type text NOT NULL DEFAULT 'UNKNOWN' CHECK (document_type IN (
    'CUSTOMER_LIST',
    'DEBT_AGING',
    'COLLECTIONS',
    'SALES',
    'PROMISES',
    'INVENTORY',
    'RECONCILIATION',
    'UNKNOWN'
  )),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  uploaded_at timestamptz,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL UNIQUE,
  failure_code text,
  failure_message text,
  CONSTRAINT uploaded_files_sha256_unique UNIQUE (sha256),
  CONSTRAINT uploaded_files_storage_unique UNIQUE (storage_provider, storage_key)
);

CREATE INDEX uploaded_files_status_created_idx
  ON uploaded_files (status, created_at);

CREATE INDEX uploaded_files_type_status_idx
  ON uploaded_files (document_type, status, created_at);

CREATE TABLE file_extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_file_id uuid NOT NULL REFERENCES uploaded_files(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type IN (
    'TEXT_EXTRACTION',
    'OCR_EXTRACTION',
    'DOCUMENT_CLASSIFICATION',
    'STRUCTURED_ROW_EXTRACTION',
    'VALIDATION'
  )),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL UNIQUE,
  CONSTRAINT file_job_unique_type_per_file UNIQUE (uploaded_file_id, job_type)
);

CREATE INDEX file_extraction_jobs_queue_idx
  ON file_extraction_jobs (status, available_at, created_at);

CREATE TABLE document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_file_id uuid NOT NULL REFERENCES uploaded_files(id) ON DELETE RESTRICT,
  extractor_name text NOT NULL,
  extractor_version text NOT NULL,
  extraction_method text NOT NULL CHECK (extraction_method IN ('PDF_TEXT', 'OCR', 'CSV', 'XLSX', 'TEXT', 'JSON')),
  document_type text NOT NULL CHECK (document_type IN (
    'CUSTOMER_LIST',
    'DEBT_AGING',
    'COLLECTIONS',
    'SALES',
    'PROMISES',
    'INVENTORY',
    'RECONCILIATION',
    'UNKNOWN'
  )),
  classification_confidence numeric(5,4) NOT NULL CHECK (
    classification_confidence >= 0 AND classification_confidence <= 1
  ),
  raw_text_storage_key text,
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  supersedes_extraction_id uuid REFERENCES document_extractions(id) ON DELETE RESTRICT,
  CONSTRAINT document_extraction_version_unique UNIQUE (
    uploaded_file_id,
    extractor_name,
    extractor_version
  )
);

CREATE INDEX document_extractions_file_created_idx
  ON document_extractions (uploaded_file_id, created_at DESC);

CREATE TABLE extracted_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES document_extractions(id) ON DELETE RESTRICT,
  row_index integer NOT NULL CHECK (row_index >= 0),
  source_page integer CHECK (source_page IS NULL OR source_page > 0),
  source_line integer CHECK (source_line IS NULL OR source_line > 0),
  row_type text NOT NULL CHECK (row_type IN (
    'CUSTOMER',
    'DEBT_AGING',
    'COLLECTION',
    'SALE',
    'PROMISE',
    'INVENTORY',
    'RECONCILIATION',
    'UNKNOWN'
  )),
  raw_data jsonb NOT NULL,
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  validation_status text NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN (
    'PENDING',
    'VALID',
    'WARNING',
    'INVALID',
    'DUPLICATE',
    'CONFLICT'
  )),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  review_decision text CHECK (review_decision IN ('ACCEPT', 'CORRECT', 'REJECT', 'MERGE_CANDIDATE')),
  correction_data jsonb,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  committed_at timestamptz,
  committed_by uuid REFERENCES users(id),
  target_record_type text,
  target_record_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extracted_rows_index_unique UNIQUE (extraction_id, row_index),
  CONSTRAINT extracted_rows_review_shape CHECK (
    (review_decision IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (review_decision IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  ),
  CONSTRAINT extracted_rows_approval_shape CHECK (
    (approved_at IS NULL AND approved_by IS NULL)
    OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT extracted_rows_commit_shape CHECK (
    (committed_at IS NULL AND committed_by IS NULL AND target_record_type IS NULL AND target_record_id IS NULL)
    OR (committed_at IS NOT NULL AND committed_by IS NOT NULL AND target_record_type IS NOT NULL AND target_record_id IS NOT NULL)
  )
);

CREATE INDEX extracted_rows_review_queue_idx
  ON extracted_rows (validation_status, review_decision, created_at);

CREATE INDEX extracted_rows_customer_match_idx
  ON extracted_rows (matched_customer_id)
  WHERE matched_customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION file_status_transition_allowed(old_status text, new_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_status
    WHEN 'REGISTERED' THEN new_status IN ('UPLOADED', 'REJECTED', 'FAILED')
    WHEN 'UPLOADED' THEN new_status IN ('QUEUED', 'REJECTED', 'FAILED')
    WHEN 'QUEUED' THEN new_status IN ('EXTRACTING', 'REJECTED', 'FAILED')
    WHEN 'EXTRACTING' THEN new_status IN ('EXTRACTED', 'FAILED')
    WHEN 'EXTRACTED' THEN new_status IN ('REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'FAILED')
    WHEN 'REVIEW_REQUIRED' THEN new_status IN ('APPROVED', 'REJECTED', 'FAILED')
    WHEN 'APPROVED' THEN new_status IN ('COMMITTED', 'REJECTED', 'FAILED')
    ELSE false
  END;
$$;

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

  IF OLD.status <> NEW.status AND NOT file_status_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid uploaded file status transition: % -> %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'UPLOADED' AND NEW.uploaded_at IS NULL THEN
    RAISE EXCEPTION 'uploaded file requires uploaded_at';
  END IF;

  IF NEW.status = 'FAILED' AND NULLIF(btrim(NEW.failure_code), '') IS NULL THEN
    RAISE EXCEPTION 'failed file requires failure_code';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER uploaded_files_validate_update
BEFORE UPDATE ON uploaded_files
FOR EACH ROW EXECUTE FUNCTION validate_uploaded_file_update();

CREATE TRIGGER uploaded_files_prevent_delete
BEFORE DELETE ON uploaded_files
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER document_extractions_prevent_update_delete
BEFORE UPDATE OR DELETE ON document_extractions
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER extracted_rows_prevent_delete
BEFORE DELETE ON extracted_rows
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

COMMIT;
