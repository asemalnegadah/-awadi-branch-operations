BEGIN;

DROP VIEW field_visit_summaries;

CREATE VIEW field_visit_summaries AS
SELECT
  visit.id AS visit_id,
  (
    SELECT COUNT(*)::integer
    FROM field_visit_outcomes AS outcome
    WHERE outcome.visit_id = visit.id
  ) AS outcome_count,
  (
    SELECT COUNT(*)::integer
    FROM field_visit_outcomes AS outcome
    WHERE outcome.visit_id = visit.id
      AND outcome.qualifies_success = true
  ) AS qualifying_outcome_count,
  (
    SELECT COUNT(*)::integer
    FROM field_visit_evidence AS evidence
    WHERE evidence.visit_id = visit.id
  ) AS evidence_count,
  EXISTS (
    SELECT 1
    FROM field_visit_outcomes AS qualifying
    WHERE qualifying.visit_id = visit.id
      AND qualifying.qualifies_success = true
  ) AS has_qualifying_outcome
FROM field_visits AS visit;

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
    OR file_record.uploaded_at IS NULL
    OR file_record.status NOT IN (
      'UPLOADED',
      'QUEUED',
      'EXTRACTING',
      'EXTRACTED',
      'REVIEW_REQUIRED',
      'APPROVED',
      'COMMITTED'
    )
    OR file_record.media_type NOT IN (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp'
    ) THEN
    RAISE EXCEPTION 'field visit evidence file is missing, not uploaded, invalid, or unsupported';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
