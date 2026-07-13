BEGIN;

INSERT INTO organization_settings (
  singleton_id,
  legal_name_ar,
  branch_name_ar,
  address_ar,
  phone,
  timezone,
  locale
)
VALUES (
  1,
  'مجموعة العوادي التجارية',
  'فرع عدن',
  'عدن – المنصورة – جوار محطة كهرباء المنصورة',
  '+967 779 595 982',
  'Asia/Aden',
  'ar-YE'
)
ON CONFLICT (singleton_id) DO NOTHING;

INSERT INTO currencies (code, name_ar, decimal_places)
VALUES
  ('SR', 'حساب SR', 2),
  ('RG', 'حساب RG', 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name_ar, description_ar, is_system)
VALUES
  ('OWNER_AUDITOR', 'المالك أو المراقب', 'قراءة شاملة ومراقبة دون صلاحية مالية تلقائية.', true),
  ('BRANCH_MANAGER', 'مدير فرع عدن', 'إدارة واعتماد العمليات التشغيلية وفق الصلاحيات.', true),
  ('ACCOUNTING_CASHIER', 'الحسابات والصندوق', 'مراجعة التحصيلات والعهد والصندوق والمطابقات.', true),
  ('STOREKEEPER', 'أمين المخزن', 'إدارة المخزون والعهد والمرتجعات والجرد.', true),
  ('SALES_REP', 'المندوب', 'إدارة خطته وعملائه وزياراته وعملياته المسموحة.', true),
  ('AUDITOR', 'المدقق', 'قراءة وتقارير وتدقيق دون تعديل تشغيلي.', true),
  ('SYSTEM_ADMIN', 'مدير النظام', 'إدارة المستخدمين والإعدادات التقنية دون اعتماد مالي تلقائي.', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, resource, action, description_ar)
VALUES
  ('dashboard.read', 'dashboard', 'read', 'عرض لوحة التحكم وفق نطاق المستخدم.'),
  ('users.read', 'users', 'read', 'عرض المستخدمين.'),
  ('users.manage', 'users', 'manage', 'إنشاء المستخدمين وتعطيلهم وتحديثهم.'),
  ('roles.read', 'roles', 'read', 'عرض الأدوار والصلاحيات.'),
  ('roles.manage', 'roles', 'manage', 'إدارة الأدوار والصلاحيات.'),
  ('audit.read', 'audit', 'read', 'قراءة سجل التدقيق.'),
  ('audit.export', 'audit', 'export', 'تصدير سجل التدقيق وفق الضوابط.'),
  ('customers.read_own', 'customers', 'read_own', 'عرض العملاء ضمن نطاق المندوب.'),
  ('customers.read_all', 'customers', 'read_all', 'عرض جميع العملاء.'),
  ('customers.manage', 'customers', 'manage', 'إدارة بيانات العملاء غير المالية.'),
  ('collections.create', 'collections', 'create', 'إنشاء تحصيل.'),
  ('collections.review', 'collections', 'review', 'مراجعة التحصيل.'),
  ('collections.approve', 'collections', 'approve', 'اعتماد التحصيل.'),
  ('collections.reverse', 'collections', 'reverse', 'طلب أو اعتماد عكس التحصيل وفق المسار.'),
  ('plans.read_own', 'plans', 'read_own', 'عرض خطة المندوب.'),
  ('plans.manage', 'plans', 'manage', 'إنشاء الخطط ومراجعتها.'),
  ('plans.approve', 'plans', 'approve', 'اعتماد الخطط.'),
  ('reports.read', 'reports', 'read', 'عرض التقارير.'),
  ('reports.export', 'reports', 'export', 'تصدير التقارير.'),
  ('settings.manage', 'settings', 'manage', 'إدارة الإعدادات التقنية للمنشأة.')
ON CONFLICT (code) DO NOTHING;

COMMIT;
