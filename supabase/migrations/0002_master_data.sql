-- =============================================================================
-- 0002_master_data.sql — البيانات الأساسية: التصنيفات، الوحدات، المنتجات،
--   مخزون الفروع، العملاء، الموردون، الصناديق والبنوك، أنواع الإيراد والمصروف
-- =============================================================================

-- ------------------------------ وحدات القياس ---------------------------------
create table units_of_measure (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name_ar   text not null,
  name_en   text,
  is_active boolean not null default true
);

-- ------------------------------- التصنيفات ------------------------------------
create table product_categories (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name_ar   text not null,
  name_en   text,
  parent_id uuid references product_categories(id) on delete restrict,
  is_active boolean not null default true
);

-- -------------------------------- المنتجات ------------------------------------
-- تعريف موحد للمنتج على مستوى الشركة، والكميات والتكاليف تُفصل حسب الفرع.
create table products (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name_ar            text not null,
  name_en            text,
  category_id        uuid references product_categories(id) on delete restrict,
  uom_id             uuid references units_of_measure(id) on delete restrict,
  default_sale_price numeric(18,4) not null default 0 check (default_sale_price >= 0),
  default_unit_cost  numeric(18,6) not null default 0 check (default_unit_cost  >= 0),
  reorder_level      numeric(18,4) not null default 0 check (reorder_level >= 0),
  tax_rate           numeric(7,4),                   -- فارغ = استخدام النسبة الافتراضية
  barcode            text,
  notes              text,
  is_active          boolean not null default true,  -- فعال / موقوف
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index products_category_idx on products(category_id);
create index products_name_idx     on products using gin (to_tsvector('simple', name_ar));

-- رصيد المنتج وتكلفته المتوسطة في كل فرع (أو في المستودع المركزي للشركة الأم)
create table product_branch_stock (
  product_id      uuid not null references products(id)  on delete cascade,
  branch_id       uuid not null references branches(id)  on delete cascade,
  quantity        numeric(18,4) not null default 0,
  avg_cost        numeric(18,6) not null default 0 check (avg_cost >= 0),
  stock_value     numeric(18,4) not null default 0,      -- = quantity * avg_cost (يُحدّث مع كل حركة)
  reorder_level   numeric(18,4),                          -- تجاوز اختياري لحد المنتج العام
  last_movement_at timestamptz,
  primary key (product_id, branch_id)
);

create index product_branch_stock_branch_idx on product_branch_stock(branch_id);

-- -------------------------------- العملاء -------------------------------------
create table customers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  phone            text,
  address          text,
  branch_id        uuid references branches(id) on delete set null,  -- تصنيف العميل حسب الفرع
  opening_balance  numeric(18,4) not null default 0,                 -- موجب = مدين علينا له ذمة
  opening_date     date,
  credit_limit     numeric(18,4) not null default 0 check (credit_limit >= 0),
  notes            text,
  is_active        boolean not null default true,
  is_walkin        boolean not null default false,                    -- عميل نقدي
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -------------------------------- الموردون ------------------------------------
create table suppliers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  phone            text,
  address          text,
  opening_balance  numeric(18,4) not null default 0,                 -- موجب = علينا له
  opening_date     date,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -------------------------- الصناديق والحسابات البنكية -------------------------
create table treasury_accounts (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name_ar          text not null,
  kind             treasury_kind not null,            -- صندوق أو بنك
  branch_id        uuid not null references branches(id) on delete restrict,
  bank_name        text,
  account_number   text,
  iban             text,
  opening_balance  numeric(18,4) not null default 0,
  opening_date     date,
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index treasury_accounts_branch_idx on treasury_accounts(branch_id, kind);
create unique index treasury_default_per_branch_kind
  on treasury_accounts(branch_id, kind) where is_default;

-- ------------------------ أنواع الإيرادات والمصاريف ----------------------------
create table expense_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  account_id  uuid references accounts(id) on delete restrict,
  is_admin    boolean not null default false,  -- مصروف إداري للشركة الأم
  is_active   boolean not null default true
);

create table revenue_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  account_id  uuid references accounts(id) on delete restrict,
  is_active   boolean not null default true
);

-- أنواع المستندات المرفقة / سندات الإدخال
create table document_kinds (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name_ar   text not null,
  is_active boolean not null default true
);

-- المرفقات
create table attachments (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null,
  entity_id     uuid not null,
  file_path     text not null,       -- مسار الملف في Supabase Storage
  file_name     text not null,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   uuid references app_users(id),
  uploaded_at   timestamptz not null default now()
);

create index attachments_entity_idx on attachments(entity, entity_id);

create trigger products_touch  before update on products
  for each row execute function touch_updated_at();
create trigger customers_touch before update on customers
  for each row execute function touch_updated_at();
create trigger suppliers_touch before update on suppliers
  for each row execute function touch_updated_at();
