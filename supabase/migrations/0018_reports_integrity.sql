-- =============================================================================
-- 0018_reports_integrity.sql — تقارير الشحنات والتكلفة والمدفوع مقدمًا والدفعات،
--   وتحديث فحوص السلامة لتشمل الدفعات والتوزيع والاستهلاك.
-- =============================================================================

-- ربحية المنتجات: عند تحديد جهة تُعرض منتجاتها هي فقط (لكل جهة بطاقاتها المستقلة)
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
     where (p_branch_id is null or p.branch_id = p_branch_id)
  )
  select id, code, name_ar, cat,
         round(qty_sold, 4), round(net_sales, 4), round(cogs, 4),
         round(net_sales - cogs, 4),
         case when net_sales = 0 then 0 else round((net_sales - cogs) / net_sales * 100, 4) end
    from agg
   where p_include_zero or qty_sold <> 0 or net_sales <> 0
   order by net_sales desc, code;
$$;

-- ------------------------- تقرير الشحنات والتخليص ------------------------------
create or replace function report_shipments(p_from date, p_to date, p_branch_id uuid default null)
returns table (
  invoice_id      uuid,
  invoice_no      text,
  shipment_no     text,
  invoice_date    date,
  branch_id       uuid,
  branch_name     text,
  supplier_name   text,
  carrier         text,
  alloc_method    text,
  pieces          numeric,
  total_weight_kg numeric,
  goods_value     numeric,
  freight         numeric,
  customs         numeric,
  transport       numeric,
  insurance       numeric,
  other_expenses  numeric,
  total_expenses  numeric,
  landed_total    numeric,
  per_kg_cost     numeric,
  per_piece_cost  numeric
)
language sql
stable
as $$
  select i.id, i.invoice_no, i.shipment_no, i.invoice_date, b.id, b.name_ar, s.name, i.carrier,
         i.alloc_method,
         (select coalesce(sum(l.quantity), 0) from purchase_invoice_lines l where l.invoice_id = i.id),
         i.total_weight_kg,
         round((select coalesce(sum(l.net_amount), 0) from purchase_invoice_lines l where l.invoice_id = i.id), 4),
         coalesce((select sum(e.amount) from purchase_invoice_expenses e where e.invoice_id = i.id and e.kind = 'freight'), 0),
         coalesce((select sum(e.amount) from purchase_invoice_expenses e where e.invoice_id = i.id and e.kind = 'customs'), 0),
         coalesce((select sum(e.amount) from purchase_invoice_expenses e where e.invoice_id = i.id and e.kind = 'transport'), 0),
         coalesce((select sum(e.amount) from purchase_invoice_expenses e where e.invoice_id = i.id and e.kind = 'insurance'), 0),
         coalesce((select sum(e.amount) from purchase_invoice_expenses e where e.invoice_id = i.id and e.kind = 'other'), 0),
         i.shipping_cost,
         round((select coalesce(sum(l.line_cost), 0) from purchase_invoice_lines l where l.invoice_id = i.id), 4),
         case when i.total_weight_kg = 0 then 0 else round(i.shipping_cost / i.total_weight_kg, 4) end,
         case when (select coalesce(sum(l.quantity), 0) from purchase_invoice_lines l where l.invoice_id = i.id) = 0 then 0
              else round(i.shipping_cost / (select sum(l.quantity) from purchase_invoice_lines l where l.invoice_id = i.id), 4) end
    from purchase_invoices i
    join branches b on b.id = i.branch_id
    join suppliers s on s.id = i.supplier_id
   where i.status = 'posted'
     and i.invoice_date between p_from and p_to
     and (p_branch_id is null or i.branch_id = p_branch_id)
   order by i.invoice_date, i.invoice_no;
$$;

-- --------------------- تقرير تكلفة المنتجات (بطاقة المنتج) ---------------------
create or replace function report_product_costs(p_branch_id uuid default null)
returns table (
  branch_id         uuid,
  branch_name       text,
  product_id        uuid,
  product_code      text,
  product_name      text,
  category_name     text,
  supplier_name     text,
  base_price        numeric,
  loaded_expense    numeric,
  final_cost        numeric,
  sale_price        numeric,
  last_weight_kg    numeric,
  unit_weight_kg    numeric,
  qty_available     numeric,
  qty_sold          numeric,
  qty_returned      numeric,
  stock_value       numeric
)
language sql
stable
as $$
  select b.id, b.name_ar, p.id, p.code, p.name_ar, c.name_ar,
         coalesce(ls.supplier_name, sp.name),
         coalesce(ls.base_price, 0),
         coalesce(ls.loaded_expense, 0),
         coalesce(ls.final_cost, p.default_unit_cost),
         p.default_sale_price,
         coalesce(ls.weight_kg, 0),
         coalesce(ls.unit_weight, 0),
         coalesce(s.quantity, 0),
         coalesce((select sum(l.quantity) from sales_invoice_lines l
                    join sales_invoices i on i.id = l.invoice_id
                   where l.product_id = p.id and i.status = 'posted'), 0),
         coalesce((select sum(l.quantity) from sales_return_lines l
                    join sales_returns r on r.id = l.return_id
                   where l.product_id = p.id and r.status = 'posted'), 0),
         coalesce(s.stock_value, 0)
    from products p
    join branches b on b.id = p.branch_id
    left join product_categories c on c.id = p.category_id
    left join suppliers sp on sp.id = p.supplier_id
    left join product_branch_stock s on s.product_id = p.id and s.branch_id = p.branch_id
    left join lateral (
      select su.name as supplier_name,
             round(l.net_amount / nullif(l.quantity, 0), 6) as base_price,
             round(l.alloc_expense / nullif(l.quantity, 0), 6) as loaded_expense,
             l.landed_unit_cost as final_cost,
             l.weight_kg,
             round(l.weight_kg / nullif(l.quantity, 0), 6) as unit_weight
        from purchase_invoice_lines l
        join purchase_invoices i on i.id = l.invoice_id
        join suppliers su on su.id = i.supplier_id
       where l.product_id = p.id and i.status = 'posted'
       order by i.invoice_date desc, i.posted_at desc nulls last, i.invoice_no desc
       limit 1
    ) ls on true
   where (p_branch_id is null or p.branch_id = p_branch_id)
   order by b.sort_order, p.code;
$$;

-- ----------------------------- دفعات المخزون -----------------------------------
create or replace function report_stock_layers(p_branch_id uuid default null, p_product_id uuid default null,
                                               p_open_only boolean default true)
returns table (
  layer_id        uuid,
  branch_name     text,
  product_id      uuid,
  product_code    text,
  product_name    text,
  received_date   date,
  doc_type        doc_type,
  doc_no          text,
  original_qty    numeric,
  remaining_qty   numeric,
  unit_cost       numeric,
  remaining_value numeric
)
language sql
stable
as $$
  select l.id, b.name_ar, p.id, p.code, p.name_ar, l.received_date, l.doc_type, l.doc_no,
         l.original_qty, l.remaining_qty, l.unit_cost, l.remaining_value
    from stock_layers l
    join products p on p.id = l.product_id
    join branches b on b.id = l.branch_id
   where l.voided_at is null and not l.is_deficit
     and (p_branch_id  is null or l.branch_id  = p_branch_id)
     and (p_product_id is null or l.product_id = p_product_id)
     and (not p_open_only or l.remaining_qty > 0)
   order by b.sort_order, p.code, l.received_date, l.seq;
$$;

-- ------------------- تقرير المصاريف المدفوعة مقدمًا ----------------------------
create or replace function report_prepaid(p_branch_id uuid default null)
returns table (
  prepaid_id       uuid,
  prepaid_no       text,
  name             text,
  branch_name      text,
  expense_type     text,
  pay_date         date,
  start_date       date,
  end_date         date,
  months           int,
  total_amount     numeric,
  monthly_amount   numeric,
  months_charged   bigint,
  amortized_amount numeric,
  remaining_amount numeric,
  status           doc_status
)
language sql
stable
as $$
  select p.id, p.prepaid_no, p.name, b.name_ar, t.name_ar, p.pay_date, p.start_date, p.end_date,
         p.months, p.total_amount, p.monthly_amount,
         (select count(*) from prepaid_schedule s where s.prepaid_id = p.id and s.status = 'posted'),
         p.amortized_amount,
         case when p.status = 'posted' then round(p.total_amount - p.amortized_amount, 4) else 0 end,
         p.status
    from prepaid_expenses p
    join branches b on b.id = p.branch_id
    join expense_types t on t.id = p.expense_type_id
   where (p_branch_id is null or p.branch_id = p_branch_id)
   order by p.pay_date desc, p.prepaid_no;
$$;

-- -------------------- المصاريف التشغيلية والإدارية بحسب النوع -------------------
create or replace function report_operating_expenses(p_from date, p_to date, p_branch_id uuid default null)
returns table (
  branch_id    uuid,
  branch_name  text,
  account_code text,
  account_name text,
  is_admin     boolean,
  amount       numeric
)
language sql
stable
as $$
  select b.id, b.name_ar, a.code, a.name_ar, a.code like '53%',
         round(sum(jl.debit - jl.credit), 4)
    from journal_lines jl
    join accounts a on a.id = jl.account_id
    join branches b on b.id = jl.branch_id
   where a.type = 'expense'
     and a.system_key is distinct from 'cogs'
     and a.system_key is distinct from 'inventory_adjustment'
     and jl.entry_date between p_from and p_to
     and (p_branch_id is null or jl.branch_id = p_branch_id)
   group by b.id, b.name_ar, b.sort_order, a.code, a.name_ar
  having round(sum(jl.debit - jl.credit), 4) <> 0
   order by b.sort_order, a.code;
$$;

-- --------------------------- التحويلات بين الجهات -------------------------------
create or replace function report_transfers(p_from date, p_to date)
returns table (
  transfer_id   uuid,
  transfer_no   text,
  transfer_date date,
  from_branch   text,
  to_branch     text,
  lines_count   bigint,
  total_qty     numeric,
  total_cost    numeric,
  status        doc_status
)
language sql
stable
as $$
  select t.id, t.transfer_no, t.transfer_date, f.name_ar, d.name_ar,
         (select count(*) from stock_transfer_lines l where l.transfer_id = t.id),
         (select coalesce(sum(l.quantity), 0) from stock_transfer_lines l where l.transfer_id = t.id),
         t.total_cost, t.status
    from stock_transfers t
    join branches f on f.id = t.from_branch_id
    join branches d on d.id = t.to_branch_id
   where t.transfer_date between p_from and p_to
   order by t.transfer_date desc, t.transfer_no desc;
$$;

-- ---------------------------- لقطات الإقفال الشهري ------------------------------
create or replace function report_period_close(p_year int, p_month int)
returns table (
  branch_name     text,
  net_sales       numeric,
  purchases       numeric,
  cogs            numeric,
  gross_profit    numeric,
  total_expenses  numeric,
  net_profit      numeric,
  inventory_value numeric,
  cash_balance    numeric,
  bank_balance    numeric,
  receivables     numeric,
  payables        numeric,
  prepaid_balance numeric
)
language sql
stable
as $$
  select b.name_ar, s.net_sales, s.purchases, s.cogs, s.gross_profit, s.total_expenses,
         s.net_profit, s.inventory_value, s.cash_balance, s.bank_balance, s.receivables,
         s.payables, s.prepaid_balance
    from period_snapshots s
    join branches b on b.id = s.branch_id
   where s.period_year = p_year and s.period_month = p_month
   order by b.sort_order;
$$;

-- =============================================================================
-- فحوص سلامة البيانات (الفحوص القديمة + الدفعات والتوزيع والاستهلاك)
-- =============================================================================
create or replace function system_integrity_check()
returns table (check_name text, expected numeric, actual numeric, is_ok boolean, details text)
language plpgsql
as $$
declare
  v_fifo boolean := (select inventory_valuation = 'fifo' from settings where id);
begin
  return query
  select 'توازن القيود (مدين = دائن)',
         round(coalesce(sum(debit), 0), 4), round(coalesce(sum(credit), 0), 4),
         round(coalesce(sum(debit), 0), 4) = round(coalesce(sum(credit), 0), 4),
         'مجموع المدين يجب أن يساوي مجموع الدائن'
    from journal_lines;

  return query
  select 'قيود غير متوازنة', 0::numeric, count(*)::numeric, count(*) = 0,
         'عدد القيود التي لا يتساوى فيها المدين والدائن'
    from (select entry_id from journal_lines group by entry_id
          having round(sum(debit), 4) <> round(sum(credit), 4)) x;

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

  return query
  select 'حيادية التحويلات بين الوحدات', 0::numeric,
         round(coalesce(sum(jl.debit - jl.credit), 0), 4),
         round(coalesce(sum(jl.debit - jl.credit), 0), 4) = 0,
         'تحويل البضاعة لا يغير قيمة مخزون الشركة ككل'
    from journal_lines jl join journal_entries je on je.id = jl.entry_id
   where je.doc_type = 'stock_transfer';

  return query
  select 'حيادية التحويل بين الصندوق والبنك', 0::numeric,
         round(coalesce(sum(jl.debit - jl.credit), 0), 4),
         round(coalesce(sum(jl.debit - jl.credit), 0), 4) = 0,
         'التحويل لا ينشئ إيرادًا ولا يغير صافي النقدية (عدا الرسوم)'
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.doc_type = 'treasury_transfer' and a.system_key in ('cash','bank');

  return query
  select 'كميات سالبة في المخزون', 0::numeric, count(*)::numeric,
         count(*) = 0 or (select allow_negative_stock from settings where id),
         'لا يجوز أن يكون رصيد منتج سالبًا دون إذن إداري'
    from product_branch_stock where quantity < 0;

  return query
  select 'التحصيل لا يُسجَّل إيرادًا', 0::numeric, count(*)::numeric, count(*) = 0,
         'قيود التحصيل يجب ألا تمس حسابات الإيرادات'
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.doc_type = 'collection' and a.type = 'revenue';

  -- ===================== فحوص جديدة =====================
  return query
  select 'مطابقة كميات الدفعات مع الأرصدة',
         round(coalesce((select sum(quantity) from product_branch_stock), 0), 4),
         round(coalesce((select sum(remaining_qty) from stock_layers), 0), 4),
         round(coalesce((select sum(quantity) from product_branch_stock), 0), 4)
           = round(coalesce((select sum(remaining_qty) from stock_layers), 0), 4),
         'مجموع الكميات المتبقية في دفعات المخزون يطابق أرصدة المنتجات';

  return query
  select 'مطابقة قيمة الدفعات مع الدفتر (FIFO)',
         round(coalesce((select sum(stock_value) from product_branch_stock), 0), 2),
         round(coalesce((select sum(remaining_value) from stock_layers), 0), 2),
         (not v_fifo) or round(coalesce((select sum(stock_value) from product_branch_stock), 0), 2)
           = round(coalesce((select sum(remaining_value) from stock_layers), 0), 2),
         'عند اعتماد FIFO: قيمة الدفعات المتبقية تساوي قيمة المخزون في الدفتر';

  return query
  select 'توزيع مصاريف الشحنات كاملًا',
         round(coalesce((select sum(i.shipping_cost) from purchase_invoices i where i.status = 'posted'), 0), 4),
         round(coalesce((select sum(l.alloc_expense) from purchase_invoice_lines l
                          join purchase_invoices i on i.id = l.invoice_id
                         where i.status = 'posted'), 0), 4),
         round(coalesce((select sum(i.shipping_cost) from purchase_invoices i where i.status = 'posted'), 0), 4)
           = round(coalesce((select sum(l.alloc_expense) from purchase_invoice_lines l
                              join purchase_invoices i on i.id = l.invoice_id
                             where i.status = 'posted'), 0), 4),
         'مجموع ما وُزِّع على المنتجات يساوي مصاريف الشحنات دون زيادة أو نقص';

  return query
  select 'رصيد المدفوع مقدمًا = جدول الاستهلاك المتبقي',
         round(coalesce((select sum(ps.amount) from prepaid_schedule ps
                          join prepaid_expenses p on p.id = ps.prepaid_id
                         where p.status = 'posted' and ps.status = 'pending'), 0), 2),
         round(coalesce((select sum(jl.debit - jl.credit) from journal_lines jl
                          join accounts a on a.id = jl.account_id
                         where a.system_key = 'prepaid_expenses'), 0), 2),
         round(coalesce((select sum(ps.amount) from prepaid_schedule ps
                          join prepaid_expenses p on p.id = ps.prepaid_id
                         where p.status = 'posted' and ps.status = 'pending'), 0), 2)
           = round(coalesce((select sum(jl.debit - jl.credit) from journal_lines jl
                              join accounts a on a.id = jl.account_id
                             where a.system_key = 'prepaid_expenses'), 0), 2),
         'الحساب المتداول للمدفوع مقدمًا يساوي ما لم يُحمَّل بعد';

  return query
  select 'منتجات تتبع غير جهة حركتها', 0::numeric, count(*)::numeric, count(*) = 0,
         'كل حركة مخزون يجب أن تكون على بطاقة منتج الجهة نفسها'
    from stock_movements m join products p on p.id = m.product_id
   where p.branch_id <> m.branch_id;

  return query
  select 'الأرصدة الافتتاحية لا تمس الإيرادات', 0::numeric, count(*)::numeric, count(*) = 0,
         'قيود الأرصدة الافتتاحية تُقابَل بحساب الأرصدة الافتتاحية لا بإيراد'
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
   where je.doc_type in ('opening_balance','opening_stock') and a.type = 'revenue';
end;
$$;

grant execute on all functions in schema public to authenticated;
