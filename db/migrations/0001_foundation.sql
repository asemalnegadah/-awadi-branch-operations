BEGIN;

CREATE TABLE organization_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  organization_name_ar text NOT NULL,
  branch_name_ar text NOT NULL DEFAULT 'فرع عدن',
  address_ar text,
  address_en text,
  phone text,
  time_zone text NOT NULL DEFAULT 'Asia/Aden',
  logo_storage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE currencies (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code IN ('SR', 'RG')),
  name_ar text NOT NULL,
  symbol_ar text,
  decimal_places smallint NOT NULL DEFAULT 0 CHECK (decimal_places BETWEEN 0 AND 6),
  rounding_mode text NOT NULL DEFAULT 'HALF_UP' CHECK (rounding_mode IN ('HALF_UP', 'HALF_EVEN', 'DOWN')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  description_ar text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  scope_level text NOT NULL CHECK (scope_level IN ('OWN', 'ASSIGNED', 'AREA', 'TEAM', 'ALL')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name_ar text NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE sales_representatives (
  id uuid PRIMARY KEY,
  employee_code text UNIQUE,
  full_name_ar text NOT NULL,
  user_id uuid UNIQUE REFERENCES users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY,
  internal_code text NOT NULL UNIQUE,
  trade_name_ar text NOT NULL,
  owner_name_ar text,
  customer_type text,
  activity_status text NOT NULL DEFAULT 'ACTIVE' CHECK (activity_status IN ('ACTIVE', 'INACTIVE', 'CLOSED', 'BANKRUPT', 'UNKNOWN')),
  sales_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE customer_contacts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('PHONE', 'WHATSAPP', 'EMAIL', 'OTHER')),
  contact_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, contact_type, contact_value)
);

CREATE TABLE customer_locations (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  area_name_ar text,
  street_ar text,
  landmark_ar text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE customer_external_identifiers (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source_system text NOT NULL,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, external_id)
);

CREATE TABLE customer_rep_assignments (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  representative_id uuid NOT NULL REFERENCES sales_representatives(id),
  assignment_type text NOT NULL DEFAULT 'PRIMARY' CHECK (assignment_type IN ('PRIMARY', 'TEMPORARY')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  reason text NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE UNIQUE INDEX customer_one_open_primary_assignment
  ON customer_rep_assignments (customer_id)
  WHERE assignment_type = 'PRIMARY' AND ends_at IS NULL;

CREATE TABLE customer_accounts (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  currency_id uuid NOT NULL REFERENCES currencies(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESTRICTED', 'CLOSED')),
  credit_limit_minor bigint,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, currency_id),
  CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE request_idempotency (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  actor_user_id uuid REFERENCES users(id),
  operation text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE INDEX request_idempotency_expiry_idx ON request_idempotency (expires_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED'))
);

CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC);

COMMIT;
