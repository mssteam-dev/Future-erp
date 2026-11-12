-- =============================================================================
-- 0006_sales.sql — فواتير المبيعات ومرتجعات المبيعات
--   قاعدة أساسية: الإيراد يُسجَّل عند الفاتورة فقط، والتحصيل لاحقًا لا يُسجَّل
--   إيرادًا جديدًا، والفاتورة الآجلة لا تدخل الصندوق قبل تحصيلها.
-- =============================================================================

create table sales_invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_no      text not null unique,
  invoice_date    date not null,
  branch_id       uuid not null references branches(id) on delete restrict,
  customer_id     uuid references customers(id) on delete restrict,   -- فارغ = عميل نقدي
  customer_name   text,                                               -- اسم العميل النقدي
  subtotal        numeric(18,4) not null default 0,   -- إجمالي قبل الخصم والضريبة
  discount_total  numeric(18,4) not null default 0,
  tax_total       numeric(18,4) not null default 0,
  total           numeric(18,4) not null default 0,
  paid_total      numeric(18,4) not null default 0,
  remaining       numeric(18,4) not null default 0,
  cogs_total      numeric(18,4) not null default 0,   -- تكلفة البضاعة المباعة وقت الترحيل
  notes           text,
  status          doc_status not null default 'draft',
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  posted_at       timestamptz,
  posted_by       uuid references app_users(id),
  cancelled_at    timestamptz,
  cancelled_by    uuid references app_users(id),
  cancel_reason   text
);

create index sales_invoices_branch_idx   on sales_invoices(branch_id, invoice_date);
create index sales_invoices_customer_idx on sales_invoices(customer_id, invoice_date);
create index sales_invoices_status_idx   on sales_invoices(status);

create table sales_invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references sales_invoices(id) on delete cascade,
  line_no         int not null,
  product_id      uuid not null references products(id) on delete restrict,
  quantity        numeric(18,4) not null check (quantity > 0),
  unit_price      numeric(18,4) not null check (unit_price >= 0),
  discount        numeric(18,4) not null default 0 check (discount >= 0),
  tax_rate        numeric(7,4)  not null default 0 check (tax_rate >= 0),
  tax_amount      numeric(18,4) not null default 0,
  net_amount      numeric(18,4) not null default 0,   -- بعد الخصم وقبل الضريبة
  line_total      numeric(18,4) not null default 0,   -- شامل الضريبة
  cogs_unit_cost  numeric(18,6) not null default 0,   -- تكلفة الوحدة وقت البيع
  cogs_amount     numeric(18,4) not null default 0,
  returned_qty    numeric(18,4) not null default 0,   -- الكمية المرتجعة من هذا السطر
  notes           text,
  unique (invoice_id, line_no)
);

create index sales_invoice_lines_product_idx on sales_invoice_lines(product_id);

-- دفعة الفاتورة موزعة على أكثر من طريقة (نقدي + بنك + آجل)
create table sales_invoice_payments (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references sales_invoices(id) on delete cascade,
  method              payment_method not null check (method in ('cash','bank')),
  treasury_account_id uuid not null references treasury_accounts(id) on delete restrict,
  amount              numeric(18,4) not null check (amount > 0),
  reference           text
);

-- ----------------------------- مرتجع المبيعات --------------------------------
create table sales_returns (
  id              uuid primary key default gen_random_uuid(),
  return_no       text not null unique,
  return_date     date not null,
  branch_id       uuid not null references branches(id) on delete restrict,
  customer_id     uuid references customers(id) on delete restrict,
  invoice_id      uuid references sales_invoices(id) on delete restrict,
  refund_mode     text not null default 'credit'
                  check (refund_mode in ('credit','cash','bank')),  -- خصم من الذمة أو رد المبلغ
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  subtotal        numeric(18,4) not null default 0,
  tax_total       numeric(18,4) not null default 0,
  total           numeric(18,4) not null default 0,
  cogs_total      numeric(18,4) not null default 0,
  notes           text,
  status          doc_status not null default 'draft',
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text
);

create table sales_return_lines (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references sales_returns(id) on delete cascade,
  line_no         int not null,
  product_id      uuid not null references products(id) on delete restrict,
  source_line_id  uuid references sales_invoice_lines(id) on delete restrict,
  quantity        numeric(18,4) not null check (quantity > 0),
  unit_price      numeric(18,4) not null check (unit_price >= 0),
  tax_rate        numeric(7,4)  not null default 0,
  tax_amount      numeric(18,4) not null default 0,
  net_amount      numeric(18,4) not null default 0,
  line_total      numeric(18,4) not null default 0,
  cogs_unit_cost  numeric(18,6) not null default 0,
  cogs_amount     numeric(18,4) not null default 0,
  unique (return_id, line_no)
);

-- =============================================================================
-- الترحيل
-- =============================================================================

create or replace function recalc_sales_invoice(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_sub  numeric(18,4); v_disc numeric(18,4); v_tax numeric(18,4);
  v_total numeric(18,4); v_paid numeric(18,4);
begin
  update sales_invoice_lines l
     set net_amount = round(l.quantity * l.unit_price - l.discount, 4),
         tax_amount = round((l.quantity * l.unit_price - l.discount) * l.tax_rate / 100.0, 4),
         line_total = round((l.quantity * l.unit_price - l.discount) * (1 + l.tax_rate / 100.0), 4)
   where l.invoice_id = p_id;

  select coalesce(sum(quantity * unit_price),0), coalesce(sum(discount),0), coalesce(sum(tax_amount),0)
    into v_sub, v_disc, v_tax
    from sales_invoice_lines where invoice_id = p_id;

  v_total := round(v_sub - v_disc + v_tax, 4);

  select coalesce(sum(amount),0) into v_paid from sales_invoice_payments where invoice_id = p_id;

  update sales_invoices
     set subtotal = v_sub, discount_total = v_disc, tax_total = v_tax,
         total = v_total, paid_total = v_paid, remaining = round(v_total - v_paid, 4)
   where id = p_id;
end;
$$;

create or replace function post_sales_invoice(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_inv     sales_invoices;
  v_line    record;
  v_pay     record;
  v_lines   jsonb := '[]'::jsonb;
  v_cogs    numeric(18,4) := 0;
  v_line_cogs numeric(18,4);
  v_gross   numeric(18,4);
  v_balance numeric(18,4);
  v_limit   numeric(18,4);
  v_entry   uuid;
begin
  select * into v_inv from sales_invoices where id = p_id for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.status <> 'draft' then
    raise exception 'لا يمكن ترحيل فاتورة حالتها %', v_inv.status;
  end if;
  if not exists (select 1 from sales_invoice_lines where invoice_id = p_id) then
    raise exception 'لا يمكن ترحيل فاتورة بلا أصناف';
  end if;

  perform assert_period_open(v_inv.invoice_date);
  perform recalc_sales_invoice(p_id);
  select * into v_inv from sales_invoices where id = p_id;

  if v_inv.paid_total > v_inv.total + 0.0001 then
    raise exception 'المبلغ المدفوع (%) أكبر من إجمالي الفاتورة (%)', v_inv.paid_total, v_inv.total;
  end if;

  -- الجزء غير المحصل يتطلب عميلًا مسجلًا: العميل النقدي لا تُفتح له ذمة
  if v_inv.remaining > 0 and v_inv.customer_id is null then
    raise exception 'الفاتورة الآجلة تتطلب اختيار عميل مسجل، لا عميل نقدي';
  end if;

  -- الحد الائتماني
  if v_inv.remaining > 0 then
    select credit_limit into v_limit from customers where id = v_inv.customer_id;
    if coalesce(v_limit, 0) > 0 then
      select customer_balance(v_inv.customer_id, v_inv.invoice_date) into v_balance;
      if v_balance + v_inv.remaining > v_limit then
        raise exception 'تجاوز الحد الائتماني للعميل: الرصيد % والحد %', v_balance, v_limit;
      end if;
    end if;
  end if;

  -- إخراج الكميات واحتساب تكلفة البضاعة المباعة بالمتوسط المرجح وقت البيع
  for v_line in select * from sales_invoice_lines where invoice_id = p_id order by line_no
  loop
    v_line_cogs := stock_out(v_inv.invoice_date, v_inv.branch_id, v_line.product_id, v_line.quantity,
                             'sales_invoice', p_id, v_line.id, v_inv.invoice_no,
                             'فاتورة مبيعات ' || v_inv.invoice_no, p_user_id);

    update sales_invoice_lines
       set cogs_amount = v_line_cogs,
           cogs_unit_cost = case when v_line.quantity = 0 then 0
                                 else round(v_line_cogs / v_line.quantity, 6) end
     where id = v_line.id;

    v_cogs := v_cogs + v_line_cogs;
  end loop;

  select coalesce(sum(quantity * unit_price), 0) into v_gross
    from sales_invoice_lines where invoice_id = p_id;

  -- المقبوضات: نقدي/بنك حسب طريقة الدفع
  for v_pay in select p.*, t.kind from sales_invoice_payments p
                 join treasury_accounts t on t.id = p.treasury_account_id
                where p.invoice_id = p_id
  loop
    v_lines := v_lines || jsonb_build_object(
      'account', case when v_pay.kind = 'cash' then 'cash' else 'bank' end,
      'branch', v_inv.branch_id, 'debit', v_pay.amount,
      'treasury', v_pay.treasury_account_id, 'description','تحصيل عند البيع');
  end loop;

  -- الجزء الآجل: ذمة على العميل، ولا يدخل الصندوق
  if v_inv.remaining > 0 then
    v_lines := v_lines || jsonb_build_object('account','ar','branch',v_inv.branch_id,
                 'debit', v_inv.remaining, 'party_type','customer','party', v_inv.customer_id,
                 'description','ذمة عميل');
  end if;

  -- الإيراد بالإجمالي، والخصم كحساب مقابل، حتى يظهر صافي المبيعات بوضوح
  v_lines := v_lines || jsonb_build_object('account','sales','branch',v_inv.branch_id,
               'credit', v_gross, 'description','مبيعات');

  if v_inv.discount_total > 0 then
    v_lines := v_lines || jsonb_build_object('account','sales_discounts','branch',v_inv.branch_id,
                 'debit', v_inv.discount_total, 'description','خصم على المبيعات');
  end if;

  -- الضريبة المحصلة التزام للجهة الضريبية، وليست إيرادًا للشركة
  if v_inv.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account','tax_payable','branch',v_inv.branch_id,
                 'credit', v_inv.tax_total, 'description','ضريبة مبيعات مستحقة');
  end if;

  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_object('account','cogs','branch',v_inv.branch_id,
                 'debit', v_cogs, 'description','تكلفة البضاعة المباعة');
    v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_inv.branch_id,
                 'credit', v_cogs, 'description','خروج بضاعة بالبيع');
  end if;

  v_entry := post_journal(v_inv.invoice_date, v_inv.branch_id, 'sales_invoice', p_id,
                          'فاتورة مبيعات ' || v_inv.invoice_no, v_lines, false, p_user_id);

  update sales_invoices
     set status = 'posted', posted_at = now(), posted_by = p_user_id, cogs_total = v_cogs
   where id = p_id;

  return v_entry;
end;
$$;

create or replace function cancel_sales_invoice(p_id uuid, p_reason text, p_user_id uuid default null)
returns void
language plpgsql
as $$
declare v_inv sales_invoices;
begin
  select * into v_inv from sales_invoices where id = p_id for update;
  if v_inv.status <> 'posted' then raise exception 'الفاتورة غير مرحلة'; end if;
  if exists (select 1 from sales_returns where invoice_id = p_id and status = 'posted') then
    raise exception 'لا يمكن إلغاء فاتورة عليها مرتجعات مرحلة';
  end if;

  perform stock_reverse_document('sales_invoice', p_id, v_inv.invoice_date, p_user_id);
  perform reverse_journal('sales_invoice', p_id, v_inv.invoice_date,
                          'إلغاء فاتورة مبيعات ' || v_inv.invoice_no, p_user_id);

  update sales_invoices
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_user_id, cancel_reason = p_reason
   where id = p_id;
end;
$$;

-- ----------------------------- مرتجع المبيعات --------------------------------
create or replace function post_sales_return(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_ret    sales_returns;
  v_line   record;
  v_lines  jsonb := '[]'::jsonb;
  v_net    numeric(18,4) := 0;
  v_tax    numeric(18,4) := 0;
  v_cogs   numeric(18,4) := 0;
  v_unit   numeric(18,6);
  v_cost   numeric(18,4);
  v_kind   treasury_kind;
  v_sold   numeric(18,4);
  v_entry  uuid;
begin
  select * into v_ret from sales_returns where id = p_id for update;
  if v_ret.status <> 'draft' then raise exception 'لا يمكن ترحيل مرتجع حالته %', v_ret.status; end if;
  perform assert_period_open(v_ret.return_date);

  update sales_return_lines l
     set net_amount = round(l.quantity * l.unit_price, 4),
         tax_amount = round(l.quantity * l.unit_price * l.tax_rate / 100.0, 4),
         line_total = round(l.quantity * l.unit_price * (1 + l.tax_rate / 100.0), 4)
   where l.return_id = p_id;

  for v_line in select * from sales_return_lines where return_id = p_id order by line_no
  loop
    -- لا يُرتجع أكثر مما بيع في السطر الأصلي
    if v_line.source_line_id is not null then
      select quantity - returned_qty into v_sold
        from sales_invoice_lines where id = v_line.source_line_id for update;
      if v_line.quantity > coalesce(v_sold, 0) + 0.0001 then
        raise exception 'الكمية المرتجعة أكبر من المتبقي في الفاتورة الأصلية (المتاح %)', coalesce(v_sold,0);
      end if;
      select cogs_unit_cost into v_unit from sales_invoice_lines where id = v_line.source_line_id;
      update sales_invoice_lines set returned_qty = returned_qty + v_line.quantity
       where id = v_line.source_line_id;
    else
      select coalesce(avg_cost, 0) into v_unit from product_branch_stock
       where product_id = v_line.product_id and branch_id = v_ret.branch_id;
    end if;

    -- إرجاع البضاعة إلى المخزون بتكلفتها الأصلية وقت البيع
    v_cost := stock_in(v_ret.return_date, v_ret.branch_id, v_line.product_id, v_line.quantity,
                       coalesce(v_unit, 0), 'sales_return', p_id, v_line.id, v_ret.return_no,
                       'مرتجع مبيعات ' || v_ret.return_no, p_user_id);

    update sales_return_lines
       set cogs_unit_cost = coalesce(v_unit,0), cogs_amount = v_cost where id = v_line.id;

    v_cogs := v_cogs + v_cost;
  end loop;

  select coalesce(sum(net_amount),0), coalesce(sum(tax_amount),0)
    into v_net, v_tax from sales_return_lines where return_id = p_id;

  if v_net = 0 and v_tax = 0 then raise exception 'لا يمكن ترحيل مرتجع بلا أصناف'; end if;

  update sales_returns
     set subtotal = v_net, tax_total = v_tax, total = round(v_net + v_tax, 4), cogs_total = v_cogs
   where id = p_id;

  -- عكس أثر البيع: مرتجعات المبيعات تخفض صافي المبيعات
  v_lines := v_lines || jsonb_build_object('account','sales_returns','branch',v_ret.branch_id,
               'debit', v_net, 'description','مرتجع مبيعات');
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_object('account','tax_payable','branch',v_ret.branch_id,
                 'debit', v_tax, 'description','عكس ضريبة مبيعات');
  end if;

  if v_ret.refund_mode = 'credit' then
    if v_ret.customer_id is null then
      raise exception 'الخصم من الذمة يتطلب عميلًا مسجلًا';
    end if;
    v_lines := v_lines || jsonb_build_object('account','ar','branch',v_ret.branch_id,
                 'credit', round(v_net + v_tax, 4), 'party_type','customer','party',v_ret.customer_id,
                 'description','خصم من ذمة العميل');
  else
    select kind into v_kind from treasury_accounts where id = v_ret.treasury_account_id;
    if v_kind is null then raise exception 'يجب تحديد الصندوق أو البنك لرد قيمة المرتجع'; end if;
    v_lines := v_lines || jsonb_build_object(
                 'account', case when v_kind = 'cash' then 'cash' else 'bank' end,
                 'branch', v_ret.branch_id, 'credit', round(v_net + v_tax, 4),
                 'treasury', v_ret.treasury_account_id, 'description','رد قيمة مرتجع للعميل');
  end if;

  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_ret.branch_id,
                 'debit', v_cogs, 'description','بضاعة مرتجعة للمخزون');
    v_lines := v_lines || jsonb_build_object('account','cogs','branch',v_ret.branch_id,
                 'credit', v_cogs, 'description','عكس تكلفة البضاعة المباعة');
  end if;

  v_entry := post_journal(v_ret.return_date, v_ret.branch_id, 'sales_return', p_id,
                          'مرتجع مبيعات ' || v_ret.return_no, v_lines, false, p_user_id);

  update sales_returns set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;
