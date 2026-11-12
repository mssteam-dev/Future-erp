-- =============================================================================
-- 0008_expenses_revenue.sql — مصاريف الفروع، المصاريف الإدارية للشركة الأم
--   وتوزيعها، وإيرادات الشركة الأم المستقلة عن مبيعات الفروع
-- =============================================================================

create table expenses (
  id                  uuid primary key default gen_random_uuid(),
  expense_no          text not null unique,
  expense_date        date not null,
  branch_id           uuid not null references branches(id) on delete restrict,
  expense_type_id     uuid not null references expense_types(id) on delete restrict,
  description         text,
  amount              numeric(18,4) not null check (amount > 0),
  payment_mode        text not null default 'cash'
                      check (payment_mode in ('cash','bank','unpaid')),
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  is_admin            boolean not null default false,  -- مصروف إداري للشركة الأم
  is_allocatable      boolean not null default false,  -- يدخل في توزيع المصاريف الإدارية
  document_no         text,                            -- رقم السند
  document_kind_id    uuid references document_kinds(id) on delete set null,
  notes               text,
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text
);

create index expenses_branch_idx on expenses(branch_id, expense_date);
create index expenses_type_idx   on expenses(expense_type_id);
create index expenses_admin_idx  on expenses(is_admin, is_allocatable, expense_date);

-- سداد مصروف مستحق لاحقًا
create table expense_settlements (
  id                  uuid primary key default gen_random_uuid(),
  settlement_no       text not null unique,
  settlement_date     date not null,
  expense_id          uuid not null references expenses(id) on delete restrict,
  treasury_account_id uuid not null references treasury_accounts(id) on delete restrict,
  amount              numeric(18,4) not null check (amount > 0),
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz
);

-- --------------------------- إيرادات الشركة الأم ------------------------------
-- إيراد نشاط الشركة الأم نفسه. مبيعات الفروع لا تُسجَّل هنا إطلاقًا.
create table parent_revenues (
  id                  uuid primary key default gen_random_uuid(),
  revenue_no          text not null unique,
  revenue_date        date not null,
  revenue_type_id     uuid not null references revenue_types(id) on delete restrict,
  description         text,
  amount              numeric(18,4) not null check (amount > 0),
  tax_rate            numeric(7,4) not null default 0,
  tax_amount          numeric(18,4) not null default 0,
  total               numeric(18,4) not null default 0,
  receipt_mode        text not null default 'cash'
                      check (receipt_mode in ('cash','bank','receivable')),
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  customer_id         uuid references customers(id) on delete restrict,
  document_no         text,
  notes               text,
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text
);

-- =============================================================================
-- الترحيل
-- =============================================================================

create or replace function post_expense(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_e     expenses;
  v_type  expense_types;
  v_acc   text;
  v_kind  treasury_kind;
  v_lines jsonb;
  v_entry uuid;
begin
  select * into v_e from expenses where id = p_id for update;
  if v_e.status <> 'draft' then raise exception 'لا يمكن ترحيل مصروف حالته %', v_e.status; end if;
  perform assert_period_open(v_e.expense_date);

  select * into v_type from expense_types where id = v_e.expense_type_id;
  select code into v_acc from accounts where id = v_type.account_id;
  if v_acc is null then raise exception 'نوع المصروف غير مرتبط بحساب في دليل الحسابات'; end if;

  -- المصروف يظهر مرة واحدة فقط في المصاريف، ويؤثر في الصندوق أو البنك عند دفعه
  v_lines := jsonb_build_array(
    jsonb_build_object('account', v_acc, 'branch', v_e.branch_id, 'debit', v_e.amount,
                       'description', coalesce(v_e.description, v_type.name_ar))
  );

  if v_e.payment_mode = 'unpaid' then
    -- غير مدفوع: التزام مستحق بدل تخفيض النقدية
    v_lines := v_lines || jsonb_build_object('account','accrued_expenses','branch', v_e.branch_id,
                 'credit', v_e.amount, 'description','مصروف مستحق غير مدفوع');
  else
    if v_e.treasury_account_id is null then
      raise exception 'يجب تحديد الصندوق أو الحساب البنكي الذي دُفع منه المصروف';
    end if;
    select kind into v_kind from treasury_accounts where id = v_e.treasury_account_id;
    v_lines := v_lines || jsonb_build_object(
                 'account', case when v_kind='cash' then 'cash' else 'bank' end,
                 'branch', v_e.branch_id, 'credit', v_e.amount,
                 'treasury', v_e.treasury_account_id, 'description','دفع مصروف');
  end if;

  v_entry := post_journal(v_e.expense_date, v_e.branch_id, 'expense', p_id,
                          'مصروف ' || v_e.expense_no, v_lines, false, p_user_id);

  update expenses set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

create or replace function post_expense_settlement(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_s expense_settlements; v_e expenses; v_kind treasury_kind; v_entry uuid; v_paid numeric(18,4);
begin
  select * into v_s from expense_settlements where id = p_id for update;
  if v_s.status <> 'draft' then raise exception 'السند مرحل أو ملغى'; end if;
  select * into v_e from expenses where id = v_s.expense_id;
  if v_e.payment_mode <> 'unpaid' then raise exception 'هذا المصروف مدفوع أصلًا'; end if;

  select coalesce(sum(amount),0) into v_paid from expense_settlements
   where expense_id = v_s.expense_id and status = 'posted';
  if v_paid + v_s.amount > v_e.amount + 0.0001 then
    raise exception 'مجموع السداد يتجاوز قيمة المصروف المستحق';
  end if;

  perform assert_period_open(v_s.settlement_date);
  select kind into v_kind from treasury_accounts where id = v_s.treasury_account_id;

  -- سداد الالتزام: لا يُسجَّل المصروف مرة ثانية
  v_entry := post_journal(v_s.settlement_date, v_e.branch_id, 'payment_voucher', p_id,
    'سداد مصروف مستحق ' || v_e.expense_no,
    jsonb_build_array(
      jsonb_build_object('account','accrued_expenses','branch', v_e.branch_id,
                         'debit', v_s.amount, 'description','سداد مصروف مستحق'),
      jsonb_build_object('account', case when v_kind='cash' then 'cash' else 'bank' end,
                         'branch', v_e.branch_id, 'credit', v_s.amount,
                         'treasury', v_s.treasury_account_id, 'description','دفع مصروف مستحق')
    ), false, p_user_id);

  update expense_settlements set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

create or replace function post_parent_revenue(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_r     parent_revenues;
  v_type  revenue_types;
  v_acc   text;
  v_kind  treasury_kind;
  v_parent uuid;
  v_lines jsonb := '[]'::jsonb;
  v_entry uuid;
begin
  select * into v_r from parent_revenues where id = p_id for update;
  if v_r.status <> 'draft' then raise exception 'لا يمكن ترحيل إيراد حالته %', v_r.status; end if;
  perform assert_period_open(v_r.revenue_date);

  select * into v_type from revenue_types where id = v_r.revenue_type_id;
  select code into v_acc from accounts where id = v_type.account_id;
  select id into v_parent from branches where kind = 'parent';

  update parent_revenues
     set tax_amount = round(amount * tax_rate / 100.0, 4),
         total = round(amount * (1 + tax_rate / 100.0), 4)
   where id = p_id;
  select * into v_r from parent_revenues where id = p_id;

  if v_r.receipt_mode = 'receivable' then
    if v_r.customer_id is null then raise exception 'الإيراد الآجل يتطلب عميلًا مسجلًا'; end if;
    v_lines := v_lines || jsonb_build_object('account','ar','branch', v_parent, 'debit', v_r.total,
                 'party_type','customer','party', v_r.customer_id, 'description','ذمة على إيراد');
  else
    if v_r.treasury_account_id is null then
      raise exception 'يجب تحديد الصندوق أو الحساب البنكي المستلم';
    end if;
    select kind into v_kind from treasury_accounts where id = v_r.treasury_account_id;
    v_lines := v_lines || jsonb_build_object(
                 'account', case when v_kind='cash' then 'cash' else 'bank' end,
                 'branch', v_parent, 'debit', v_r.total,
                 'treasury', v_r.treasury_account_id, 'description','قبض إيراد');
  end if;

  v_lines := v_lines || jsonb_build_object('account', v_acc, 'branch', v_parent,
               'credit', v_r.amount, 'description', coalesce(v_r.description, v_type.name_ar));

  if v_r.tax_amount > 0 then
    v_lines := v_lines || jsonb_build_object('account','tax_payable','branch', v_parent,
                 'credit', v_r.tax_amount, 'description','ضريبة على إيراد الشركة الأم');
  end if;

  v_entry := post_journal(v_r.revenue_date, v_parent, 'parent_revenue', p_id,
                          'إيراد الشركة الأم ' || v_r.revenue_no, v_lines, false, p_user_id);

  update parent_revenues set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

-- =============================================================================
-- توزيع المصاريف الإدارية
--   لا يُرحَّل التوزيع إلى دفتر الأستاذ — فذلك يضاعف المصروف على مستوى الشركة.
--   يُحتسب عند عرض التقارير فقط، ويظهر في تقرير الفرع كنصيب محمّل عليه.
-- =============================================================================
create or replace function admin_expense_allocation(p_from date, p_to date)
returns table (branch_id uuid, branch_name text, share_pct numeric, allocated_amount numeric)
language sql
stable
as $$
  with total as (
    select coalesce(sum(e.amount), 0) as amt
      from expenses e
     where e.status = 'posted'
       and e.is_admin and e.is_allocatable
       and e.expense_date between p_from and p_to
  ),
  method as (select admin_allocation_method as m from settings where id),
  branch_list as (select id, name_ar from branches where kind = 'branch' and is_active),
  shares as (
    select b.id, b.name_ar,
           case
             when (select m from method) = 'manual'
               then coalesce((select s.share_pct from admin_allocation_shares s where s.branch_id = b.id), 0)
             else round(100.0 / nullif((select count(*) from branch_list), 0), 6)
           end as pct
      from branch_list b
  )
  select s.id, s.name_ar, round(s.pct, 4),
         round((select amt from total) * s.pct / 100.0, 4)
    from shares s
   order by s.name_ar;
$$;
