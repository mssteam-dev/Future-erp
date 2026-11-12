-- =============================================================================
-- 0005_purchases_inventory.sql — المشتريات، مرتجعات المشتريات، التحويل بين
--   الوحدات، التسويات المخزنية والجرد، والمخزون الافتتاحي
-- =============================================================================

-- ------------------------------ فواتير المشتريات ------------------------------
create table purchase_invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_no      text not null,
  supplier_ref_no text,                                  -- رقم فاتورة المورد
  invoice_date    date not null,
  supplier_id     uuid not null references suppliers(id) on delete restrict,
  branch_id       uuid not null references branches(id)  on delete restrict,  -- الجهة المستفيدة
  is_central      boolean not null default false,        -- شراء مركزي للشركة الأم
  subtotal        numeric(18,4) not null default 0,
  discount_total  numeric(18,4) not null default 0,
  tax_total       numeric(18,4) not null default 0,
  shipping_cost   numeric(18,4) not null default 0,      -- مصاريف شحن تُحمّل على التكلفة
  total           numeric(18,4) not null default 0,
  paid_total      numeric(18,4) not null default 0,
  remaining       numeric(18,4) not null default 0,
  notes           text,
  status          doc_status not null default 'draft',
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  posted_at       timestamptz,
  posted_by       uuid references app_users(id),
  cancelled_at    timestamptz,
  cancelled_by    uuid references app_users(id),
  cancel_reason   text,
  unique (invoice_no)
);

create index purchase_invoices_branch_idx   on purchase_invoices(branch_id, invoice_date);
create index purchase_invoices_supplier_idx on purchase_invoices(supplier_id, invoice_date);

create table purchase_invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references purchase_invoices(id) on delete cascade,
  line_no        int not null,
  product_id     uuid not null references products(id) on delete restrict,
  quantity       numeric(18,4) not null check (quantity > 0),
  unit_cost      numeric(18,6) not null check (unit_cost >= 0),
  discount       numeric(18,4) not null default 0 check (discount >= 0),
  tax_rate       numeric(7,4)  not null default 0 check (tax_rate >= 0),
  tax_amount     numeric(18,4) not null default 0,
  net_amount     numeric(18,4) not null default 0,       -- بعد الخصم وقبل الضريبة
  line_total     numeric(18,4) not null default 0,       -- شامل الضريبة
  landed_unit_cost numeric(18,6) not null default 0,     -- بعد توزيع الشحن
  line_cost        numeric(18,4) not null default 0,     -- تكلفة السطر الداخلة للمخزون
  notes          text,
  unique (invoice_id, line_no)
);

create table purchase_invoice_payments (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references purchase_invoices(id) on delete cascade,
  method              payment_method not null check (method in ('cash','bank')),
  treasury_account_id uuid not null references treasury_accounts(id) on delete restrict,
  amount              numeric(18,4) not null check (amount > 0)
);

-- ----------------------------- مرتجعات المشتريات ------------------------------
create table purchase_returns (
  id              uuid primary key default gen_random_uuid(),
  return_no       text not null unique,
  return_date     date not null,
  supplier_id     uuid not null references suppliers(id) on delete restrict,
  branch_id       uuid not null references branches(id)  on delete restrict,
  invoice_id      uuid references purchase_invoices(id)  on delete restrict,
  settle_mode     text not null default 'credit'
                  check (settle_mode in ('credit','cash','bank')),  -- خصم من الذمة أو استرداد
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  subtotal        numeric(18,4) not null default 0,
  tax_total       numeric(18,4) not null default 0,
  total           numeric(18,4) not null default 0,
  notes           text,
  status          doc_status not null default 'draft',
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text
);

create table purchase_return_lines (
  id          uuid primary key default gen_random_uuid(),
  return_id   uuid not null references purchase_returns(id) on delete cascade,
  line_no     int not null,
  product_id  uuid not null references products(id) on delete restrict,
  quantity    numeric(18,4) not null check (quantity > 0),
  unit_cost   numeric(18,6) not null check (unit_cost >= 0),
  tax_rate    numeric(7,4)  not null default 0,
  tax_amount  numeric(18,4) not null default 0,
  net_amount  numeric(18,4) not null default 0,
  line_total  numeric(18,4) not null default 0,
  unique (return_id, line_no)
);

-- -------------------------- التحويل بين الوحدات -------------------------------
-- تحويل البضاعة من الشركة الأم إلى فرع (أو بين فرعين) ليس بيعًا ولا شراءً:
-- نقل مخزون وتكلفة فقط، بصافي أثر صفر على مستوى الشركة.
create table stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  transfer_no    text not null unique,
  transfer_date  date not null,
  from_branch_id uuid not null references branches(id) on delete restrict,
  to_branch_id   uuid not null references branches(id) on delete restrict,
  total_cost     numeric(18,4) not null default 0,
  notes          text,
  status         doc_status not null default 'draft',
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  posted_at      timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text,
  check (from_branch_id <> to_branch_id)
);

create table stock_transfer_lines (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  line_no     int not null,
  product_id  uuid not null references products(id) on delete restrict,
  quantity    numeric(18,4) not null check (quantity > 0),
  unit_cost   numeric(18,6) not null default 0,   -- يُحسب وقت الترحيل من تكلفة المصدر
  total_cost  numeric(18,4) not null default 0,
  unique (transfer_id, line_no)
);

-- ------------------- التسويات المخزنية والجرد الفعلي --------------------------
create table stock_adjustments (
  id             uuid primary key default gen_random_uuid(),
  adjustment_no  text not null unique,
  adjustment_date date not null,
  branch_id      uuid not null references branches(id) on delete restrict,
  kind           text not null default 'adjustment'
                 check (kind in ('adjustment','count','opening')),  -- تسوية / جرد / رصيد أول المدة
  reason         text,
  total_in_cost  numeric(18,4) not null default 0,
  total_out_cost numeric(18,4) not null default 0,
  status         doc_status not null default 'draft',
  created_by     uuid references app_users(id),
  created_at     timestamptz not null default now(),
  posted_at      timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text
);

create table stock_adjustment_lines (
  id             uuid primary key default gen_random_uuid(),
  adjustment_id  uuid not null references stock_adjustments(id) on delete cascade,
  line_no        int not null,
  product_id     uuid not null references products(id) on delete restrict,
  system_qty     numeric(18,4) not null default 0,   -- الرصيد الدفتري وقت الإدخال
  counted_qty    numeric(18,4) not null default 0,   -- الجرد الفعلي / الكمية المطلوبة
  difference_qty numeric(18,4) not null default 0,   -- counted - system (+ إدخال / - إخراج)
  unit_cost      numeric(18,6) not null default 0,
  total_cost     numeric(18,4) not null default 0,
  notes          text,
  unique (adjustment_id, line_no)
);

-- =============================================================================
-- دوال الترحيل
-- =============================================================================

-- إعادة حساب إجماليات فاتورة مشتريات من أسطرها (لا يُعتمد على أرقام الواجهة)
create or replace function recalc_purchase_invoice(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_subtotal numeric(18,4);
  v_disc     numeric(18,4);
  v_tax      numeric(18,4);
  v_ship     numeric(18,4);
  v_total    numeric(18,4);
  v_paid     numeric(18,4);
  v_net_sum  numeric(18,4);
  v_residual numeric(18,4);
begin
  update purchase_invoice_lines l
     set net_amount = round(l.quantity * l.unit_cost - l.discount, 4),
         tax_amount = round((l.quantity * l.unit_cost - l.discount) * l.tax_rate / 100.0, 4),
         line_total = round((l.quantity * l.unit_cost - l.discount)
                            * (1 + l.tax_rate / 100.0), 4)
   where l.invoice_id = p_id;

  select coalesce(sum(quantity * unit_cost), 0), coalesce(sum(discount), 0),
         coalesce(sum(tax_amount), 0), coalesce(sum(net_amount), 0)
    into v_subtotal, v_disc, v_tax, v_net_sum
    from purchase_invoice_lines where invoice_id = p_id;

  select shipping_cost into v_ship from purchase_invoices where id = p_id;

  -- توزيع مصاريف الشحن على الأسطر بنسبة قيمتها
  update purchase_invoice_lines l
     set line_cost = round(l.net_amount
           + case when v_net_sum = 0 then 0
                  else v_ship * (l.net_amount / v_net_sum) end, 4)
   where l.invoice_id = p_id;

  -- فرق التقريب يُحمَّل على أكبر سطر، فيساوي مجموع تكاليف الأسطر قيمة الفاتورة
  -- بالضبط ولا يختل القيد المحاسبي بفلس.
  select round(v_net_sum + v_ship - coalesce(sum(line_cost), 0), 4)
    into v_residual
    from purchase_invoice_lines where invoice_id = p_id;

  if v_residual <> 0 then
    update purchase_invoice_lines
       set line_cost = line_cost + v_residual
     where id = (select id from purchase_invoice_lines
                  where invoice_id = p_id order by net_amount desc, line_no limit 1);
  end if;

  update purchase_invoice_lines l
     set landed_unit_cost = case when l.quantity = 0 then 0
                                 else round(l.line_cost / l.quantity, 6) end
   where l.invoice_id = p_id;

  v_total := round(v_subtotal - v_disc + v_tax + v_ship, 4);

  select coalesce(sum(amount), 0) into v_paid
    from purchase_invoice_payments where invoice_id = p_id;

  update purchase_invoices
     set subtotal = v_subtotal, discount_total = v_disc, tax_total = v_tax,
         total = v_total, paid_total = v_paid, remaining = round(v_total - v_paid, 4)
   where id = p_id;
end;
$$;

create or replace function post_purchase_invoice(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_inv    purchase_invoices;
  v_line   record;
  v_pay    record;
  v_lines  jsonb := '[]'::jsonb;
  v_cost   numeric(18,4) := 0;
  v_entry  uuid;
begin
  select * into v_inv from purchase_invoices where id = p_id for update;
  if not found then raise exception 'فاتورة المشتريات غير موجودة'; end if;
  if v_inv.status <> 'draft' then
    raise exception 'لا يمكن ترحيل فاتورة حالتها %', v_inv.status;
  end if;
  if not exists (select 1 from purchase_invoice_lines where invoice_id = p_id) then
    raise exception 'لا يمكن ترحيل فاتورة بلا أصناف';
  end if;

  perform assert_period_open(v_inv.invoice_date);
  perform recalc_purchase_invoice(p_id);
  select * into v_inv from purchase_invoices where id = p_id;

  if v_inv.paid_total > v_inv.total + 0.0001 then
    raise exception 'المبلغ المدفوع (%) أكبر من إجمالي الفاتورة (%)', v_inv.paid_total, v_inv.total;
  end if;

  -- إدخال الكميات إلى مخزون الجهة المستفيدة بتكلفة الوحدة بعد الشحن
  for v_line in select * from purchase_invoice_lines where invoice_id = p_id order by line_no
  loop
    v_cost := v_cost + stock_in(v_inv.invoice_date, v_inv.branch_id, v_line.product_id,
                                v_line.quantity, v_line.landed_unit_cost,
                                'purchase_invoice', p_id, v_line.id, v_inv.invoice_no,
                                'فاتورة مشتريات ' || v_inv.invoice_no, p_user_id,
                                v_line.line_cost);
  end loop;

  -- القيد: مخزون + ضريبة مدخلات مقابل نقد/بنك وذمة المورد
  v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_inv.branch_id,
               'debit', v_cost, 'description','بضاعة واردة');

  if v_inv.tax_total > 0 then
    v_lines := v_lines || jsonb_build_object('account','tax_input','branch',v_inv.branch_id,
                 'debit', v_inv.tax_total, 'description','ضريبة مشتريات');
  end if;

  for v_pay in select p.*, t.kind from purchase_invoice_payments p
                 join treasury_accounts t on t.id = p.treasury_account_id
                where p.invoice_id = p_id
  loop
    v_lines := v_lines || jsonb_build_object(
      'account', case when v_pay.kind = 'cash' then 'cash' else 'bank' end,
      'branch', v_inv.branch_id, 'credit', v_pay.amount,
      'treasury', v_pay.treasury_account_id, 'description','دفعة للمورد');
  end loop;

  if v_inv.remaining > 0 then
    v_lines := v_lines || jsonb_build_object('account','ap','branch',v_inv.branch_id,
                 'credit', v_inv.remaining, 'party_type','supplier','party', v_inv.supplier_id,
                 'description','ذمة مورد');
  end if;

  v_entry := post_journal(v_inv.invoice_date, v_inv.branch_id, 'purchase_invoice', p_id,
                          'فاتورة مشتريات ' || v_inv.invoice_no, v_lines, false, p_user_id);

  update purchase_invoices
     set status = 'posted', posted_at = now(), posted_by = p_user_id
   where id = p_id;

  return v_entry;
end;
$$;

create or replace function cancel_purchase_invoice(p_id uuid, p_reason text, p_user_id uuid default null)
returns void
language plpgsql
as $$
declare v_inv purchase_invoices;
begin
  select * into v_inv from purchase_invoices where id = p_id for update;
  if v_inv.status <> 'posted' then raise exception 'الفاتورة غير مرحلة'; end if;

  perform stock_reverse_document('purchase_invoice', p_id, v_inv.invoice_date, p_user_id);
  perform reverse_journal('purchase_invoice', p_id, v_inv.invoice_date,
                          'إلغاء فاتورة مشتريات ' || v_inv.invoice_no, p_user_id);

  update purchase_invoices
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_user_id, cancel_reason = p_reason
   where id = p_id;
end;
$$;

-- --------------------------- مرتجع مشتريات -----------------------------------
create or replace function post_purchase_return(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_ret    purchase_returns;
  v_line   record;
  v_lines  jsonb := '[]'::jsonb;
  v_cost   numeric(18,4) := 0;
  v_tax    numeric(18,4) := 0;
  v_kind   treasury_kind;
  v_entry  uuid;
begin
  select * into v_ret from purchase_returns where id = p_id for update;
  if v_ret.status <> 'draft' then raise exception 'لا يمكن ترحيل مرتجع حالته %', v_ret.status; end if;
  perform assert_period_open(v_ret.return_date);

  update purchase_return_lines l
     set net_amount = round(l.quantity * l.unit_cost, 4),
         tax_amount = round(l.quantity * l.unit_cost * l.tax_rate / 100.0, 4),
         line_total = round(l.quantity * l.unit_cost * (1 + l.tax_rate / 100.0), 4)
   where l.return_id = p_id;

  select coalesce(sum(net_amount),0), coalesce(sum(tax_amount),0)
    into v_cost, v_tax from purchase_return_lines where return_id = p_id;

  update purchase_returns
     set subtotal = v_cost, tax_total = v_tax, total = round(v_cost + v_tax, 4)
   where id = p_id;

  -- إخراج الكمية بتكلفة الشراء الأصلية
  for v_line in select * from purchase_return_lines where return_id = p_id order by line_no
  loop
    perform stock_out(v_ret.return_date, v_ret.branch_id, v_line.product_id, v_line.quantity,
                      'purchase_return', p_id, v_line.id, v_ret.return_no,
                      'مرتجع مشتريات ' || v_ret.return_no, p_user_id, v_line.unit_cost);
  end loop;

  v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_ret.branch_id,
               'credit', v_cost, 'description','بضاعة مرتجعة للمورد');
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_object('account','tax_input','branch',v_ret.branch_id,
                 'credit', v_tax, 'description','عكس ضريبة مشتريات');
  end if;

  if v_ret.settle_mode = 'credit' then
    v_lines := v_lines || jsonb_build_object('account','ap','branch',v_ret.branch_id,
                 'debit', round(v_cost + v_tax, 4), 'party_type','supplier','party',v_ret.supplier_id,
                 'description','خصم من ذمة المورد');
  else
    select kind into v_kind from treasury_accounts where id = v_ret.treasury_account_id;
    if v_kind is null then raise exception 'يجب تحديد الصندوق أو البنك لاسترداد قيمة المرتجع'; end if;
    v_lines := v_lines || jsonb_build_object(
                 'account', case when v_kind = 'cash' then 'cash' else 'bank' end,
                 'branch', v_ret.branch_id, 'debit', round(v_cost + v_tax, 4),
                 'treasury', v_ret.treasury_account_id, 'description','استرداد قيمة مرتجع');
  end if;

  v_entry := post_journal(v_ret.return_date, v_ret.branch_id, 'purchase_return', p_id,
                          'مرتجع مشتريات ' || v_ret.return_no, v_lines, false, p_user_id);

  update purchase_returns set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

-- ------------------------------ تحويل بضاعة ----------------------------------
create or replace function post_stock_transfer(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_tr     stock_transfers;
  v_line   record;
  v_cost   numeric(18,4);
  v_total  numeric(18,4) := 0;
  v_entry  uuid;
begin
  select * into v_tr from stock_transfers where id = p_id for update;
  if v_tr.status <> 'draft' then raise exception 'لا يمكن ترحيل تحويل حالته %', v_tr.status; end if;
  perform assert_period_open(v_tr.transfer_date);

  for v_line in select * from stock_transfer_lines where transfer_id = p_id order by line_no
  loop
    -- الإخراج بتكلفة المصدر، والإدخال بالتكلفة نفسها: لا تتضاعف التكلفة ولا تُخلق قيمة
    v_cost := stock_out(v_tr.transfer_date, v_tr.from_branch_id, v_line.product_id, v_line.quantity,
                        'stock_transfer', p_id, v_line.id, v_tr.transfer_no,
                        'تحويل صادر ' || v_tr.transfer_no, p_user_id);

    perform stock_in(v_tr.transfer_date, v_tr.to_branch_id, v_line.product_id, v_line.quantity,
                     case when v_line.quantity = 0 then 0 else v_cost / v_line.quantity end,
                     'stock_transfer', p_id, v_line.id, v_tr.transfer_no,
                     'تحويل وارد ' || v_tr.transfer_no, p_user_id);

    update stock_transfer_lines
       set unit_cost = case when v_line.quantity = 0 then 0 else round(v_cost / v_line.quantity, 6) end,
           total_cost = v_cost
     where id = v_line.id;

    v_total := v_total + v_cost;
  end loop;

  if v_total = 0 then raise exception 'لا يمكن ترحيل تحويل بلا أصناف'; end if;

  -- قيد نقل مخزون بين وحدتين: لا إيراد ولا مصروف، وصافي الأثر على الشركة صفر
  v_entry := post_journal(v_tr.transfer_date, v_tr.from_branch_id, 'stock_transfer', p_id,
    'تحويل بضاعة ' || v_tr.transfer_no,
    jsonb_build_array(
      jsonb_build_object('account','inventory','branch',v_tr.to_branch_id,
                         'debit', v_total, 'description','بضاعة واردة بالتحويل'),
      jsonb_build_object('account','inventory','branch',v_tr.from_branch_id,
                         'credit', v_total, 'description','بضاعة صادرة بالتحويل')
    ), false, p_user_id);

  update stock_transfers set status = 'posted', posted_at = now(), total_cost = v_total where id = p_id;
  return v_entry;
end;
$$;

-- -------------------- تسوية مخزنية / جرد / رصيد أول المدة ---------------------
create or replace function post_stock_adjustment(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_adj     stock_adjustments;
  v_line    record;
  v_in      numeric(18,4) := 0;
  v_out     numeric(18,4) := 0;
  v_cost    numeric(18,4);
  v_avg     numeric(18,6);
  v_lines   jsonb := '[]'::jsonb;
  v_doc     doc_type;
  v_contra  text;
  v_entry   uuid;
begin
  select * into v_adj from stock_adjustments where id = p_id for update;
  if v_adj.status <> 'draft' then raise exception 'لا يمكن ترحيل تسوية حالتها %', v_adj.status; end if;
  perform assert_period_open(v_adj.adjustment_date);

  v_doc    := case when v_adj.kind = 'opening' then 'opening_stock' else 'stock_adjustment' end;
  v_contra := case when v_adj.kind = 'opening' then 'opening_equity' else 'inventory_adjustment' end;

  for v_line in select * from stock_adjustment_lines where adjustment_id = p_id order by line_no
  loop
    if v_line.difference_qty = 0 then continue; end if;

    select coalesce(avg_cost, 0) into v_avg from product_branch_stock
     where product_id = v_line.product_id and branch_id = v_adj.branch_id;

    if v_line.difference_qty > 0 then
      v_cost := stock_in(v_adj.adjustment_date, v_adj.branch_id, v_line.product_id,
                         v_line.difference_qty,
                         case when v_line.unit_cost > 0 then v_line.unit_cost else coalesce(v_avg,0) end,
                         v_doc, p_id, v_line.id, v_adj.adjustment_no, v_adj.reason, p_user_id);
      v_in := v_in + v_cost;
    else
      v_cost := stock_out(v_adj.adjustment_date, v_adj.branch_id, v_line.product_id,
                          abs(v_line.difference_qty), v_doc, p_id, v_line.id,
                          v_adj.adjustment_no, v_adj.reason, p_user_id,
                          nullif(v_line.unit_cost, 0));
      v_out := v_out + v_cost;
    end if;

    update stock_adjustment_lines set total_cost = v_cost where id = v_line.id;
  end loop;

  if v_in = 0 and v_out = 0 then raise exception 'لا توجد فروقات لترحيلها'; end if;

  if v_in > 0 then
    v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_adj.branch_id,
                 'debit', v_in, 'description','زيادة مخزون');
    v_lines := v_lines || jsonb_build_object('account',v_contra,'branch',v_adj.branch_id,
                 'credit', v_in, 'description','مقابل زيادة المخزون');
  end if;
  if v_out > 0 then
    v_lines := v_lines || jsonb_build_object('account',v_contra,'branch',v_adj.branch_id,
                 'debit', v_out, 'description','عجز مخزون');
    v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_adj.branch_id,
                 'credit', v_out, 'description','نقص مخزون');
  end if;

  v_entry := post_journal(v_adj.adjustment_date, v_adj.branch_id, v_doc, p_id,
                          coalesce(v_adj.reason, 'تسوية مخزنية ' || v_adj.adjustment_no),
                          v_lines, false, p_user_id);

  update stock_adjustments
     set status = 'posted', posted_at = now(), total_in_cost = v_in, total_out_cost = v_out
   where id = p_id;
  return v_entry;
end;
$$;
