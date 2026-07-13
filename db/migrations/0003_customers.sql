BEGIN;

CREATE TABLE sales_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text UNIQUE,
  full_name_ar text NOT NULL,
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  representative_type text NOT NULL DEFAULT 'RETAIL'
    CHECK (representative_type IN ('RETAIL', 'STRATEGIC', 'SUPERMARKET', 'OFFICE')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  deleted_at timestamptz
);

CREATE TABLE areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name_ar text NOT NULL,
  parent_area_id uuid REFERENCES areas(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX areas_name_parent_unique_active
  ON areas (lower(name_ar), COALESCE(parent_area_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active = true;

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_number text,
  trade_name_ar text NOT NULL,
  owner_name_ar text,
  customer_type text NOT NULL DEFAULT 'RETAIL'
    CHECK (customer_type IN ('RETAIL', 'SUPERMARKET', 'WHOLESALE', 'STRATEGIC', 'OTHER')),
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN (
      'ACTIVE',
      'TEMPORARILY_CLOSED',
      'PERMANENTLY_CLOSED',
      'BANKRUPT',
      'SUSPENDED',
      'UNDER_REVIEW'
    )),
  credit_status text NOT NULL DEFAULT 'ALLOWED'
    CHECK (credit_status IN ('ALLOWED', 'BLOCKED', 'EXCEPTION_REQUIRED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  deleted_at timestamptz,
  merged_into_customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT customer_not_merged_into_itself CHECK (merged_into_customer_id IS NULL OR merged_into_customer_id <> id)
);

CREATE UNIQUE INDEX customers_number_unique_active
  ON customers (customer_number)
  WHERE customer_number IS NOT NULL AND deleted_at IS NULL AND merged_into_customer_id IS NULL;

CREATE INDEX customers_trade_name_search_idx
  ON customers (lower(trade_name_ar));

CREATE TABLE customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  contact_type text NOT NULL CHECK (contact_type IN ('PHONE', 'WHATSAPP', 'EMAIL', 'OTHER')),
  contact_value text NOT NULL,
  label_ar text,
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX customer_contacts_unique_active
  ON customer_contacts (customer_id, contact_type, lower(contact_value))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX customer_contacts_one_primary_per_type
  ON customer_contacts (customer_id, contact_type)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE TABLE customer_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  area_id uuid REFERENCES areas(id) ON DELETE RESTRICT,
  address_ar text,
  landmark_ar text,
  latitude numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  is_primary boolean NOT NULL DEFAULT false,
  location_source text NOT NULL DEFAULT 'MANUAL'
    CHECK (location_source IN ('MANUAL', 'DEVICE_GPS', 'IMPORT', 'VERIFIED_VISIT')),
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX customer_locations_one_primary
  ON customer_locations (customer_id)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE TABLE customer_external_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  source_system text NOT NULL,
  external_identifier text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_external_identifier_unique UNIQUE (source_system, external_identifier)
);

CREATE TABLE customer_rep_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  representative_id uuid NOT NULL REFERENCES sales_representatives(id) ON DELETE RESTRICT,
  assignment_type text NOT NULL DEFAULT 'PRIMARY'
    CHECK (assignment_type IN ('PRIMARY', 'TEMPORARY', 'BACKUP')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  reason text NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  CONSTRAINT customer_rep_assignment_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX customer_rep_one_active_primary
  ON customer_rep_assignments (customer_id)
  WHERE assignment_type = 'PRIMARY' AND valid_until IS NULL;

CREATE INDEX customer_rep_active_lookup
  ON customer_rep_assignments (representative_id, valid_from, valid_until);

CREATE TABLE customer_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  previous_status text,
  new_status text NOT NULL,
  reason text NOT NULL,
  evidence_document_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id)
);

COMMIT;
