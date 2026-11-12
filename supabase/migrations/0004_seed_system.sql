-- =============================================================================
-- 0004_seed_system.sql — البيانات التأسيسية: دليل الحسابات، الصلاحيات، الأدوار،
--   الشركة الأم والفروع الثلاثة، الوحدات، أنواع المصاريف والإيرادات، الفترات
-- =============================================================================

-- ----------------------------- دليل الحسابات ----------------------------------
insert into accounts (code, name_ar, name_en, type, nature, is_postable, is_system, system_key) values
  ('1',    'الأصول',                        'Assets',               'asset',     'debit',  false, true, null),
  ('11',   'الأصول المتداولة',              'Current Assets',       'asset',     'debit',  false, true, null),
  ('1101', 'الصندوق',                       'Cash',                 'asset',     'debit',  true,  true, 'cash'),
  ('1102', 'البنك',                         'Bank',                 'asset',     'debit',  true,  true, 'bank'),
  ('1103', 'الذمم المدينة — العملاء',       'Accounts Receivable',  'asset',     'debit',  true,  true, 'ar'),
  ('1104', 'المخزون',                       'Inventory',            'asset',     'debit',  true,  true, 'inventory'),
  ('1105', 'ضريبة المشتريات (مدخلات)',      'Input Tax',            'asset',     'debit',  true,  true, 'tax_input'),

  ('2',    'الالتزامات',                    'Liabilities',          'liability', 'credit', false, true, null),
  ('21',   'الالتزامات المتداولة',          'Current Liabilities',  'liability', 'credit', false, true, null),
  ('2101', 'الذمم الدائنة — الموردون',      'Accounts Payable',     'liability', 'credit', true,  true, 'ap'),
  ('2102', 'ضريبة المبيعات المستحقة',       'Output Tax Payable',   'liability', 'credit', true,  true, 'tax_payable'),
  ('2103', 'مصاريف مستحقة الدفع',           'Accrued Expenses',     'liability', 'credit', true,  true, 'accrued_expenses'),

  ('3',    'حقوق الملكية',                  'Equity',               'equity',    'credit', false, true, null),
  ('3101', 'رأس المال',                     'Capital',              'equity',    'credit', true,  true, 'capital'),
  ('3102', 'الأرباح المدورة',               'Retained Earnings',    'equity',    'credit', true,  true, 'retained_earnings'),
  ('3103', 'حساب الأرصدة الافتتاحية',       'Opening Balances',     'equity',    'credit', true,  true, 'opening_equity'),

  ('4',    'الإيرادات',                     'Revenue',              'revenue',   'credit', false, true, null),
  ('41',   'إيرادات الفروع',                'Branch Revenue',       'revenue',   'credit', false, true, null),
  ('4101', 'المبيعات',                      'Sales',                'revenue',   'credit', true,  true, 'sales'),
  ('4102', 'مرتجعات المبيعات',              'Sales Returns',        'revenue',   'debit',  true,  true, 'sales_returns'),
  ('4103', 'الخصومات الممنوحة',             'Sales Discounts',      'revenue',   'debit',  true,  true, 'sales_discounts'),
  ('42',   'إيرادات الشركة الأم',           'Parent Revenue',       'revenue',   'credit', false, true, null),
  ('4201', 'إيراد نشاط الشركة الأم',        'Parent Activity Rev.', 'revenue',   'credit', true,  true, 'parent_revenue'),
  ('4202', 'إيرادات أخرى',                  'Other Revenue',        'revenue',   'credit', true,  true, 'other_revenue'),

  ('5',    'المصاريف',                      'Expenses',             'expense',   'debit',  false, true, null),
  ('51',   'تكلفة المبيعات',                'Cost of Sales',        'expense',   'debit',  false, true, null),
  ('5101', 'تكلفة البضاعة المباعة',         'COGS',                 'expense',   'debit',  true,  true, 'cogs'),
  ('5102', 'فروقات وتسويات المخزون',        'Inventory Adjustments','expense',   'debit',  true,  true, 'inventory_adjustment'),
  ('52',   'المصاريف التشغيلية للفروع',     'Branch Opex',          'expense',   'debit',  false, true, null),
  ('5201', 'الإيجار',                       'Rent',                 'expense',   'debit',  true,  false, null),
  ('5202', 'الرواتب والأجور',               'Salaries',             'expense',   'debit',  true,  false, null),
  ('5203', 'الكهرباء',                      'Electricity',          'expense',   'debit',  true,  false, null),
  ('5204', 'المياه',                        'Water',                'expense',   'debit',  true,  false, null),
  ('5205', 'النقل والمواصلات',              'Transport',            'expense',   'debit',  true,  false, null),
  ('5206', 'الصيانة',                       'Maintenance',          'expense',   'debit',  true,  false, null),
  ('5207', 'الاتصالات',                     'Communications',       'expense',   'debit',  true,  false, null),
  ('5208', 'الضيافة',                       'Hospitality',          'expense',   'debit',  true,  false, null),
  ('5299', 'مصاريف تشغيلية أخرى',           'Other Opex',           'expense',   'debit',  true,  true,  'opex_other'),
  ('53',   'المصاريف الإدارية للشركة الأم', 'Admin Expenses',       'expense',   'debit',  false, true, null),
  ('5301', 'رواتب إدارية',                  'Admin Salaries',       'expense',   'debit',  true,  false, null),
  ('5302', 'إيجار إداري',                   'Admin Rent',           'expense',   'debit',  true,  false, null),
  ('5303', 'مصاريف مكتبية',                 'Office Expenses',      'expense',   'debit',  true,  false, null),
  ('5399', 'مصاريف إدارية أخرى',            'Other Admin',          'expense',   'debit',  true,  true,  'admin_other'),
  ('54',   'مصاريف أخرى',                   'Other Expenses',       'expense',   'debit',  false, true, null),
  ('5401', 'رسوم بنكية',                    'Bank Fees',            'expense',   'debit',  true,  true,  'bank_fees');

-- ربط الحسابات بالأب
update accounts c set parent_id = p.id from accounts p
 where length(c.code) > 1
   and p.code = case
                  when length(c.code) = 2 then left(c.code, 1)
                  else left(c.code, 2)
                end;

-- ------------------------------- الصلاحيات ------------------------------------
insert into permissions (code, module, action, name_ar) values
  ('dashboard.view',   'dashboard',  'view',   'عرض لوحة التحكم'),
  ('sales.view',       'sales',      'view',   'عرض المبيعات'),
  ('sales.create',     'sales',      'create', 'إنشاء فاتورة مبيعات'),
  ('sales.edit',       'sales',      'edit',   'تعديل فاتورة مبيعات'),
  ('sales.delete',     'sales',      'delete', 'حذف فاتورة مبيعات'),
  ('sales.post',       'sales',      'post',   'ترحيل فاتورة مبيعات'),
  ('sales.cancel',     'sales',      'cancel', 'إلغاء فاتورة مبيعات'),
  ('purchases.view',   'purchases',  'view',   'عرض المشتريات'),
  ('purchases.create', 'purchases',  'create', 'إنشاء فاتورة مشتريات'),
  ('purchases.edit',   'purchases',  'edit',   'تعديل فاتورة مشتريات'),
  ('purchases.delete', 'purchases',  'delete', 'حذف فاتورة مشتريات'),
  ('purchases.post',   'purchases',  'post',   'ترحيل فاتورة مشتريات'),
  ('purchases.cancel', 'purchases',  'cancel', 'إلغاء فاتورة مشتريات'),
  ('inventory.view',   'inventory',  'view',   'عرض المخزون'),
  ('inventory.create', 'inventory',  'create', 'حركات المخزون والتحويلات'),
  ('inventory.edit',   'inventory',  'edit',   'تعديل حركات المخزون'),
  ('inventory.post',   'inventory',  'post',   'ترحيل حركات المخزون'),
  ('inventory.cancel', 'inventory',  'cancel', 'إلغاء حركات المخزون'),
  ('treasury.view',    'treasury',   'view',   'عرض الصندوق والبنك'),
  ('treasury.create',  'treasury',   'create', 'سندات القبض والصرف والتحويلات'),
  ('treasury.edit',    'treasury',   'edit',   'تعديل حركات الخزينة'),
  ('treasury.post',    'treasury',   'post',   'ترحيل حركات الخزينة'),
  ('treasury.cancel',  'treasury',   'cancel', 'إلغاء حركات الخزينة'),
  ('expenses.view',    'expenses',   'view',   'عرض المصاريف'),
  ('expenses.create',  'expenses',   'create', 'تسجيل مصروف'),
  ('expenses.edit',    'expenses',   'edit',   'تعديل مصروف'),
  ('expenses.post',    'expenses',   'post',   'ترحيل مصروف'),
  ('expenses.cancel',  'expenses',   'cancel', 'إلغاء مصروف'),
  ('parties.view',     'parties',    'view',   'عرض العملاء والموردين'),
  ('parties.create',   'parties',    'create', 'إضافة عميل أو مورد'),
  ('parties.edit',     'parties',    'edit',   'تعديل عميل أو مورد'),
  ('parties.delete',   'parties',    'delete', 'حذف عميل أو مورد'),
  ('products.view',    'products',   'view',   'عرض المنتجات'),
  ('products.create',  'products',   'create', 'إضافة منتج'),
  ('products.edit',    'products',   'edit',   'تعديل منتج'),
  ('products.delete',  'products',   'delete', 'حذف منتج'),
  ('reports.view',     'reports',    'view',   'عرض التقارير'),
  ('reports.export',   'reports',    'export', 'تصدير وطباعة التقارير'),
  ('settings.view',    'settings',   'view',   'عرض الإعدادات'),
  ('settings.edit',    'settings',   'edit',   'تعديل الإعدادات'),
  ('periods.close',    'settings',   'close_period', 'الإقفال الشهري'),
  ('users.view',       'users',      'view',   'عرض المستخدمين'),
  ('users.manage',     'users',      'manage', 'إدارة المستخدمين والصلاحيات'),
  ('audit.view',       'audit',      'view',   'عرض سجل العمليات'),
  ('backup.run',       'backup',     'run',    'النسخ الاحتياطي');

-- --------------------------------- الأدوار ------------------------------------
insert into roles (code, name_ar, is_system) values
  ('general_manager', 'مدير عام',        true),
  ('accountant',      'محاسب',           true),
  ('branch_manager',  'مدير فرع',        true),
  ('cashier',         'أمين صندوق',      true),
  ('viewer',          'مشاهدة فقط',      true);

-- مدير عام: كل الصلاحيات
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r, permissions p where r.code = 'general_manager';

-- محاسب: كل شيء عدا إدارة المستخدمين والنسخ الاحتياطي
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r, permissions p
 where r.code = 'accountant' and p.module not in ('users', 'backup');

-- مدير فرع: العمليات والتقارير في فروعه
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r, permissions p
 where r.code = 'branch_manager'
   and p.code in ('dashboard.view','sales.view','sales.create','sales.edit','sales.post','sales.cancel',
                  'purchases.view','purchases.create','purchases.post',
                  'inventory.view','inventory.create','inventory.post',
                  'treasury.view','treasury.create','treasury.post',
                  'expenses.view','expenses.create','expenses.post',
                  'parties.view','parties.create','parties.edit',
                  'products.view','reports.view','reports.export');

-- أمين صندوق: المبيعات النقدية والتحصيلات
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r, permissions p
 where r.code = 'cashier'
   and p.code in ('dashboard.view','sales.view','sales.create','sales.post',
                  'treasury.view','treasury.create','treasury.post',
                  'parties.view','products.view','reports.view');

-- مشاهدة فقط
insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r, permissions p
 where r.code = 'viewer' and p.action = 'view';

-- -------------------------- الشركة الأم والفروع -------------------------------
insert into branches (code, name_ar, kind, sort_order) values
  ('HQ', 'الشركة الأم', 'parent', 0),
  ('B1', 'الفرع الأول', 'branch', 1),
  ('B2', 'الفرع الثاني','branch', 2),
  ('B3', 'الفرع الثالث','branch', 3);

-- صندوق افتراضي لكل وحدة
insert into treasury_accounts (code, name_ar, kind, branch_id, is_default)
select 'CASH-' || b.code, 'صندوق ' || b.name_ar, 'cash', b.id, true from branches b;

-- حساب بنكي افتراضي للشركة الأم
insert into treasury_accounts (code, name_ar, kind, branch_id, is_default)
select 'BANK-' || b.code, 'بنك ' || b.name_ar, 'bank', b.id, true from branches b where b.kind = 'parent';

-- توزيع المصاريف الإدارية بالتساوي على الفروع الثلاثة
insert into admin_allocation_shares (branch_id, share_pct)
select b.id, round(100.0 / nullif((select count(*) from branches where kind='branch'), 0), 4)
  from branches b where b.kind = 'branch';

-- ------------------------------ وحدات القياس ----------------------------------
insert into units_of_measure (code, name_ar) values
  ('PCS',  'حبة'),
  ('BOX',  'علبة'),
  ('CTN',  'كرتونة'),
  ('KG',   'كيلوغرام'),
  ('GM',   'غرام'),
  ('LTR',  'لتر'),
  ('MTR',  'متر'),
  ('PKT',  'باكيت'),
  ('DOZ',  'دزينة');

insert into product_categories (code, name_ar) values
  ('GEN', 'تصنيف عام');

-- ----------------------- أنواع المصاريف والإيرادات ----------------------------
insert into expense_types (code, name_ar, account_id, is_admin)
select v.code, v.name_ar, a.id, v.is_admin
  from (values
    ('RENT',   'الإيجار',               '5201', false),
    ('SAL',    'الرواتب والأجور',       '5202', false),
    ('ELEC',   'الكهرباء',              '5203', false),
    ('WATER',  'المياه',                '5204', false),
    ('TRANS',  'النقل والمواصلات',      '5205', false),
    ('MAINT',  'الصيانة',               '5206', false),
    ('COMM',   'الاتصالات',             '5207', false),
    ('HOSP',   'الضيافة',               '5208', false),
    ('OTH',    'مصاريف تشغيلية أخرى',   '5299', false),
    ('ADMSAL', 'رواتب إدارية',          '5301', true),
    ('ADMRNT', 'إيجار إداري',           '5302', true),
    ('ADMOFF', 'مصاريف مكتبية',         '5303', true),
    ('ADMOTH', 'مصاريف إدارية أخرى',    '5399', true),
    ('BANKFEE','رسوم بنكية',            '5401', false)
  ) as v(code, name_ar, acc, is_admin)
  join accounts a on a.code = v.acc;

insert into revenue_types (code, name_ar, account_id)
select v.code, v.name_ar, a.id
  from (values
    ('MAIN',  'إيراد نشاط الشركة الأم', '4201'),
    ('OTHER', 'إيرادات أخرى',           '4202')
  ) as v(code, name_ar, acc)
  join accounts a on a.code = v.acc;

insert into document_kinds (code, name_ar) values
  ('INV',  'فاتورة'),
  ('RCV',  'سند قبض'),
  ('PAY',  'سند صرف'),
  ('TRF',  'سند تحويل'),
  ('ADJ',  'سند تسوية'),
  ('OTH',  'مستند آخر');

-- ----------------------------- الفترات المالية --------------------------------
-- فتح فترات السنة الحالية والسنة القادمة
insert into fiscal_periods (year, month)
select y, m
  from generate_series(extract(year from current_date)::int,
                       extract(year from current_date)::int + 1) y,
       generate_series(1, 12) m
on conflict do nothing;
