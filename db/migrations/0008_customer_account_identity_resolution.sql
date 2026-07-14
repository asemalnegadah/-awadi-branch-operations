BEGIN;

ALTER TABLE customer_accounts
  ADD COLUMN account_number text,
  ADD COLUMN account_number_normalized text GENERATED ALWAYS AS (
    upper(regexp_replace(btrim(account_number), '\s+', '', 'g'))
  ) STORED,
  ADD COLUMN account_number_source text NOT NULL DEFAULT 'MIGRATED'
    CHECK (account_number_source IN ('MIGRATED', 'ONYX', 'IMPORT', 'MANUAL', 'OTHER'));

UPDATE customer_accounts AS account
SET account_number = customer.customer_number
FROM customers AS customer
WHERE account.customer_id = customer.id
  AND account.account_number IS NULL
  AND customer.customer_number IS NOT NULL;

CREATE UNIQUE INDEX customer_accounts_currency_number_unique
  ON customer_accounts (currency_code, account_number_normalized)
  WHERE account_number_normalized IS NOT NULL;

CREATE INDEX customer_accounts_number_lookup_idx
  ON customer_accounts (account_number_normalized, currency_code)
  WHERE account_number_normalized IS NOT NULL;

COMMENT ON COLUMN customer_accounts.account_number IS
  'رقم العميل المحاسبي/كود الحساب، وليس رقم الهاتف. تسمح العملة بربطه بحساب الدين الصحيح.';

COMMENT ON COLUMN customers.customer_number IS
  'رقم العميل العام. يمكن أن تستخدم حسابات SR وRG الرقم نفسه أو أرقامًا مختلفة وفق المصدر.';

CREATE TABLE extracted_customer_identity_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extracted_row_id uuid NOT NULL REFERENCES extracted_rows(id) ON DELETE RESTRICT,
  extracted_customer_number text,
  extracted_customer_number_normalized text GENERATED ALWAYS AS (
    upper(regexp_replace(btrim(extracted_customer_number), '\s+', '', 'g'))
  ) STORED,
  extracted_currency text REFERENCES currencies(code) ON DELETE RESTRICT,
  extracted_customer_name text NOT NULL,
  matched_customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
  matched_customer_account_id uuid REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  canonical_customer_name text,
  name_relationship text NOT NULL CHECK (name_relationship IN (
    'EXACT',
    'TRUNCATED_PREFIX',
    'DIFFERENT',
    'UNKNOWN'
  )),
  match_status text NOT NULL CHECK (match_status IN (
    'MATCHED_BY_CUSTOMER_NUMBER',
    'MATCHED_BY_EXTERNAL_IDENTIFIER',
    'REVIEW_REQUIRED',
    'AMBIGUOUS',
    'CONFLICT',
    'UNMATCHED'
  )),
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  auto_link_allowed boolean NOT NULL DEFAULT false,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolver_name text NOT NULL,
  resolver_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  review_decision text CHECK (review_decision IN (
    'CONFIRM_MATCH',
    'SELECT_DIFFERENT_CUSTOMER',
    'REJECT_ROW',
    'CREATE_NEW_CUSTOMER_REQUEST'
  )),
  review_note text,
  CONSTRAINT extracted_customer_match_target_shape CHECK (
    (
      match_status IN ('MATCHED_BY_CUSTOMER_NUMBER', 'MATCHED_BY_EXTERNAL_IDENTIFIER')
      AND matched_customer_id IS NOT NULL
      AND canonical_customer_name IS NOT NULL
    )
    OR match_status NOT IN ('MATCHED_BY_CUSTOMER_NUMBER', 'MATCHED_BY_EXTERNAL_IDENTIFIER')
  ),
  CONSTRAINT extracted_customer_match_account_shape CHECK (
    matched_customer_account_id IS NULL OR matched_customer_id IS NOT NULL
  ),
  CONSTRAINT extracted_customer_match_review_shape CHECK (
    (review_decision IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (review_decision IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE INDEX extracted_customer_matches_row_created_idx
  ON extracted_customer_identity_matches (extracted_row_id, created_at DESC);

CREATE INDEX extracted_customer_matches_number_currency_idx
  ON extracted_customer_identity_matches (
    extracted_customer_number_normalized,
    extracted_currency
  )
  WHERE extracted_customer_number_normalized IS NOT NULL;

CREATE INDEX extracted_customer_matches_review_queue_idx
  ON extracted_customer_identity_matches (match_status, review_decision, created_at)
  WHERE review_decision IS NULL;

CREATE OR REPLACE FUNCTION validate_extracted_customer_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_record customer_accounts%ROWTYPE;
  normalized_extracted_number text;
BEGIN
  normalized_extracted_number := CASE
    WHEN NEW.extracted_customer_number IS NULL THEN NULL
    ELSE upper(regexp_replace(btrim(NEW.extracted_customer_number), '\s+', '', 'g'))
  END;

  IF NEW.matched_customer_account_id IS NOT NULL THEN
    SELECT * INTO account_record
    FROM customer_accounts
    WHERE id = NEW.matched_customer_account_id;

    IF account_record.id IS NULL THEN
      RAISE EXCEPTION 'matched customer account does not exist';
    END IF;

    IF account_record.customer_id <> NEW.matched_customer_id THEN
      RAISE EXCEPTION 'matched account does not belong to matched customer';
    END IF;

    IF NEW.extracted_currency IS NOT NULL
      AND account_record.currency_code <> NEW.extracted_currency THEN
      RAISE EXCEPTION 'matched account currency does not match extracted currency';
    END IF;

    IF normalized_extracted_number IS NOT NULL
      AND account_record.account_number_normalized IS DISTINCT FROM
        normalized_extracted_number THEN
      RAISE EXCEPTION 'matched account number does not match extracted customer number';
    END IF;
  END IF;

  IF NEW.auto_link_allowed AND NEW.match_status NOT IN (
    'MATCHED_BY_CUSTOMER_NUMBER',
    'MATCHED_BY_EXTERNAL_IDENTIFIER'
  ) THEN
    RAISE EXCEPTION 'automatic linking requires an authoritative identity match';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER extracted_customer_matches_validate
BEFORE INSERT OR UPDATE ON extracted_customer_identity_matches
FOR EACH ROW EXECUTE FUNCTION validate_extracted_customer_match();

CREATE TRIGGER extracted_customer_matches_prevent_delete
BEFORE DELETE ON extracted_customer_identity_matches
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

COMMIT;
