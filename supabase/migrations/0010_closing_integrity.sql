-- =============================================================================
-- 0010_closing_integrity.sql — الإقفال الشهري وفتح شهر جديد، إقفال السنة
--   المالية، سجل النسخ الاحتياطي، وفحوص سلامة البيانات
-- =============================================================================

-- --------------------------- الإقفال الشهري -----------------------------------
-- الأرصدة تُرحَّل تلقائيًا لأن الدفتر متصل: رصيد آخر الشهر هو رصيد أول الشهر التالي.
-- الإقفال يمنع أي حركة جديدة في الشهر المقفل ويفتح الشهر التالي.
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
    (select count(*) from vouchers          where status='draft' and voucher_date    between v_from and v_to)
  into v_drafts;

  if v_drafts > 0 then
    raise exception 'يوجد % مستند غير مرحل في الفترة، رحّلها أو ألغها قبل الإقفال', v_drafts;
  end if;

  -- القيود يجب أن تكون متوازنة
  select coalesce(sum(debit - credit), 0) into v_diff
    from journal_lines where entry_date between v_from and v_to;
  if round(v_diff, 4) <> 0 then
    raise exception 'قيود الفترة غير متوازنة بفارق %', v_diff;
  end if;

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

  insert into audit_logs (user_id, action, entity, entity_id, summary)
  values (p_user_id, 'reopen_period', 'fiscal_periods', null,
          format('إعادة فتح شهر %s/%s', p_month, p_year));
end;
$$;

-- ---------------------------- إقفال السنة المالية -----------------------------
-- ترحيل أرصدة الإيرادات والمصاريف إلى الأرباح المدورة لكل وحدة على حدة.
create or replace function close_fiscal_year(p_year int, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_start date;
  v_from  date;
  v_to    date;
  v_lines jsonb := '[]'::jsonb;
  v_row   record;
  v_total numeric(18,4) := 0;
  v_parent uuid;
  v_entry uuid;
begin
  select fiscal_year_start_month into v_start from settings where id;
  v_from := make_date(p_year, (select fiscal_year_start_month from settings where id), 1);
  v_to   := (v_from + interval '1 year - 1 day')::date;

  select id into v_parent from branches where kind = 'parent';

  for v_row in
    select a.code, jl.branch_id,
           round(sum(jl.debit - jl.credit), 4) as bal
      from journal_lines jl
      join accounts a on a.id = jl.account_id
     where a.type in ('revenue','expense')
       and jl.entry_date between v_from and v_to
     group by a.code, jl.branch_id
    having round(sum(jl.debit - jl.credit), 4) <> 0
  loop
    -- عكس رصيد الحساب لإقفاله
    if v_row.bal > 0 then
      v_lines := v_lines || jsonb_build_object('account', v_row.code, 'branch', v_row.branch_id,
                   'credit', v_row.bal, 'description', 'إقفال حساب في نهاية السنة');
    else
      v_lines := v_lines || jsonb_build_object('account', v_row.code, 'branch', v_row.branch_id,
                   'debit', -v_row.bal, 'description', 'إقفال حساب في نهاية السنة');
    end if;
    v_total := v_total + v_row.bal;
  end loop;

  if v_lines = '[]'::jsonb then raise exception 'لا توجد أرصدة لإقفالها'; end if;

  -- الفرق = صافي نتيجة السنة → الأرباح المدورة
  if v_total > 0 then
    v_lines := v_lines || jsonb_build_object('account','retained_earnings','branch', v_parent,
                 'debit', v_total, 'description','صافي خسارة السنة');
  else
    v_lines := v_lines || jsonb_build_object('account','retained_earnings','branch', v_parent,
                 'credit', -v_total, 'description','صافي ربح السنة');
  end if;

  v_entry := post_journal(v_to, v_parent, 'period_closing', null,
                          format('إقفال السنة المالية %s', p_year), v_lines, false, p_user_id);

  insert into audit_logs (user_id, action, entity, entity_id, summary)
  values (p_user_id, 'close_year', 'journal_entries', v_entry::text,
          format('إقفال السنة المالية %s', p_year));

  return v_entry;
end;
$$;

-- ---------------------------- النسخ الاحتياطي ---------------------------------
create table backup_log (
  id          uuid primary key default gen_random_uuid(),
  taken_at    timestamptz not null default now(),
  taken_by    uuid references app_users(id),
  kind        text not null default 'manual' check (kind in ('manual','scheduled')),
  location    text,
  size_bytes  bigint,
  status      text not null default 'ok' check (status in ('ok','failed')),
  notes       text
);

-- =============================================================================
-- فحوص سلامة البيانات — تُشغَّل بعد إدخال البيانات التجريبية وقبل الاعتماد
-- =============================================================================
create or replace function system_integrity_check()
returns table (check_name text, expected numeric, actual numeric, is_ok boolean, details text)
language plpgsql
as $$
begin
  -- 1) توازن دفتر الأستاذ ككل
  return query
  select 'توازن القيود (مدين = دائن)',
         round(coalesce(sum(debit), 0), 4),
         round(coalesce(sum(credit), 0), 4),
         round(coalesce(sum(debit), 0), 4) = round(coalesce(sum(credit), 0), 4),
         'مجموع المدين يجب أن يساوي مجموع الدائن'
    from journal_lines;

  -- 2) كل قيد على حدة متوازن
  return query
  select 'قيود غير متوازنة', 0::numeric, count(*)::numeric, count(*) = 0,
         'عدد القيود التي لا يتساوى فيها المدين والدائن'
    from (
      select entry_id from journal_lines
       group by entry_id
      having round(sum(debit), 4) <> round(sum(credit), 4)
    ) x;

  -- 3) قيمة المخزون في الدفتر = قيمة المخزون في حركة المخزون (شرط الملف)
  return query
  select 'مطابقة قيمة المخزون مع الدفتر',
         round(coalesce((select sum(stock_value) from product_branch_stock), 0), 2),
         round(coalesce((select sum(jl.debit - jl.credit) from journal_lines jl
                          join accounts a on a.id = jl.account_id
                         where a.system_key = 'inventory'), 0), 2),
         round(coalesce((select sum(stock_value) from product_branch_stock), 0), 2)
           = round(coalesce((select sum(jl.debit - jl.credit) from journal_lines jl
                              join accounts a on a.id = jl.account_id
                             where a.system_key = 'inventory'), 0), 2),
         'رصيد حساب المخزون يجب أن يطابق مجموع قيمة المخزون في الفروع';

  -- 4) الذمم المدينة في الدفتر = مجموع أرصدة العملاء
  return query
  select 'مطابقة الذمم المدينة',
         round(coalesce((select sum(customer_balance(c.id)) from customers c), 0), 2),
         round(coalesce((select sum(jl.debit - jl.credit) from journal_lines jl
                          join accounts a on a.id = jl.account_id
                         where a.system_key = 'ar'), 0), 2),
         round(coalesce((select sum(customer_balance(c.id)) from customers c), 0), 2)
           = round(coalesce((select sum(jl.debit - jl.credit) from journal_lines jl
                              join accounts a on a.id = jl.account_id
                             where a.system_key = 'ar'), 0), 2),
         'مجموع كشوف العملاء يجب أن يطابق رصيد حساب الذمم المدينة';

  -- 5) الذمم الدائنة في الدفتر = مجموع أرصدة الموردين
  return query
  select 'مطابقة الذمم الدائنة',
         round(coalesce((select sum(supplier_balance(s.id)) from suppliers s), 0), 2),
         round(coalesce((select sum(jl.credit - jl.debit) from journal_lines jl
                          join accounts a on a.id = jl.account_id
                         where a.system_key = 'ap'), 0), 2),
         round(coalesce((select sum(supplier_balance(s.id)) from suppliers s), 0), 2)
           = round(coalesce((select sum(jl.credit - jl.debit) from journal_lines jl
                              join accounts a on a.id = jl.account_id
                             where a.system_key = 'ap'), 0), 2),
         'مجموع كشوف الموردين يجب أن يطابق رصيد حساب الذمم الدائنة';

  -- 6) كل مستند مرحّل له قيد واحد فقط
  return query
  select 'مستندات مرحلة بلا قيد', 0::numeric, count(*)::numeric, count(*) = 0,
         'كل فاتورة مرحلة يجب أن يقابلها قيد واحد'
    from (
      select i.id from sales_invoices i
       where i.status = 'posted'
         and not exists (select 1 from journal_entries je
                          where je.doc_type='sales_invoice' and je.doc_id = i.id and not je.is_reversal)
      union all
      select i.id from purchase_invoices i
       where i.status = 'posted'
         and not exists (select 1 from journal_entries je
                          where je.doc_type='purchase_invoice' and je.doc_id = i.id and not je.is_reversal)
    ) x;

  -- 7) التحويلات بين الوحدات صافي أثرها صفر على مستوى الشركة
  return query
  select 'حيادية التحويلات بين الوحدات', 0::numeric,
         round(coalesce(sum(jl.debit - jl.credit), 0), 4),
         round(coalesce(sum(jl.debit - jl.credit), 0), 4) = 0,
         'تحويل البضاعة لا يغير قيمة مخزون الشركة ككل'
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
   where je.doc_type = 'stock_transfer';

  -- 8) التحويل بين الصندوق والبنك لا يغير صافي النقدية
  return query
  select 'حيادية التحويل بين الصندوق والبنك', 0::numeric,
         round(coalesce(sum(jl.debit - jl.credit), 0), 4),
         round(coalesce(sum(jl.debit - jl.credit), 0), 4) = 0,
         'التحويل لا ينشئ إيرادًا ولا يغير صافي النقدية (عدا الرسوم)'
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.doc_type = 'treasury_transfer'
     and a.system_key in ('cash','bank');

  -- 9) لا مخزون سالب (إلا بإذن صريح من الإعدادات)
  return query
  select 'كميات سالبة في المخزون', 0::numeric, count(*)::numeric,
         count(*) = 0 or (select allow_negative_stock from settings where id),
         'لا يجوز أن يكون رصيد منتج سالبًا دون إذن إداري'
    from product_branch_stock where quantity < 0;

  -- 10) التحصيلات لا تُسجَّل إيرادًا
  return query
  select 'التحصيل لا يُسجَّل إيرادًا', 0::numeric, count(*)::numeric, count(*) = 0,
         'قيود التحصيل يجب ألا تمس حسابات الإيرادات'
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.doc_type = 'collection' and a.type = 'revenue';
end;
$$;
