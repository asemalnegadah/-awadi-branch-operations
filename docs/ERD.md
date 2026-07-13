# مخطط العلاقات ERD — الإصدار التأسيسي

**الحالة:** مسودة قابلة للتطوير  
**النطاق:** فرع عدن فقط

```mermaid
erDiagram
  ORGANIZATION_SETTINGS {
    smallint id PK
    text organization_name_ar
    text branch_name_ar
    text time_zone
  }

  CURRENCIES {
    uuid id PK
    text code UK
    text name_ar
    smallint decimal_places
  }

  USERS {
    uuid id PK
    text email UK
    text display_name_ar
    text status
  }

  ROLES {
    uuid id PK
    text code UK
    text name_ar
  }

  PERMISSIONS {
    uuid id PK
    text code UK
    text resource
    text action
    text scope_level
  }

  USER_ROLES {
    uuid user_id FK
    uuid role_id FK
    timestamptz expires_at
  }

  ROLE_PERMISSIONS {
    uuid role_id FK
    uuid permission_id FK
  }

  SALES_REPRESENTATIVES {
    uuid id PK
    text employee_code UK
    text full_name_ar
    uuid user_id FK
  }

  CUSTOMERS {
    uuid id PK
    text internal_code UK
    text trade_name_ar
    text activity_status
  }

  CUSTOMER_CONTACTS {
    uuid id PK
    uuid customer_id FK
    text contact_type
    text contact_value
  }

  CUSTOMER_LOCATIONS {
    uuid id PK
    uuid customer_id FK
    text area_name_ar
    numeric latitude
    numeric longitude
  }

  CUSTOMER_EXTERNAL_IDENTIFIERS {
    uuid id PK
    uuid customer_id FK
    text source_system
    text external_id
  }

  CUSTOMER_REP_ASSIGNMENTS {
    uuid id PK
    uuid customer_id FK
    uuid representative_id FK
    text assignment_type
    timestamptz starts_at
    timestamptz ends_at
  }

  CUSTOMER_ACCOUNTS {
    uuid id PK
    uuid customer_id FK
    uuid currency_id FK
    bigint credit_limit_minor
    text status
  }

  REQUEST_IDEMPOTENCY {
    uuid id PK
    text idempotency_key UK
    uuid actor_user_id FK
    text operation
    text status
  }

  AUDIT_LOGS {
    uuid id PK
    uuid actor_user_id FK
    text action
    text resource_type
    text resource_id
    jsonb before_data
    jsonb after_data
  }

  USERS ||--o{ USER_ROLES : receives
  ROLES ||--o{ USER_ROLES : grants
  ROLES ||--o{ ROLE_PERMISSIONS : contains
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : assigned
  USERS ||--o| SALES_REPRESENTATIVES : may_link
  USERS ||--o{ CUSTOMER_REP_ASSIGNMENTS : approves
  USERS ||--o{ AUDIT_LOGS : performs
  USERS ||--o{ REQUEST_IDEMPOTENCY : sends

  CUSTOMERS ||--o{ CUSTOMER_CONTACTS : has
  CUSTOMERS ||--o{ CUSTOMER_LOCATIONS : has
  CUSTOMERS ||--o{ CUSTOMER_EXTERNAL_IDENTIFIERS : maps
  CUSTOMERS ||--o{ CUSTOMER_REP_ASSIGNMENTS : assigned
  SALES_REPRESENTATIVES ||--o{ CUSTOMER_REP_ASSIGNMENTS : serves
  CUSTOMERS ||--o{ CUSTOMER_ACCOUNTS : owns
  CURRENCIES ||--o{ CUSTOMER_ACCOUNTS : denominates
```

## قيود حاكمة

- لا يوجد `branch_id` أو `tenant_id`.
- لكل عميل حساب واحد فقط لكل عملة.
- لكل عميل تكليف أساسي مفتوح واحد فقط.
- المعرف الخارجي فريد داخل نظام المصدر.
- سجل التدقيق لا يعتمد عليه لتخزين الحالة الحالية؛ هو أثر زمني غير قابل للتعديل من الواجهة.
- مخطط دفتر الحركات سيضاف في ترحيل وERD مستقل بعد تثبيت حالات الفاتورة والتحصيل والترحيل.
