-- =============================================================================
-- 0017_prepaid_opening_close.sql
--   1) المصاريف المدفوعة مقدمًا: أصل متداول يُحمَّل شهريًا تلقائيًا بلا تكرار.
--   2) الأرصدة الافتتاحية الموحدة: عملاء، موردون، وأرصدة مدينة/دائنة أخرى لكل جهة.
--   3) الإقفال الشهري: يحمّل المدفوع مقدمًا، ويثبّت لقطة الأرصدة الختامية للشهر.
-- =============================================================================

alter type doc_type add value if not exists 'prepaid_expense';
alter type doc_type add value if not exists 'prepaid_amortization';

-- --------------------------- حسابات ومصاريف إضافية ----------------------------
insert into accounts (code, name_ar, name_en, type, nature, parent_id, is_postable, is_system, system_key)
select v.code, v.name_ar, v.name_en, v.type::account_type, v.nature::account_nature,
       (select id from accounts where code = v.parent), true, v.is_system, v.skey
  from (values
    ('1106', 'مصاريف مدفوعة مقدمًا', 'Prepaid Expenses', 'asset',   'debit', '11', true,  'prepaid_expenses'),
    ('5209', 'الدعاية والإعلان',     'Advertising',      'expense', 'debit', '52', false, null),
    ('5210', 'التأمين',              'Insurance',        'expense', 'debit', '52', false, null),
    ('5211', 'الاشتراكات',           'Subscriptions',    'expense', 'debit', '52', false, null),
    ('5212', 'الإنترنت',             'Internet',         'expense', 'debit', '52', false, null)
  ) as v(code, name_ar, name_en, type, nature, parent, is_system, skey)
on conflict (code) do nothing;

insert into expense_types (code, name_ar, account_id, is_admin)
select v.code, v.name_ar, a.id, false
  from (values
    ('ADV', 'الدعاية والإعلان', '5209'),
    ('INS', 'التأمين',          '5210'),
    ('SUB', 'الاشتراكات',       '5211'),
    ('NET', 'الإنترنت',         '5212')
  ) as v(code, name_ar, acc)
  join accounts a on a.code = v.acc
on conflict (code) do nothing;

-- =============================================================================
-- المصاريف المدفوعة مقدمًا
-- =============================================================================
create table prepaid_expenses (
  id                  uuid primary key default gen_random_uuid(),
  prepaid_no          text not null unique,
  name                text not null,
  branch_id           uuid not null references branches(id) on delete restrict,   -- الجهة المستفيدة
  expense_type_id     uuid not null references expense_types(id) on delete restrict,
  pay_date            date not null,
  start_date          date not null,
  end_date            date not null,
  months              int  not null check (months > 0),
  total_amount        numeric(18,4) not null check (total_amount > 0),
  monthly_amount      numeric(18,4) not null default 0,
  amortized_amount    numeric(18,4) not null default 0,
  payment_mode        text not null default 'cash' check (payment_mode in ('cash','bank','unpaid')),
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  notes               text,
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  check (end_date >= start_date)
);
create index prepaid_expenses_branch_idx on prepaid_expenses(branch_id, start_date);

create table prepaid_schedule (
  id           uuid primary key default gen_random_uuid(),
  prepaid_id   uuid not null references prepaid_expenses(id) on delete cascade,
  period_year  int not null,
  period_month int not null check (period_month between 1 and 12),
  amount       numeric(18,4) not null check (amount >= 0),
  status       text not null default 'pending' check (status in ('pending','posted')),
  posted_at    timestamptz,
  unique (prepaid_id, period_year, period_month)    -- لا يُحمَّل الشهر نفسه مرتين
);
create index prepaid_schedule_period_idx on prepaid_schedule(period_year, period_month, status);

alter table prepaid_expenses enable row level security;
alter table prepaid_schedule enable row level security;
create policy prepaid_read on prepaid_expenses for select
  using (has_permission('expenses.view') and can_access_branch(branch_id));
create policy prepaid_write on prepaid_expenses for all
  using (has_permission('expenses.edit') and can_access_branch(branch_id))
  with check (has_permission('expenses.create') and can_access_branch(branch_id));
create policy prepaid_sched_read on prepaid_schedule for select
  using (exists (select 1 from prepaid_expenses p where p.id = prepaid_id
                  and has_permission('expenses.view') and can_access_branch(p.branch_id)));
create policy prepaid_sched_write on prepaid_schedule for all
  using (exists (select 1 from prepaid_expenses p where p.id = prepaid_id
                  and has_permission('expenses.post') and can_access_branch(p.branch_id)))
  with check (exists (select 1 from prepaid_expenses p where p.id = prepaid_id
                  and has_permission('expenses.post') and can_access_branch(p.branch_id)));
grant select, insert, update, delete on prepaid_expenses, prepaid_schedule to authenticated;

-- ترحيل الدفع: أصل متداول (مصروف مدفوع مقدمًا) مقابل النقد أو البنك أو المستحقات
create or replace function post_prepaid_expense(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_p      prepaid_expenses;
  v_monthly numeric(18,4);
  v_lines  jsonb;
  v_kind   treasury_kind;
  v_entry  uuid;
  v_first  date;
  i        int;
begin
  select * into v_p from prepaid_expenses where id = p_id for update;
  if not found then raise exception 'المصروف المدفوع مقدمًا غير موجود'; end if;
  if v_p.status <> 'draft' then raise exception 'لا يمكن ترحيل مستند حالته %', v_p.status; end if;
  perform assert_period_open(v_p.pay_date);

  v_monthly := round(v_p.total_amount / v_p.months, 4);

  v_lines := jsonb_build_array(
    jsonb_build_object('account','prepaid_expenses','branch',v_p.branch_id,
                       'debit', v_p.total_amount, 'description', v_p.name));
  if v_p.payment_mode = 'unpaid' then
    v_lines := v_lines || jsonb_build_object('account','accrued_expenses','branch',v_p.branch_id,
                 'credit', v_p.total_amount, 'description','مستحق الدفع: ' || v_p.name);
  else
    if v_p.treasury_account_id is null then
      raise exception 'يجب تحديد الصندوق أو البنك الذي دُفع منه المصروف';
    end if;
    select kind into v_kind from treasury_accounts where id = v_p.treasury_account_id;
    v_lines := v_lines || jsonb_build_object(
                 'account', case when v_kind = 'cash' then 'cash' else 'bank' end,
                 'branch', v_p.branch_id, 'credit', v_p.total_amount,
                 'treasury', v_p.treasury_account_id, 'description','دفع مقدم: ' || v_p.name);
  end if;

  v_entry := post_journal(v_p.pay_date, v_p.branch_id, 'prepaid_expense', p_id,
                          'مصروف مدفوع مقدمًا ' || v_p.prepaid_no || ' — ' || v_p.name,
                          v_lines, false, p_user_id);

  -- جدول الاستهلاك الشهري: الشهر الأخير يستوعب فرق التقريب
  v_first := date_trunc('month', v_p.start_date)::date;
  for i in 0 .. v_p.months - 1 loop
    insert into prepaid_schedule (prepaid_id, period_year, period_month, amount)
    values (p_id,
            extract(year  from (v_first + make_interval(months => i)))::int,
            extract(month from (v_first + make_interval(months => i)))::int,
            case when i = v_p.months - 1 then round(v_p.total_amount - v_monthly * (v_p.months - 1), 4)
                 else v_monthly end);
  end loop;

  update prepaid_expenses
     set status = 'posted', posted_at = now(), monthly_amount = v_monthly
   where id = p_id;
  return v_entry;
end;
$$;

-- تحميل المستحق من المصاريف المدفوعة مقدمًا حتى شهر معين (يُستدعى تلقائيًا عند الإقفال)
--   شهر مقفل سابق يُحمَّل في الشهر المستهدف بدل رفضه، فلا يعلق مصروف بلا تحميل.
create or replace function post_prepaid_amortization(p_year int, p_month int, p_user_id uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  s        record;
  v_acc    text;
  v_date   date;
  v_target date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_closed boolean;
  v_count  int := 0;
begin
  for s in
    select ps.id as sid, ps.period_year, ps.period_month, ps.amount,
           p.id as pid, p.name, p.branch_id, p.expense_type_id, p.prepaid_no
      from prepaid_schedule ps
      join prepaid_expenses p on p.id = ps.prepaid_id
     where p.status = 'posted' and ps.status = 'pending'
       and make_date(ps.period_year, ps.period_month, 1) <= make_date(p_year, p_month, 1)
     order by ps.period_year, ps.period_month, p.prepaid_no
       for update of ps
  loop
    select a.code into v_acc
      from expense_types t join accounts a on a.id = t.account_id
     where t.id = s.expense_type_id;
    if v_acc is null then raise exception 'نوع المصروف غير مرتبط بحساب في دليل الحسابات'; end if;

    v_date := (make_date(s.period_year, s.period_month, 1) + interval '1 month - 1 day')::date;
    select exists (select 1 from fiscal_periods
                    where year = s.period_year and month = s.period_month and status = 'closed')
      into v_closed;
    if v_closed then v_date := v_target; end if;

    if s.amount > 0 then
      perform post_journal(v_date, s.branch_id, 'prepaid_amortization', s.sid,
        format('استهلاك مصروف مدفوع مقدمًا %s — %s (%s/%s)', s.prepaid_no, s.name,
               s.period_month, s.period_year),
        jsonb_build_array(
          jsonb_build_object('account', v_acc, 'branch', s.branch_id, 'debit', s.amount,
                             'description', s.name),
          jsonb_build_object('account','prepaid_expenses','branch', s.branch_id,
                             'credit', s.amount, 'description','استهلاك ' || s.name)
        ), false, p_user_id);
    end if;

    update prepaid_schedule set status = 'posted', posted_at = now() where id = s.sid;
    update prepaid_expenses set amortized_amount = round(amortized_amount + s.amount, 4)
     where id = s.pid;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function cancel_prepaid_expense(p_id uuid, p_reason text, p_user_id uuid default null)
returns void
language plpgsql
as $$
declare v_p prepaid_expenses;
begin
  select * into v_p from prepaid_expenses where id = p_id for update;
  if v_p.status <> 'posted' then raise exception 'المستند غير مرحّل'; end if;
  if exists (select 1 from prepaid_schedule where prepaid_id = p_id and status = 'posted') then
    raise exception 'لا يمكن الإلغاء: جرى تحميل جزء من المصروف على الأشهر';
  end if;
  perform reverse_journal('prepaid_expense', p_id, v_p.pay_date,
                          'إلغاء مصروف مدفوع مقدمًا ' || v_p.prepaid_no, p_user_id);
  delete from prepaid_schedule where prepaid_id = p_id;
  update prepaid_expenses
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
   where id = p_id;
end;
$$;

-- =============================================================================
-- الأرصدة الافتتاحية: عملاء وموردون وأرصدة مدينة/دائنة أخرى لكل جهة
--   تُسجَّل مقابل حساب الأرصدة الافتتاحية (حقوق ملكية)، لا إيرادًا ولا ربحًا.
-- =============================================================================
create table opening_entries (
  id          uuid primary key default gen_random_uuid(),
  entry_no    text not null unique,
  entry_date  date not null,
  branch_id   uuid not null references branches(id) on delete restrict,
  kind        text not null check (kind in ('customer','supplier','other')),
  customer_id uuid references customers(id) on delete restrict,
  supplier_id uuid references suppliers(id) on delete restrict,
  account_id  uuid references accounts(id) on delete restrict,
  side        text not null check (side in ('debit','credit')),
  amount      numeric(18,4) not null check (amount > 0),
  description text,
  status      doc_status not null default 'draft',
  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now(),
  posted_at   timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  check ((kind = 'customer' and customer_id is not null)
      or (kind = 'supplier' and supplier_id is not null)
      or (kind = 'other'    and account_id  is not null))
);
create index opening_entries_branch_idx on opening_entries(branch_id, entry_date);

alter table opening_entries enable row level security;
create policy opening_read on opening_entries for select
  using (has_permission('settings.view') and can_access_branch(branch_id));
create policy opening_write on opening_entries for all
  using (has_permission('settings.edit') and can_access_branch(branch_id))
  with check (has_permission('settings.edit') and can_access_branch(branch_id));
grant select, insert, update, delete on opening_entries to authenticated;

create or replace function post_opening_entry(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_o     opening_entries;
  v_acc   text;
  v_skey  text;
  v_line  jsonb;
  v_ctr   jsonb;
  v_desc  text;
  v_entry uuid;
begin
  select * into v_o from opening_entries where id = p_id for update;
  if not found then raise exception 'الرصيد الافتتاحي غير موجود'; end if;
  if v_o.status <> 'draft' then raise exception 'لا يمكن ترحيل مستند حالته %', v_o.status; end if;
  perform assert_period_open(v_o.entry_date);

  if v_o.kind = 'customer' then
    v_acc := 'ar';
    v_desc := 'رصيد افتتاحي للعميل ' || (select name from customers where id = v_o.customer_id);
  elsif v_o.kind = 'supplier' then
    v_acc := 'ap';
    v_desc := 'رصيد افتتاحي للمورد ' || (select name from suppliers where id = v_o.supplier_id);
  else
    select code, system_key into v_acc, v_skey from accounts where id = v_o.account_id;
    if v_skey in ('cash','bank','ar','ap','inventory','opening_equity') then
      raise exception 'هذا الحساب له شاشته الخاصة للأرصدة الافتتاحية (الصندوق/البنك/العملاء/الموردين/المخزون)';
    end if;
    v_desc := coalesce(v_o.description, 'رصيد افتتاحي');
  end if;

  v_line := jsonb_build_object('account', v_acc, 'branch', v_o.branch_id,
              case v_o.side when 'debit' then 'debit' else 'credit' end, v_o.amount,
              'description', v_desc);
  if v_o.kind = 'customer' then
    v_line := v_line || jsonb_build_object('party_type','customer','party', v_o.customer_id);
  elsif v_o.kind = 'supplier' then
    v_line := v_line || jsonb_build_object('party_type','supplier','party', v_o.supplier_id);
  end if;

  v_ctr := jsonb_build_object('account','opening_equity','branch', v_o.branch_id,
             case v_o.side when 'debit' then 'credit' else 'debit' end, v_o.amount,
             'description','مقابل رصيد افتتاحي');

  v_entry := post_journal(v_o.entry_date, v_o.branch_id, 'opening_balance', p_id,
                          v_desc, jsonb_build_array(v_line, v_ctr), false, p_user_id);

  update opening_entries set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

create or replace function cancel_opening_entry(p_id uuid, p_reason text, p_user_id uuid default null)
returns void
language plpgsql
as $$
declare v_o opening_entries;
begin
  select * into v_o from opening_entries where id = p_id for update;
  if v_o.status <> 'posted' then raise exception 'المستند غير مرحّل'; end if;
  perform reverse_journal('opening_balance', p_id, v_o.entry_date,
                          'إلغاء رصيد افتتاحي', p_user_id);
  update opening_entries set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
   where id = p_id;
end;
$$;

-- =============================================================================
-- لقطة الأرصدة الختامية لكل جهة عند إقفال الشهر
--   تثبّت أرقام الشهر (مبيعات، تكلفة، مصاريف، ربح، مخزون، نقدية، ذمم)، وهي نفسها
--   الأرصدة الافتتاحية للشهر التالي لأن الدفتر متصل.
-- =============================================================================
create table period_snapshots (
  id               uuid primary key default gen_random_uuid(),
  period_year      int not null,
  period_month     int not null check (period_month between 1 and 12),
  branch_id        uuid not null references branches(id) on delete cascade,
  net_sales        numeric(18,4) not null default 0,
  purchases        numeric(18,4) not null default 0,
  cogs             numeric(18,4) not null default 0,
  gross_profit     numeric(18,4) not null default 0,
  total_expenses   numeric(18,4) not null default 0,
  net_profit       numeric(18,4) not null default 0,
  inventory_value  numeric(18,4) not null default 0,
  cash_balance     numeric(18,4) not null default 0,
  bank_balance     numeric(18,4) not null default 0,
  receivables      numeric(18,4) not null default 0,
  payables         numeric(18,4) not null default 0,
  prepaid_balance  numeric(18,4) not null default 0,
  captured_at      timestamptz not null default now(),
  unique (period_year, period_month, branch_id)
);
alter table period_snapshots enable row level security;
create policy period_snap_read on period_snapshots for select
  using (has_permission('reports.view') and can_access_branch(branch_id));
grant select on period_snapshots to authenticated;
revoke insert, update, delete on period_snapshots from authenticated;

create or replace function capture_period_snapshot(p_year int, p_month int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  b      record;
  p      record;
begin
  delete from period_snapshots where period_year = p_year and period_month = p_month;

  for b in select id from branches loop
    select * into p from branch_pnl(v_from, v_to, b.id);
    insert into period_snapshots (period_year, period_month, branch_id, net_sales, purchases, cogs,
                                  gross_profit, total_expenses, net_profit, inventory_value,
                                  cash_balance, bank_balance, receivables, payables, prepaid_balance)
    values (p_year, p_month, b.id, p.net_sales,
      coalesce((select round(sum(i.total - i.tax_total), 4) from purchase_invoices i
                 where i.branch_id = b.id and i.status = 'posted'
                   and i.invoice_date between v_from and v_to), 0),
      p.cogs, p.gross_profit, p.total_expenses, p.net_profit,
      coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
                  join accounts a on a.id = jl.account_id
                 where a.system_key = 'inventory' and jl.branch_id = b.id and jl.entry_date <= v_to), 0),
      coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
                  join treasury_accounts t on t.id = jl.treasury_account_id
                 where t.branch_id = b.id and t.kind = 'cash' and jl.entry_date <= v_to), 0),
      coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
                  join treasury_accounts t on t.id = jl.treasury_account_id
                 where t.branch_id = b.id and t.kind = 'bank' and jl.entry_date <= v_to), 0),
      coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
                  join accounts a on a.id = jl.account_id
                 where a.system_key = 'ar' and jl.branch_id = b.id and jl.entry_date <= v_to), 0),
      coalesce((select round(sum(jl.credit - jl.debit), 4) from journal_lines jl
                  join accounts a on a.id = jl.account_id
                 where a.system_key = 'ap' and jl.branch_id = b.id and jl.entry_date <= v_to), 0),
      coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
                  join accounts a on a.id = jl.account_id
                 where a.system_key = 'prepaid_expenses' and jl.branch_id = b.id
                   and jl.entry_date <= v_to), 0));
  end loop;
end;
$$;

-- =============================================================================
-- الإقفال الشهري (يشمل الآن المدفوع مقدمًا واللقطة الختامية)
-- =============================================================================
create or replace function close_period(p_year int, p_month int, p_user_id uuid default null)
returns void
language plpgsql
as $$
declare
  v_period fiscal_periods;
  v_drafts int;
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_next date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_diff numeric;
begin
  select * into v_period from fiscal_periods where year = p_year and month = p_month for update;
  if not found then raise exception 'الفترة %/% غير معرفة', p_month, p_year; end if;
  if v_period.status = 'closed' then raise exception 'الفترة مقفلة مسبقًا'; end if;

  -- لا يُقفل شهر فيه مستندات غير مرحلة
  select
    (select count(*) from sales_invoices    where status='draft' and invoice_date    between v_from and v_to) +
    (select count(*) from purchase_invoices where status='draft' and invoice_date    between v_from and v_to) +
    (select count(*) from sales_returns     where status='draft' and return_date     between v_from and v_to) +
    (select count(*) from purchase_returns  where status='draft' and return_date     between v_from and v_to) +
    (select count(*) from stock_transfers   where status='draft' and transfer_date   between v_from and v_to) +
    (select count(*) from stock_adjustments where status='draft' and adjustment_date between v_from and v_to) +
    (select count(*) from collections       where status='draft' and collection_date between v_from and v_to) +
    (select count(*) from supplier_payments where status='draft' and payment_date    between v_from and v_to) +
    (select count(*) from treasury_transfers where status='draft' and transfer_date  between v_from and v_to) +
    (select count(*) from expenses          where status='draft' and expense_date    between v_from and v_to) +
    (select count(*) from parent_revenues   where status='draft' and revenue_date    between v_from and v_to) +
    (select count(*) from vouchers          where status='draft' and voucher_date    between v_from and v_to) +
    (select count(*) from prepaid_expenses  where status='draft' and pay_date        between v_from and v_to) +
    (select count(*) from opening_entries   where status='draft' and entry_date      between v_from and v_to)
  into v_drafts;

  if v_drafts > 0 then
    raise exception 'يوجد % مستند غير مرحل في الفترة، رحّلها أو ألغها قبل الإقفال', v_drafts;
  end if;

  -- تحميل المصاريف المدفوعة مقدمًا المستحقة حتى هذا الشهر
  perform post_prepaid_amortization(p_year, p_month, p_user_id);

  -- القيود يجب أن تكون متوازنة
  select coalesce(sum(debit - credit), 0) into v_diff
    from journal_lines where entry_date between v_from and v_to;
  if round(v_diff, 4) <> 0 then
    raise exception 'قيود الفترة غير متوازنة بفارق %', v_diff;
  end if;

  -- تثبيت أرقام الشهر والأرصدة الختامية
  perform capture_period_snapshot(p_year, p_month);

  update fiscal_periods
     set status = 'closed', closed_at = now(), closed_by = p_user_id
   where id = v_period.id;

  -- فتح الشهر التالي
  insert into fiscal_periods (year, month)
  values (extract(year from v_next)::int, extract(month from v_next)::int)
  on conflict do nothing;

  insert into audit_logs (user_id, action, entity, entity_id, summary)
  values (p_user_id, 'close_period', 'fiscal_periods', v_period.id::text,
          format('إقفال شهر %s/%s', p_month, p_year));
end;
$$;

create or replace function reopen_period(p_year int, p_month int, p_user_id uuid default null)
returns void
language plpgsql
as $$
begin
  update fiscal_periods
     set status = 'open', closed_at = null, closed_by = null
   where year = p_year and month = p_month and status = 'closed';

  if not found then raise exception 'الفترة غير مقفلة'; end if;

  delete from period_snapshots where period_year = p_year and period_month = p_month;

  insert into audit_logs (user_id, action, entity, entity_id, summary)
  values (p_user_id, 'reopen_period', 'fiscal_periods', null,
          format('إعادة فتح شهر %s/%s', p_month, p_year));
end;
$$;

alter function capture_period_snapshot(int, int) security definer set search_path = public;
grant execute on all functions in schema public to authenticated;
alter function reopen_period(int, int, uuid) security definer set search_path = public;
