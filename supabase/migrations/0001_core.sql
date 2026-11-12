-- =============================================================================
-- 0001_core.sql — الأساس: الإعدادات، الفروع، المستخدمون والصلاحيات،
--                 الفترات المالية، دليل الحسابات، ترقيم المستندات، سجل العمليات
-- =============================================================================

-- ------------------------------ أنواع (enums) --------------------------------
create type branch_kind        as enum ('parent', 'branch');
create type account_type       as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type account_nature     as enum ('debit', 'credit');
create type doc_status         as enum ('draft', 'posted', 'cancelled');
create type party_type         as enum ('customer', 'supplier');
create type treasury_kind      as enum ('cash', 'bank');
create type payment_method     as enum ('cash', 'bank', 'credit');
create type stock_direction    as enum ('in', 'out');
create type period_status      as enum ('open', 'closed');
create type doc_type as enum (
  'sales_invoice', 'sales_return',
  'purchase_invoice', 'purchase_return',
  'stock_transfer', 'stock_adjustment', 'stock_count', 'opening_stock',
  'collection', 'supplier_payment',
  'expense', 'parent_revenue',
  'treasury_transfer', 'receipt_voucher', 'payment_voucher',
  'opening_balance', 'period_closing', 'journal_voucher'
);

-- --------------------------- مستخدمو النظام ----------------------------------
create table app_users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,                      -- اختياري: ربط بمزود مصادقة خارجي
  username      text unique,
  password_hash text,
  full_name     text not null,
  email         text unique,
  phone         text,
  is_owner      boolean not null default false,   -- المالك: كل الصلاحيات
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  name_en     text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- الوحدات والإجراءات المتاحة للصلاحيات
create table permissions (
  code        text primary key,         -- مثال: sales.create
  module      text not null,            -- sales, purchases, inventory, treasury, expenses, reports, settings, users
  action      text not null,            -- view, create, edit, delete, post, cancel, close_period, backup
  name_ar     text not null
);

create table role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table user_roles (
  user_id uuid not null references app_users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);

-- --------------------------- الشركة الأم والفروع ------------------------------
create table branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  name_en     text,
  kind        branch_kind not null default 'branch',
  phone       text,
  address     text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- شركة أم واحدة فقط
create unique index branches_single_parent on branches (kind) where kind = 'parent';

-- صلاحية الوصول إلى الفروع: المستخدم بلا صفوف هنا = لا وصول (ما عدا المالك)
create table user_branches (
  user_id   uuid not null references app_users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

-- ------------------------------- الإعدادات ------------------------------------
create table settings (
  id                        boolean primary key default true check (id),
  company_name_ar           text not null default 'الشركة',
  company_name_en           text,
  company_phone             text,
  company_address           text,
  tax_number                text,
  logo_url                  text,
  brand_color               text not null default '#15399A',
  currency_code             text not null default 'JOD',
  currency_name_ar          text not null default 'دينار أردني',
  decimals                  int  not null default 3 check (decimals between 0 and 4),
  fiscal_year_start_month   int  not null default 1 check (fiscal_year_start_month between 1 and 12),
  system_start_date         date not null default current_date,
  inventory_valuation       text not null default 'wavg' check (inventory_valuation in ('wavg')),
  admin_allocation_method   text not null default 'equal' check (admin_allocation_method in ('equal', 'manual')),
  allow_negative_stock      boolean not null default false,
  tax_enabled               boolean not null default true,
  default_tax_rate          numeric(7,4) not null default 0 check (default_tax_rate >= 0),
  low_stock_uses_reorder    boolean not null default true,
  updated_at                timestamptz not null default now()
);

insert into settings (id) values (true);

-- نسب توزيع المصاريف الإدارية عند اختيار التوزيع اليدوي
create table admin_allocation_shares (
  branch_id   uuid primary key references branches(id) on delete cascade,
  share_pct   numeric(9,4) not null check (share_pct >= 0)
);

-- ----------------------------- الفترات المالية --------------------------------
create table fiscal_periods (
  id          uuid primary key default gen_random_uuid(),
  year        int not null,
  month       int not null check (month between 1 and 12),
  status      period_status not null default 'open',
  closed_at   timestamptz,
  closed_by   uuid references app_users(id),
  notes       text,
  unique (year, month)
);

-- ----------------------------- دليل الحسابات ----------------------------------
create table accounts (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name_ar       text not null,
  name_en       text,
  type          account_type not null,
  nature        account_nature not null,
  parent_id     uuid references accounts(id) on delete restrict,
  is_postable   boolean not null default true,   -- حساب تفصيلي يقبل الحركة
  is_system     boolean not null default false,  -- حساب يستخدمه النظام تلقائيًا
  system_key    text unique,                     -- مفتاح يربط الحساب بالمنطق البرمجي
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index accounts_parent_idx on accounts(parent_id);

-- ---------------------------- ترقيم المستندات ---------------------------------
create table document_sequences (
  doc_type    doc_type not null,
  scope       text not null default '-',   -- معرف الفرع أو '-' للترقيم العام
  year        int not null,
  prefix      text not null default '',
  next_number bigint not null default 1,
  padding     int not null default 5,
  primary key (doc_type, scope, year)
);

-- إصدار رقم مستند متسلسل بلا فجوات (قفل على مستوى الصف)
create or replace function next_document_number(p_doc_type doc_type, p_branch_id uuid, p_date date)
returns text
language plpgsql
as $$
declare
  v_year    int := extract(year from p_date)::int;
  v_scope   text := coalesce(p_branch_id::text, '-');
  v_code    text;
  v_prefix  text;
  v_number  bigint;
  v_padding int;
begin
  select code into v_code from branches where id = p_branch_id;

  insert into document_sequences (doc_type, scope, year, prefix)
  values (p_doc_type, v_scope, v_year, coalesce(v_code || '-', ''))
  on conflict (doc_type, scope, year) do nothing;

  update document_sequences
     set next_number = next_number + 1
   where doc_type = p_doc_type
     and scope = v_scope
     and year = v_year
  returning next_number - 1, prefix, padding into v_number, v_prefix, v_padding;

  return coalesce(v_prefix, '') || v_year::text || '-' || lpad(v_number::text, v_padding, '0');
end;
$$;

-- ----------------------------- سجل العمليات -----------------------------------
create table audit_logs (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  user_id      uuid references app_users(id),
  action       text not null,            -- insert / update / delete / post / cancel / close_period / login
  entity       text not null,            -- اسم الجدول أو الشاشة
  entity_id    text,
  branch_id    uuid references branches(id),
  summary      text,
  old_data     jsonb,
  new_data     jsonb
);

create index audit_logs_at_idx     on audit_logs(at desc);
create index audit_logs_entity_idx on audit_logs(entity, entity_id);

-- --------------------------- دوال مساعدة عامة ---------------------------------

-- هوية المستخدم في الجلسة الحالية.
-- التطبيق يضبط app.user_id مع كل طلب؛ ويُدعم أيضًا رمز JWT إن استُخدم مزود مصادقة.
create or replace function current_uid()
returns uuid
language sql
stable
as $$
  select coalesce(
           nullif(current_setting('app.user_id', true), ''),
           nullif(current_setting('request.jwt.claim.sub', true), '')
         )::uuid;
$$;

create or replace function current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from app_users u
   where (u.id = current_uid() or u.auth_user_id = current_uid())
     and u.is_active
   limit 1;
$$;

create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.is_owner from app_users u
                    where (u.id = current_uid() or u.auth_user_id = current_uid())
                      and u.is_active), false);
$$;

-- هل يملك المستخدم الحالي صلاحية معينة؟ المالك يملك كل الصلاحيات.
create or replace function has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_owner() or exists (
    select 1
      from app_users u
      join user_roles ur       on ur.user_id = u.id
      join role_permissions rp on rp.role_id = ur.role_id
     where (u.id = current_uid() or u.auth_user_id = current_uid())
       and u.is_active
       and rp.permission_code = p_code
  );
$$;

-- هل يصل المستخدم الحالي إلى هذا الفرع؟
create or replace function can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_owner() or exists (
    select 1
      from app_users u
      join user_branches ub on ub.user_id = u.id
     where (u.id = current_uid() or u.auth_user_id = current_uid())
       and u.is_active
       and ub.branch_id = p_branch_id
  );
$$;

-- التأكد من أن الفترة المالية مفتوحة قبل أي ترحيل
create or replace function assert_period_open(p_date date)
returns void
language plpgsql
as $$
declare
  v_status period_status;
begin
  select status into v_status
    from fiscal_periods
   where year = extract(year from p_date)::int
     and month = extract(month from p_date)::int;

  if v_status = 'closed' then
    raise exception 'الفترة المالية % مقفلة، لا يمكن الترحيل فيها',
      to_char(p_date, 'YYYY-MM') using errcode = 'P0001';
  end if;
end;
$$;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_users_touch before update on app_users
  for each row execute function touch_updated_at();
create trigger settings_touch before update on settings
  for each row execute function touch_updated_at();
