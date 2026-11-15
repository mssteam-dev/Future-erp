-- =============================================================================
-- 0016_shipments.sql — الشحنات وتوزيع مصاريفها على المنتجات (Landed Cost)
--
--   الشحنة = فاتورة مشتريات لجهة محددة، تحمل أوزان الأصناف ومصاريف وصولها
--   (شحن، تخليص جمركي، نقل، تأمين، أخرى). تُوزَّع كل مصروف على الأسطر:
--     بالتساوي على القطع   |  حسب الوزن   |  حسب القيمة
--   ولكل مصروف أساس توزيع مستقل عند الحاجة. مجموع الموزع يساوي المصروف بالفلس.
--   كل شحنة مستقلة عن غيرها، وتُحفظ تكلفتها في دفعة مخزون خاصة بها.
-- =============================================================================

alter table purchase_invoices
  add column shipment_no     text,
  add column carrier         text,                                    -- جهة الشحن
  add column alloc_method    text not null default 'qty'
             check (alloc_method in ('qty', 'weight', 'value')),
  add column total_weight_kg numeric(18,4) not null default 0;

-- الفواتير السابقة كانت تُوزَّع بالقيمة، فتبقى كما كانت
update purchase_invoices set alloc_method = 'value';

create unique index purchase_invoices_shipment_no_key
  on purchase_invoices(shipment_no) where shipment_no is not null;

alter table purchase_invoice_lines
  add column weight_kg     numeric(18,4) not null default 0 check (weight_kg >= 0),
  add column alloc_expense numeric(18,4) not null default 0;     -- نصيب السطر من مصاريف الشحنة

create table purchase_invoice_expenses (
  id                  uuid primary key default gen_random_uuid(),
  seq                 bigint generated always as identity,
  invoice_id          uuid not null references purchase_invoices(id) on delete cascade,
  kind                text not null default 'freight'
                      check (kind in ('freight','customs','transport','insurance','other')),
  description         text,
  amount              numeric(18,4) not null check (amount >= 0),
  alloc_basis         text not null default 'default'
                      check (alloc_basis in ('default','qty','weight','value')),
  -- جهة الدفع: صندوق/بنك يُدفع منه عند الترحيل، أو مورد (شركة شحن مثلًا)،
  -- وإن تُركا فاضيين فالمبلغ مستحق للمورد الأساسي ضمن الفاتورة.
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  supplier_id         uuid references suppliers(id) on delete restrict,
  check (not (treasury_account_id is not null and supplier_id is not null))
);
create index purchase_invoice_expenses_inv_idx on purchase_invoice_expenses(invoice_id);

-- تفصيل توزيع كل مصروف على كل سطر (للتدقيق والتقارير)
create table purchase_invoice_line_allocations (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references purchase_invoice_lines(id) on delete cascade,
  expense_id uuid not null references purchase_invoice_expenses(id) on delete cascade,
  amount     numeric(18,4) not null,
  unique (line_id, expense_id)
);


-- الفواتير السابقة: نصيب الشحن من تكلفة السطر، ومبلغ الشحن يصير بند شحن واحدًا
update purchase_invoice_lines set alloc_expense = round(line_cost - net_amount, 4)
 where line_cost <> net_amount;
insert into purchase_invoice_expenses (invoice_id, kind, description, amount)
select i.id, 'freight', 'مصاريف شحن', i.shipping_cost
  from purchase_invoices i
 where i.shipping_cost > 0
   and not exists (select 1 from purchase_invoice_expenses e where e.invoice_id = i.id);

alter table purchase_invoice_expenses       enable row level security;
alter table purchase_invoice_line_allocations enable row level security;

create policy pur_exp_read on purchase_invoice_expenses for select
  using (exists (select 1 from purchase_invoices i where i.id = invoice_id
                  and has_permission('purchases.view') and can_access_branch(i.branch_id)));
create policy pur_exp_write on purchase_invoice_expenses for all
  using (exists (select 1 from purchase_invoices i where i.id = invoice_id and i.status = 'draft'
                  and has_permission('purchases.edit')))
  with check (exists (select 1 from purchase_invoices i where i.id = invoice_id and i.status = 'draft'
                  and has_permission('purchases.create')));
create policy pur_alloc_read on purchase_invoice_line_allocations for select
  using (exists (select 1 from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id
                  where l.id = line_id and has_permission('purchases.view')
                    and can_access_branch(i.branch_id)));
create policy pur_alloc_write on purchase_invoice_line_allocations for all
  using (exists (select 1 from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id
                  where l.id = line_id and i.status = 'draft' and has_permission('purchases.edit')))
  with check (exists (select 1 from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id
                  where l.id = line_id and i.status = 'draft' and has_permission('purchases.create')));
grant select, insert, update, delete on purchase_invoice_expenses, purchase_invoice_line_allocations
  to authenticated;

-- =============================================================================
-- إعادة الحساب: التوزيع بالقطع أو الوزن أو القيمة بلا فرق تقريب
-- =============================================================================
create or replace function recalc_purchase_invoice(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_inv      purchase_invoices;
  v_e        record;
  v_basis    text;
  v_w        numeric;
  v_resid    numeric(18,4);
  v_subtotal numeric(18,4);
  v_disc     numeric(18,4);
  v_tax      numeric(18,4);
  v_net_sum  numeric(18,4);
  v_weight   numeric(18,4);
  v_ship     numeric(18,4);
  v_owed     numeric(18,4);
  v_total    numeric(18,4);
  v_paid     numeric(18,4);
  v_alloc_sum numeric(18,4);
begin
  select * into v_inv from purchase_invoices where id = p_id;

  update purchase_invoice_lines l
     set net_amount = round(l.quantity * l.unit_cost - l.discount, 4),
         tax_amount = round((l.quantity * l.unit_cost - l.discount) * l.tax_rate / 100.0, 4),
         line_total = round((l.quantity * l.unit_cost - l.discount)
                            * (1 + l.tax_rate / 100.0), 4)
   where l.invoice_id = p_id;

  select coalesce(sum(quantity * unit_cost), 0), coalesce(sum(discount), 0),
         coalesce(sum(tax_amount), 0), coalesce(sum(net_amount), 0),
         coalesce(sum(weight_kg), 0)
    into v_subtotal, v_disc, v_tax, v_net_sum, v_weight
    from purchase_invoice_lines where invoice_id = p_id;

  -- مبلغ شحن قديم بلا بنود: يُحوَّل إلى بند شحن واحد
  if not exists (select 1 from purchase_invoice_expenses where invoice_id = p_id)
     and v_inv.shipping_cost > 0 then
    insert into purchase_invoice_expenses (invoice_id, kind, description, amount)
    values (p_id, 'freight', 'مصاريف شحن', v_inv.shipping_cost);
  end if;

  delete from purchase_invoice_line_allocations
   where line_id in (select id from purchase_invoice_lines where invoice_id = p_id);

  for v_e in select * from purchase_invoice_expenses where invoice_id = p_id order by seq
  loop
    if v_e.amount = 0 then continue; end if;
    v_basis := case when v_e.alloc_basis = 'default' then v_inv.alloc_method else v_e.alloc_basis end;

    select sum(case v_basis when 'qty' then quantity when 'weight' then weight_kg else net_amount end)
      into v_w from purchase_invoice_lines where invoice_id = p_id;
    if coalesce(v_w, 0) <= 0 then
      raise exception 'تعذر توزيع المصروف «%» %: %',
        coalesce(v_e.description, v_e.kind),
        case v_basis when 'weight' then 'حسب الوزن' when 'value' then 'حسب القيمة' else 'على القطع' end,
        case v_basis when 'weight' then 'أدخل وزن الأصناف أولًا' else 'لا توجد أساس توزيع' end;
    end if;

    insert into purchase_invoice_line_allocations (line_id, expense_id, amount)
    select l.id, v_e.id,
           round(v_e.amount * (case v_basis when 'qty' then l.quantity
                                            when 'weight' then l.weight_kg
                                            else l.net_amount end) / v_w, 4)
      from purchase_invoice_lines l where l.invoice_id = p_id;

    -- فرق التقريب يُحمَّل على أكبر سطر في أساس التوزيع، فيتطابق المجموع مع المصروف
    select round(v_e.amount - coalesce(sum(amount), 0), 4) into v_resid
      from purchase_invoice_line_allocations where expense_id = v_e.id;
    if v_resid <> 0 then
      update purchase_invoice_line_allocations
         set amount = amount + v_resid
       where id = (select a.id
                     from purchase_invoice_line_allocations a
                     join purchase_invoice_lines l on l.id = a.line_id
                    where a.expense_id = v_e.id
                    order by (case v_basis when 'qty' then l.quantity
                                           when 'weight' then l.weight_kg
                                           else l.net_amount end) desc, l.line_no
                    limit 1);
    end if;
  end loop;

  update purchase_invoice_lines l
     set alloc_expense = coalesce((select sum(a.amount) from purchase_invoice_line_allocations a
                                    where a.line_id = l.id), 0)
   where l.invoice_id = p_id;

  update purchase_invoice_lines l
     set line_cost        = round(l.net_amount + l.alloc_expense, 4),
         landed_unit_cost = case when l.quantity = 0 then 0
                                 else round((l.net_amount + l.alloc_expense) / l.quantity, 6) end
   where l.invoice_id = p_id;

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where treasury_account_id is null and supplier_id is null), 0)
    into v_ship, v_owed
    from purchase_invoice_expenses where invoice_id = p_id;

  -- ضمان: مجموع الموزع على الأسطر = إجمالي مصاريف الشحنة تمامًا
  select coalesce(sum(alloc_expense), 0) into v_alloc_sum
    from purchase_invoice_lines where invoice_id = p_id;
  if round(v_alloc_sum, 4) <> round(v_ship, 4) then
    raise exception 'اختلال في توزيع المصاريف: الموزع % والمصاريف %', v_alloc_sum, v_ship;
  end if;

  v_total := round(v_subtotal - v_disc + v_tax + v_owed, 4);

  select coalesce(sum(amount), 0) into v_paid
    from purchase_invoice_payments where invoice_id = p_id;

  update purchase_invoices
     set subtotal = v_subtotal, discount_total = v_disc, tax_total = v_tax,
         shipping_cost = v_ship, total_weight_kg = v_weight,
         total = v_total, paid_total = v_paid, remaining = round(v_total - v_paid, 4)
   where id = p_id;
end;
$$;

-- =============================================================================
-- ترحيل الشحنة / فاتورة المشتريات
-- =============================================================================
create or replace function post_purchase_invoice(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_inv    purchase_invoices;
  v_line   record;
  v_pay    record;
  v_exp    record;
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

  -- إدخال الكميات إلى مخزون الجهة المستلمة دفعةً مستقلة لكل سطر بتكلفته بعد المصاريف
  for v_line in select * from purchase_invoice_lines where invoice_id = p_id order by line_no
  loop
    v_cost := v_cost + stock_in(v_inv.invoice_date, v_inv.branch_id, v_line.product_id,
                                v_line.quantity, v_line.landed_unit_cost,
                                'purchase_invoice', p_id, v_line.id,
                                coalesce(v_inv.shipment_no, v_inv.invoice_no),
                                'شحنة/فاتورة مشتريات ' || v_inv.invoice_no, p_user_id,
                                v_line.line_cost);

    -- بطاقة المنتج تحمل آخر مورد وآخر تكلفة نهائية
    update products
       set default_unit_cost = v_line.landed_unit_cost, supplier_id = v_inv.supplier_id
     where id = v_line.product_id;
  end loop;

  -- القيد: مخزون (بضاعة + مصاريف وصولها) + ضريبة مقابل نقد/بنك وذمم الموردين
  v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_inv.branch_id,
               'debit', v_cost, 'description','بضاعة واردة بعد مصاريف الشحنة');

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

  -- مصاريف الشحنة المدفوعة لجهات أخرى أو من الصندوق/البنك مباشرة
  for v_exp in select e.*, t.kind as tkind from purchase_invoice_expenses e
                 left join treasury_accounts t on t.id = e.treasury_account_id
                where e.invoice_id = p_id and e.amount > 0
                  and (e.treasury_account_id is not null or e.supplier_id is not null)
  loop
    if v_exp.treasury_account_id is not null then
      v_lines := v_lines || jsonb_build_object(
        'account', case when v_exp.tkind = 'cash' then 'cash' else 'bank' end,
        'branch', v_inv.branch_id, 'credit', v_exp.amount,
        'treasury', v_exp.treasury_account_id,
        'description', 'دفع ' || coalesce(v_exp.description, v_exp.kind));
    else
      v_lines := v_lines || jsonb_build_object('account','ap','branch',v_inv.branch_id,
                   'credit', v_exp.amount, 'party_type','supplier','party', v_exp.supplier_id,
                   'description', 'مستحق ' || coalesce(v_exp.description, v_exp.kind));
    end if;
  end loop;

  v_entry := post_journal(v_inv.invoice_date, v_inv.branch_id, 'purchase_invoice', p_id,
                          'شحنة/فاتورة مشتريات ' || v_inv.invoice_no, v_lines, false, p_user_id);

  update purchase_invoices
     set status = 'posted', posted_at = now(), posted_by = p_user_id
   where id = p_id;

  return v_entry;
end;
$$;
