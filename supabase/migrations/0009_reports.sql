-- =============================================================================
-- 0009_reports.sql — التقارير: كلها تُحسب من دفتر الأستاذ وحركات المخزون،
--   فلا يمكن أن تتعارض مع تفاصيل الفواتير أو أن تحتسب العملية مرتين.
-- =============================================================================

-- ---------------------- مكونات الربحية لوحدة واحدة ----------------------------
create or replace function branch_pnl(p_from date, p_to date, p_branch_id uuid)
returns table (
  gross_sales        numeric,
  sales_returns      numeric,
  sales_discounts    numeric,
  net_sales          numeric,
  cogs               numeric,
  gross_profit       numeric,
  direct_expenses    numeric,
  admin_share        numeric,
  total_expenses     numeric,
  net_profit         numeric,
  margin_before      numeric,
  margin_after       numeric
)
language sql
stable
as $$
  with l as (
    select jl.*, a.system_key, a.code, a.type
      from journal_lines jl
      join accounts a on a.id = jl.account_id
     where jl.branch_id = p_branch_id
       and jl.entry_date between p_from and p_to
  ),
  base as (
    select
      coalesce(sum(credit - debit) filter (where system_key = 'sales'), 0)           as gross_sales,
      coalesce(sum(debit - credit) filter (where system_key = 'sales_returns'), 0)   as sales_returns,
      coalesce(sum(debit - credit) filter (where system_key = 'sales_discounts'), 0) as sales_discounts,
      coalesce(sum(debit - credit) filter (where system_key = 'cogs'), 0)            as cogs,
      coalesce(sum(debit - credit) filter (
        where type = 'expense' and system_key is distinct from 'cogs' and code not like '53%'
      ), 0) as direct_expenses
    from l
  ),
  alloc as (
    select coalesce((select allocated_amount from admin_expense_allocation(p_from, p_to) x
                      where x.branch_id = p_branch_id), 0) as share
  ),
  calc as (
    select b.*, a.share,
           round(b.gross_sales - b.sales_returns - b.sales_discounts, 4) as net_sales
      from base b, alloc a
  )
  select
    round(gross_sales, 4),
    round(sales_returns, 4),
    round(sales_discounts, 4),
    net_sales,
    round(cogs, 4),
    round(net_sales - cogs, 4)                                        as gross_profit,
    round(direct_expenses, 4),
    round(share, 4),
    round(direct_expenses + share, 4)                                 as total_expenses,
    round(net_sales - cogs - direct_expenses - share, 4)              as net_profit,
    case when net_sales = 0 then 0
         else round((net_sales - cogs) / net_sales * 100, 4) end      as margin_before,
    case when net_sales = 0 then 0
         else round((net_sales - cogs - direct_expenses - share) / net_sales * 100, 4) end as margin_after
  from calc;
$$;

-- ------------------------ التقرير المالي لكل فرع ------------------------------
create or replace function report_branch_financial(p_from date, p_to date, p_branch_id uuid default null)
returns table (
  branch_id        uuid,
  branch_name      text,
  branch_kind      branch_kind,
  gross_sales      numeric,
  sales_returns    numeric,
  sales_discounts  numeric,
  net_sales        numeric,
  cogs             numeric,
  gross_profit     numeric,
  margin_before    numeric,
  direct_expenses  numeric,
  admin_share      numeric,
  total_expenses   numeric,
  net_profit       numeric,
  margin_after     numeric,
  collections      numeric,
  receivables      numeric,
  payables         numeric,
  inventory_value  numeric,
  cash_balance     numeric,
  bank_balance     numeric
)
language sql
stable
as $$
  select
    b.id, b.name_ar, b.kind,
    p.gross_sales, p.sales_returns, p.sales_discounts, p.net_sales,
    p.cogs, p.gross_profit, p.margin_before,
    p.direct_expenses, p.admin_share, p.total_expenses, p.net_profit, p.margin_after,
    -- إجمالي التحصيلات خلال الفترة (ليست إيرادًا، تُعرض على حدة)
    coalesce((select round(sum(c.amount), 4) from collections c
               where c.branch_id = b.id and c.status = 'posted'
                 and c.collection_date between p_from and p_to), 0),
    -- أرصدة تراكمية حتى نهاية الفترة
    coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
               join accounts a on a.id = jl.account_id
              where a.system_key = 'ar' and jl.branch_id = b.id and jl.entry_date <= p_to), 0),
    coalesce((select round(sum(jl.credit - jl.debit), 4) from journal_lines jl
               join accounts a on a.id = jl.account_id
              where a.system_key = 'ap' and jl.branch_id = b.id and jl.entry_date <= p_to), 0),
    coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
               join accounts a on a.id = jl.account_id
              where a.system_key = 'inventory' and jl.branch_id = b.id and jl.entry_date <= p_to), 0),
    coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
               join treasury_accounts t on t.id = jl.treasury_account_id
              where t.branch_id = b.id and t.kind = 'cash' and jl.entry_date <= p_to), 0),
    coalesce((select round(sum(jl.debit - jl.credit), 4) from journal_lines jl
               join treasury_accounts t on t.id = jl.treasury_account_id
              where t.branch_id = b.id and t.kind = 'bank' and jl.entry_date <= p_to), 0)
  from branches b
  cross join lateral branch_pnl(p_from, p_to, b.id) p
  where (p_branch_id is null or b.id = p_branch_id)
  order by b.sort_order;
$$;

-- ----------------------- ملخص الشركة: الفروع + الشركة الأم --------------------
-- يوضح الربح قبل إضافة إيراد الشركة الأم وبعده، بلا ازدواجية احتساب.
create or replace function report_company_summary(p_from date, p_to date)
returns table (
  branches_net_sales          numeric,
  branches_cogs               numeric,
  branches_gross_profit       numeric,
  branches_direct_expenses    numeric,
  admin_expenses_total        numeric,
  admin_allocated_to_branches numeric,
  branches_net_profit         numeric,
  parent_unallocated_expenses numeric,
  profit_before_parent_revenue numeric,
  parent_revenue              numeric,
  profit_after_parent_revenue numeric
)
language sql
stable
as $$
  with br as (
    select coalesce(sum(p.net_sales),0) ns, coalesce(sum(p.cogs),0) cg,
           coalesce(sum(p.gross_profit),0) gp, coalesce(sum(p.direct_expenses),0) de,
           coalesce(sum(p.admin_share),0) sh, coalesce(sum(p.net_profit),0) np
      from branches b
      cross join lateral branch_pnl(p_from, p_to, b.id) p
     where b.kind = 'branch'
  ),
  parent as (
    select
      coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'revenue'), 0) as revenue,
      coalesce(sum(jl.debit - jl.credit) filter (
        where a.type = 'expense' and a.system_key is distinct from 'cogs'), 0)  as expenses
      from journal_lines jl
      join accounts a on a.id = jl.account_id
      join branches b on b.id = jl.branch_id and b.kind = 'parent'
     where jl.entry_date between p_from and p_to
  ),
  admin_total as (
    select coalesce(sum(e.amount), 0) amt
      from expenses e
     where e.status = 'posted' and e.is_admin
       and e.expense_date between p_from and p_to
  )
  select
    round(br.ns, 4), round(br.cg, 4), round(br.gp, 4), round(br.de, 4),
    round((select amt from admin_total), 4),
    round(br.sh, 4),
    round(br.np, 4),
    round(parent.expenses - br.sh, 4)                                  as parent_unallocated,
    round(br.np - (parent.expenses - br.sh), 4)                        as profit_before_parent_rev,
    round(parent.revenue, 4),
    round(br.np - (parent.expenses - br.sh) + parent.revenue, 4)       as profit_after_parent_rev
  from br, parent;
$$;

-- ------------------- ربحية المنتجات وتقارير أعلى 10 ---------------------------
-- تُجمع كل حركات المنتج في الفترة في صف واحد، ولا يتكرر المنتج بسبب تعدد الفواتير.
create or replace function report_product_profitability(
  p_from date, p_to date, p_branch_id uuid default null, p_include_zero boolean default false
)
returns table (
  product_id    uuid,
  product_code  text,
  product_name  text,
  category_name text,
  qty_sold      numeric,
  net_sales     numeric,
  cogs          numeric,
  gross_profit  numeric,
  margin_pct    numeric
)
language sql
stable
as $$
  with sales as (
    select l.product_id,
           sum(l.quantity)   as qty,
           sum(l.net_amount) as net,
           sum(l.cogs_amount) as cost
      from sales_invoice_lines l
      join sales_invoices i on i.id = l.invoice_id
     where i.status = 'posted'
       and i.invoice_date between p_from and p_to
       and (p_branch_id is null or i.branch_id = p_branch_id)
     group by l.product_id
  ),
  returns as (
    select l.product_id,
           sum(l.quantity)    as qty,
           sum(l.net_amount)  as net,
           sum(l.cogs_amount) as cost
      from sales_return_lines l
      join sales_returns r on r.id = l.return_id
     where r.status = 'posted'
       and r.return_date between p_from and p_to
       and (p_branch_id is null or r.branch_id = p_branch_id)
     group by l.product_id
  ),
  agg as (
    select p.id, p.code, p.name_ar, c.name_ar as cat,
           coalesce(s.qty,0)  - coalesce(r.qty,0)  as qty_sold,
           coalesce(s.net,0)  - coalesce(r.net,0)  as net_sales,
           coalesce(s.cost,0) - coalesce(r.cost,0) as cogs
      from products p
      left join product_categories c on c.id = p.category_id
      left join sales   s on s.product_id = p.id
      left join returns r on r.product_id = p.id
  )
  select id, code, name_ar, cat,
         round(qty_sold, 4), round(net_sales, 4), round(cogs, 4),
         round(net_sales - cogs, 4),
         case when net_sales = 0 then 0 else round((net_sales - cogs) / net_sales * 100, 4) end
    from agg
   where p_include_zero or qty_sold <> 0 or net_sales <> 0
   order by net_sales desc, code;
$$;

-- أعلى المنتجات: p_order_by = 'sales' (القيمة) أو 'quantity' (الكمية) أو 'profit' (الربح)
create or replace function report_top_products(
  p_from date, p_to date, p_branch_id uuid default null,
  p_order_by text default 'sales', p_limit int default 10, p_include_zero boolean default false
)
returns table (
  rank_no       bigint,
  product_id    uuid,
  product_code  text,
  product_name  text,
  qty_sold      numeric,
  net_sales     numeric,
  cogs          numeric,
  gross_profit  numeric,
  margin_pct    numeric
)
language sql
stable
as $$
  select row_number() over (
           order by
             case when p_order_by = 'quantity' then t.qty_sold
                  when p_order_by = 'profit'   then t.gross_profit
                  else t.net_sales end desc,
             t.product_code asc            -- تساوي القيم: ترتيب ثابت بكود المنتج
         ) as rank_no,
         t.product_id, t.product_code, t.product_name,
         t.qty_sold, t.net_sales, t.cogs, t.gross_profit, t.margin_pct
    from report_product_profitability(p_from, p_to, p_branch_id, p_include_zero) t
   order by rank_no
   limit greatest(p_limit, 0);
$$;

-- --------------------------- بطاقة حركة المنتج --------------------------------
create or replace function report_product_card(
  p_product_id uuid, p_branch_id uuid, p_from date, p_to date
)
returns table (
  move_date    date,
  doc_type     doc_type,
  doc_no       text,
  description  text,
  qty_in       numeric,
  qty_out      numeric,
  unit_cost    numeric,
  total_cost   numeric,
  balance_qty  numeric,
  balance_cost numeric
)
language sql
stable
as $$
  select m.move_date, m.doc_type, m.doc_no, m.description,
         case when m.direction = 'in'  then m.quantity else 0 end,
         case when m.direction = 'out' then m.quantity else 0 end,
         m.unit_cost, m.total_cost, m.qty_after, m.value_after
    from stock_movements m
   where m.product_id = p_product_id
     and m.branch_id = p_branch_id
     and m.move_date between p_from and p_to
   order by m.move_date, m.created_at;
$$;

-- --------------------------- تقرير المخزون ------------------------------------
create or replace function report_inventory(p_branch_id uuid default null, p_low_only boolean default false)
returns table (
  branch_id     uuid,
  branch_name   text,
  product_id    uuid,
  product_code  text,
  product_name  text,
  category_name text,
  quantity      numeric,
  avg_cost      numeric,
  stock_value   numeric,
  reorder_level numeric,
  is_low        boolean
)
language sql
stable
as $$
  select b.id, b.name_ar, p.id, p.code, p.name_ar, c.name_ar,
         round(s.quantity, 4), round(s.avg_cost, 6), round(s.stock_value, 4),
         round(coalesce(s.reorder_level, p.reorder_level), 4),
         s.quantity <= coalesce(s.reorder_level, p.reorder_level)
    from product_branch_stock s
    join products p on p.id = s.product_id
    join branches b on b.id = s.branch_id
    left join product_categories c on c.id = p.category_id
   where (p_branch_id is null or s.branch_id = p_branch_id)
     and (not p_low_only or s.quantity <= coalesce(s.reorder_level, p.reorder_level))
   order by b.sort_order, p.code;
$$;

-- --------------------------- كشف حساب العميل ----------------------------------
create or replace function report_customer_statement(
  p_customer_id uuid, p_from date, p_to date
)
returns table (
  entry_date  date,
  doc_type    doc_type,
  doc_no      text,
  description text,
  debit       numeric,
  credit      numeric,
  balance     numeric
)
language sql
stable
as $$
  with lines as (
    select jl.entry_date, je.doc_type, je.entry_no, je.description,
           jl.debit, jl.credit, je.created_at
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join accounts a on a.id = jl.account_id
     where a.system_key = 'ar'
       and jl.party_type = 'customer' and jl.party_id = p_customer_id
  ),
  opening as (
    select coalesce(sum(debit - credit), 0) ob from lines where entry_date < p_from
  ),
  period as (
    select * from lines where entry_date between p_from and p_to
  )
  select p_from, 'opening_balance'::doc_type, null::text, 'رصيد ما قبل الفترة',
         case when ob > 0 then ob else 0 end, case when ob < 0 then -ob else 0 end, ob
    from opening
  union all
  select entry_date, doc_type, entry_no, description, debit, credit,
         (select ob from opening) + sum(debit - credit) over (order by entry_date, created_at
            rows between unbounded preceding and current row)
    from period
   order by 1, 3 nulls first;
$$;

-- --------------------------- كشف حساب المورد ----------------------------------
create or replace function report_supplier_statement(
  p_supplier_id uuid, p_from date, p_to date
)
returns table (
  entry_date  date,
  doc_type    doc_type,
  doc_no      text,
  description text,
  debit       numeric,
  credit      numeric,
  balance     numeric
)
language sql
stable
as $$
  with lines as (
    select jl.entry_date, je.doc_type, je.entry_no, je.description,
           jl.debit, jl.credit, je.created_at
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      join accounts a on a.id = jl.account_id
     where a.system_key = 'ap'
       and jl.party_type = 'supplier' and jl.party_id = p_supplier_id
  ),
  opening as (
    select coalesce(sum(credit - debit), 0) ob from lines where entry_date < p_from
  ),
  period as (select * from lines where entry_date between p_from and p_to)
  select p_from, 'opening_balance'::doc_type, null::text, 'رصيد ما قبل الفترة',
         case when ob < 0 then -ob else 0 end, case when ob > 0 then ob else 0 end, ob
    from opening
  union all
  select entry_date, doc_type, entry_no, description, debit, credit,
         (select ob from opening) + sum(credit - debit) over (order by entry_date, created_at
            rows between unbounded preceding and current row)
    from period
   order by 1, 3 nulls first;
$$;

-- ----------------------- كشف الصندوق / الحساب البنكي --------------------------
create or replace function report_treasury_statement(
  p_account_id uuid, p_from date, p_to date
)
returns table (
  entry_date  date,
  doc_type    doc_type,
  doc_no      text,
  description text,
  receipts    numeric,
  payments    numeric,
  balance     numeric
)
language sql
stable
as $$
  with lines as (
    select jl.entry_date, je.doc_type, je.entry_no,
           coalesce(jl.description, je.description) as description,
           jl.debit, jl.credit, je.created_at
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
     where jl.treasury_account_id = p_account_id
  ),
  opening as (select coalesce(sum(debit - credit), 0) ob from lines where entry_date < p_from),
  period  as (select * from lines where entry_date between p_from and p_to)
  select p_from, 'opening_balance'::doc_type, null::text, 'الرصيد الافتتاحي',
         0::numeric, 0::numeric, ob from opening
  union all
  select entry_date, doc_type, entry_no, description, debit, credit,
         (select ob from opening) + sum(debit - credit) over (order by entry_date, created_at
            rows between unbounded preceding and current row)
    from period
   order by 1, 3 nulls first;
$$;

-- ----------------------------- ميزان المراجعة ---------------------------------
create or replace function report_trial_balance(
  p_from date, p_to date, p_branch_id uuid default null
)
returns table (
  account_id      uuid,
  account_code    text,
  account_name    text,
  account_type    account_type,
  opening_balance numeric,
  period_debit    numeric,
  period_credit   numeric,
  closing_balance numeric
)
language sql
stable
as $$
  select a.id, a.code, a.name_ar, a.type,
         coalesce(round(sum(case when jl.entry_date < p_from
                                 then jl.debit - jl.credit else 0 end), 4), 0),
         coalesce(round(sum(case when jl.entry_date between p_from and p_to
                                 then jl.debit else 0 end), 4), 0),
         coalesce(round(sum(case when jl.entry_date between p_from and p_to
                                 then jl.credit else 0 end), 4), 0),
         coalesce(round(sum(case when jl.entry_date <= p_to
                                 then jl.debit - jl.credit else 0 end), 4), 0)
    from accounts a
    left join journal_lines jl
      on jl.account_id = a.id
     and (p_branch_id is null or jl.branch_id = p_branch_id)
   where a.is_postable
   group by a.id, a.code, a.name_ar, a.type
  having coalesce(sum(case when jl.entry_date <= p_to then abs(jl.debit) + abs(jl.credit) else 0 end), 0) > 0
   order by a.code;
$$;

-- ------------------------------ لوحة التحكم -----------------------------------
create or replace function report_dashboard(
  p_from date, p_to date, p_branch_id uuid default null
)
returns table (
  branch_sales            jsonb,   -- مبيعات كل فرع على حدة
  total_branch_sales      numeric,
  parent_revenue          numeric,
  total_operating_expenses numeric,
  allocated_admin_expenses numeric,
  gross_profit            numeric,
  net_profit              numeric,
  cash_balance            numeric,
  bank_balance            numeric,
  total_receivables       numeric,
  total_payables          numeric,
  inventory_by_branch     jsonb,
  low_stock_count         bigint
)
language sql
stable
as $$
  with rows as (
    select * from report_branch_financial(p_from, p_to, p_branch_id)
  ),
  branch_rows as (select * from rows where branch_kind = 'branch'),
  summary as (select * from report_company_summary(p_from, p_to))
  select
    (select jsonb_agg(jsonb_build_object('branch_id', branch_id, 'name', branch_name,
                                         'net_sales', net_sales) order by branch_name)
       from branch_rows),
    (select coalesce(sum(net_sales), 0) from branch_rows),
    (select coalesce(sum(r.gross_sales), 0) from rows r where r.branch_kind = 'parent')
      + (select parent_revenue from summary),
    (select coalesce(sum(direct_expenses), 0) from rows),
    (select coalesce(sum(admin_share), 0) from branch_rows),
    (select coalesce(sum(gross_profit), 0) from branch_rows),
    (select coalesce(sum(net_profit), 0) from branch_rows),
    (select coalesce(sum(cash_balance), 0) from rows),
    (select coalesce(sum(bank_balance), 0) from rows),
    (select coalesce(sum(receivables), 0) from rows),
    (select coalesce(sum(payables), 0) from rows),
    (select jsonb_agg(jsonb_build_object('branch_id', branch_id, 'name', branch_name,
                                         'value', inventory_value) order by branch_name)
       from rows),
    (select count(*) from report_inventory(p_branch_id, true));
$$;

-- -------------------------- تقرير التحصيلات -----------------------------------
create or replace function report_collections(
  p_from date, p_to date, p_branch_id uuid default null
)
returns table (
  collection_date date,
  collection_no   text,
  branch_name     text,
  customer_name   text,
  method          payment_method,
  treasury_name   text,
  amount          numeric,
  reference       text
)
language sql
stable
as $$
  select c.collection_date, c.collection_no, b.name_ar, cu.name, c.method, t.name_ar,
         c.amount, c.reference
    from collections c
    join branches b           on b.id = c.branch_id
    join customers cu         on cu.id = c.customer_id
    join treasury_accounts t  on t.id = c.treasury_account_id
   where c.status = 'posted'
     and c.collection_date between p_from and p_to
     and (p_branch_id is null or c.branch_id = p_branch_id)
   order by c.collection_date, c.collection_no;
$$;

-- ------------------------ أعمار الذمم المدينة ---------------------------------
create or replace function report_receivables_aging(p_as_of date default current_date)
returns table (
  customer_id   uuid,
  customer_code text,
  customer_name text,
  balance       numeric,
  credit_limit  numeric,
  over_limit    boolean
)
language sql
stable
as $$
  select c.id, c.code, c.name, customer_balance(c.id, p_as_of), c.credit_limit,
         c.credit_limit > 0 and customer_balance(c.id, p_as_of) > c.credit_limit
    from customers c
   where customer_balance(c.id, p_as_of) <> 0
   order by customer_balance(c.id, p_as_of) desc;
$$;

-- ------------------------- كشف حساب لأي حساب في الدليل ------------------------
create or replace function report_account_statement(
  p_account_id uuid, p_from date, p_to date, p_branch_id uuid default null
)
returns table (
  entry_date  date,
  doc_type    doc_type,
  doc_no      text,
  branch_name text,
  description text,
  debit       numeric,
  credit      numeric,
  balance     numeric
)
language sql
stable
as $$
  with lines as (
    select jl.entry_date, je.doc_type, je.entry_no, b.name_ar as branch_name,
           coalesce(jl.description, je.description) as description,
           jl.debit, jl.credit, je.created_at
      from journal_lines jl
      join journal_entries je on je.id = jl.entry_id
      left join branches b on b.id = jl.branch_id
     where jl.account_id = p_account_id
       and (p_branch_id is null or jl.branch_id = p_branch_id)
  ),
  opening as (select coalesce(sum(debit - credit), 0) ob from lines where entry_date < p_from),
  period  as (select * from lines where entry_date between p_from and p_to)
  select p_from, 'opening_balance'::doc_type, null::text, null::text, 'رصيد ما قبل الفترة',
         case when ob > 0 then ob else 0 end, case when ob < 0 then -ob else 0 end, ob
    from opening
  union all
  select entry_date, doc_type, entry_no, branch_name, description, debit, credit,
         (select ob from opening) + sum(debit - credit) over (order by entry_date, created_at
            rows between unbounded preceding and current row)
    from period
   order by 1, 3 nulls first;
$$;
