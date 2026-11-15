-- =============================================================================
-- 0015_branch_products_fifo.sql
--   1) منتجات مستقلة لكل جهة: لكل جهة بطاقة منتج ورصيد وتكلفة لا تختلط بغيرها.
--   2) دفعات المخزون (Layers) وتقييم FIFO، مع إمكانية التحويل إلى المتوسط المرجح.
--   3) التحويل بين الجهات ينشئ بطاقة المنتج في الجهة المستلمة تلقائيًا ويحمل
--      الدفعات بتكاليفها وتواريخها الأصلية.
-- =============================================================================

-- ------------------------------ طريقة التقييم ---------------------------------
alter table settings drop constraint if exists settings_inventory_valuation_check;
alter table settings add constraint settings_inventory_valuation_check
  check (inventory_valuation in ('fifo', 'wavg'));
alter table settings alter column inventory_valuation set default 'fifo';
update settings set inventory_valuation = 'fifo';

-- ------------------------- بطاقة منتج مستقلة لكل جهة ---------------------------
alter table products add column branch_id   uuid references branches(id) on delete restrict;
alter table products add column supplier_id uuid references suppliers(id) on delete set null;
alter table stock_transfer_lines
  add column to_product_id uuid references products(id) on delete restrict;

-- المنتج الواحد المشترك سابقًا يُقسَّم إلى بطاقة لكل جهة استُخدم فيها.
-- الجهة الأولى (بحسب الترتيب) تحتفظ بالبطاقة الأصلية، وبقية الجهات تأخذ نسخًا
-- بالكود نفسه، وتُعاد كل المراجع (حركات، فواتير، قيود) إلى بطاقة جهتها.
alter table products drop constraint if exists products_code_key;

do $$
declare
  v_parent uuid;
  r        record;
begin
  select id into v_parent from branches where kind = 'parent' limit 1;

  create temp table _pmap (old_id uuid, branch_id uuid, new_id uuid, is_orig boolean) on commit drop;

  insert into _pmap (old_id, branch_id)
  select distinct product_id, branch_id from (
    select product_id, branch_id from product_branch_stock
    union select product_id, branch_id from stock_movements
    union select l.product_id, i.branch_id from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id
    union select l.product_id, i.branch_id from purchase_return_lines  l join purchase_returns  i on i.id = l.return_id
    union select l.product_id, i.branch_id from sales_invoice_lines    l join sales_invoices    i on i.id = l.invoice_id
    union select l.product_id, i.branch_id from sales_return_lines     l join sales_returns     i on i.id = l.return_id
    union select l.product_id, i.branch_id from stock_adjustment_lines l join stock_adjustments i on i.id = l.adjustment_id
    union select l.product_id, i.from_branch_id from stock_transfer_lines l join stock_transfers i on i.id = l.transfer_id
    union select l.product_id, i.to_branch_id   from stock_transfer_lines l join stock_transfers i on i.id = l.transfer_id
    union select product_id, branch_id from journal_lines where product_id is not null and branch_id is not null
  ) x where product_id is not null and branch_id is not null;

  -- منتجات بلا أي استخدام تذهب إلى الشركة الأم
  insert into _pmap (old_id, branch_id)
  select p.id, v_parent from products p
   where not exists (select 1 from _pmap m where m.old_id = p.id);

  -- الجهة صاحبة البطاقة الأصلية = الأولى ترتيبًا
  update _pmap m set is_orig = (m.branch_id = (
      select m2.branch_id from _pmap m2 join branches b on b.id = m2.branch_id
       where m2.old_id = m.old_id order by b.sort_order, b.code limit 1));
  update _pmap set new_id = case when is_orig then old_id else gen_random_uuid() end;

  -- النسخ للجهات الأخرى
  for r in select m.old_id, m.branch_id, m.new_id from _pmap m where not m.is_orig loop
    insert into products
    select * from jsonb_populate_record(null::products,
             (select to_jsonb(p) from products p where p.id = r.old_id)
             || jsonb_build_object('id', r.new_id, 'branch_id', r.branch_id));
  end loop;
  update products p set branch_id = m.branch_id from _pmap m where m.old_id = p.id and m.is_orig;

  -- إعادة ربط المراجع ببطاقة كل جهة
  update product_branch_stock s set product_id = m.new_id
    from _pmap m where m.old_id = s.product_id and m.branch_id = s.branch_id and not m.is_orig;
  update stock_movements s set product_id = m.new_id
    from _pmap m where m.old_id = s.product_id and m.branch_id = s.branch_id and not m.is_orig;
  update journal_lines s set product_id = m.new_id
    from _pmap m where m.old_id = s.product_id and m.branch_id = s.branch_id and not m.is_orig;
  update purchase_invoice_lines l set product_id = m.new_id
    from purchase_invoices i, _pmap m
   where i.id = l.invoice_id and m.old_id = l.product_id and m.branch_id = i.branch_id and not m.is_orig;
  update purchase_return_lines l set product_id = m.new_id
    from purchase_returns i, _pmap m
   where i.id = l.return_id and m.old_id = l.product_id and m.branch_id = i.branch_id and not m.is_orig;
  update sales_invoice_lines l set product_id = m.new_id
    from sales_invoices i, _pmap m
   where i.id = l.invoice_id and m.old_id = l.product_id and m.branch_id = i.branch_id and not m.is_orig;
  update sales_return_lines l set product_id = m.new_id
    from sales_returns i, _pmap m
   where i.id = l.return_id and m.old_id = l.product_id and m.branch_id = i.branch_id and not m.is_orig;
  update stock_adjustment_lines l set product_id = m.new_id
    from stock_adjustments i, _pmap m
   where i.id = l.adjustment_id and m.old_id = l.product_id and m.branch_id = i.branch_id and not m.is_orig;

  -- التحويلات: بطاقة المرسل في product_id وبطاقة المستلم في to_product_id
  update stock_transfer_lines l set to_product_id = m.new_id
    from stock_transfers t, _pmap m
   where t.id = l.transfer_id and m.old_id = l.product_id and m.branch_id = t.to_branch_id;
  update stock_transfer_lines l set product_id = m.new_id
    from stock_transfers t, _pmap m
   where t.id = l.transfer_id and m.old_id = l.product_id and m.branch_id = t.from_branch_id
     and not m.is_orig;
end;
$$;

alter table products alter column branch_id set not null;
alter table products add constraint products_branch_code_key unique (branch_id, code);
create index products_branch_idx on products(branch_id);

-- الجهة الافتراضية للمنتج الجديد عند عدم تحديدها: الشركة الأم
create or replace function products_default_branch() returns trigger
language plpgsql as $$
begin
  if new.branch_id is null then
    select id into new.branch_id from branches where kind = 'parent' limit 1;
  end if;
  return new;
end;
$$;
create trigger products_default_branch before insert on products
  for each row execute function products_default_branch();

drop policy if exists products_read  on products;
drop policy if exists products_write on products;
create policy products_read on products for select
  using (has_permission('products.view') and can_access_branch(branch_id));
create policy products_write on products for all
  using (has_permission('products.edit') and can_access_branch(branch_id))
  with check (has_permission('products.create') and can_access_branch(branch_id));

-- ------------------------------ دفعات المخزون ---------------------------------
-- كل دخول للمخزون (شحنة، مرتجع بيع، تسوية، تحويل وارد) ينشئ دفعة بتكلفتها
-- وتاريخها. الصرف يستهلك الدفعات من الأقدم إلى الأحدث (FIFO).
create table stock_layers (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  branch_id       uuid not null references branches(id) on delete restrict,
  product_id      uuid not null references products(id) on delete restrict,
  received_date   date not null,
  movement_id     uuid references stock_movements(id) on delete set null,
  doc_type        doc_type,
  doc_id          uuid,
  doc_line_id     uuid,
  doc_no          text,
  origin_layer_id uuid references stock_layers(id) on delete set null,  -- الدفعة المصدر عند التحويل
  original_qty    numeric(18,4) not null,
  original_value  numeric(18,4) not null,
  unit_cost       numeric(18,6) not null default 0,
  remaining_qty   numeric(18,4) not null,
  remaining_value numeric(18,4) not null,
  is_deficit      boolean not null default false,   -- دفعة عجز عند السماح بالمخزون السالب
  voided_at       timestamptz,
  created_at      timestamptz not null default now(),
  check (remaining_qty >= 0 or is_deficit)
);
create index stock_layers_fifo_idx on stock_layers(branch_id, product_id, received_date, seq)
  where remaining_qty > 0;
create index stock_layers_doc_idx on stock_layers(doc_type, doc_id);
create index stock_layers_movement_idx on stock_layers(movement_id);

create table stock_layer_consumptions (
  id          uuid primary key default gen_random_uuid(),
  movement_id uuid not null references stock_movements(id) on delete cascade,
  layer_id    uuid not null references stock_layers(id) on delete restrict,
  qty         numeric(18,4) not null,
  cost        numeric(18,4) not null
);
create index stock_layer_cons_move_idx  on stock_layer_consumptions(movement_id);
create index stock_layer_cons_layer_idx on stock_layer_consumptions(layer_id);

alter table stock_layers             enable row level security;
alter table stock_layer_consumptions enable row level security;
create policy stock_layers_read on stock_layers for select
  using (has_permission('inventory.view') and can_access_branch(branch_id));
create policy stock_layer_cons_read on stock_layer_consumptions for select
  using (has_permission('inventory.view'));
grant select on stock_layers, stock_layer_consumptions to authenticated;
revoke insert, update, delete on stock_layers, stock_layer_consumptions from authenticated;

-- الأرصدة القائمة تتحول إلى دفعة افتتاحية واحدة لكل منتج وجهة
insert into stock_layers (branch_id, product_id, received_date, doc_type, doc_no,
                          original_qty, original_value, unit_cost, remaining_qty, remaining_value)
select s.branch_id, s.product_id,
       coalesce((select min(m.move_date) from stock_movements m
                  where m.product_id = s.product_id and m.branch_id = s.branch_id
                    and m.direction = 'in'), current_date),
       'opening_stock', 'رصيد مرحَّل',
       s.quantity, s.stock_value, round(s.stock_value / s.quantity, 6),
       s.quantity, s.stock_value
  from product_branch_stock s
 where s.quantity > 0;

-- =============================================================================
-- دوال المخزون
-- =============================================================================

create or replace function _assert_product_branch(p_product uuid, p_branch uuid)
returns void language plpgsql stable as $$
declare v_branch uuid; v_name text;
begin
  select branch_id, name_ar into v_branch, v_name from products where id = p_product;
  if not found then raise exception 'المنتج غير موجود'; end if;
  if v_branch is distinct from p_branch then
    raise exception 'المنتج «%» لا يتبع هذه الجهة: لكل جهة بطاقات منتجاتها المستقلة', v_name;
  end if;
end;
$$;

-- تحديث رصيد المنتج في الجهة: الكمية والقيمة (وعاء التكلفة) والمتوسط المشتق منهما
create or replace function _pbs_apply(p_branch uuid, p_product uuid, p_dq numeric, p_dv numeric)
returns table (qty_after numeric, avg_after numeric, value_after numeric)
language plpgsql security definer set search_path = public as $$
declare v_q numeric(18,4); v_a numeric(18,6); v_v numeric(18,4);
        n_q numeric(18,4); n_v numeric(18,4); n_a numeric(18,6);
begin
  insert into product_branch_stock (product_id, branch_id) values (p_product, p_branch)
  on conflict do nothing;
  select quantity, avg_cost, stock_value into v_q, v_a, v_v
    from product_branch_stock where product_id = p_product and branch_id = p_branch for update;
  n_q := v_q + p_dq;
  n_v := round(v_v + p_dv, 4);
  n_a := case when n_q > 0 then round(n_v / n_q, 6) else v_a end;
  update product_branch_stock
     set quantity = n_q, avg_cost = n_a, stock_value = n_v, last_movement_at = now()
   where product_id = p_product and branch_id = p_branch;
  return query select n_q, n_a, n_v;
end;
$$;

-- دمج دفعة العجز (مخزون سالب سابق) مع أقدم الدفعات الموجبة عند وصول بضاعة
create or replace function _layers_net_deficit(p_branch uuid, p_product uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d stock_layers; l record; v_left numeric(18,4); v_t numeric(18,4); v_dv numeric(18,4);
begin
  select * into d from stock_layers
   where branch_id = p_branch and product_id = p_product and is_deficit and remaining_qty < 0
   for update;
  if not found then return; end if;
  v_left := -d.remaining_qty;
  for l in select id, remaining_qty from stock_layers
            where branch_id = p_branch and product_id = p_product
              and not is_deficit and remaining_qty > 0
            order by received_date, seq for update
  loop
    exit when v_left <= 0;
    v_t  := least(v_left, l.remaining_qty);
    v_dv := round(d.remaining_value * v_t / d.remaining_qty, 4);   -- سالبة
    update stock_layers set remaining_qty = remaining_qty - v_t,
                            remaining_value = remaining_value + v_dv where id = l.id;
    update stock_layers set remaining_qty = remaining_qty + v_t,
                            remaining_value = remaining_value - v_dv where id = d.id;
    select * into d from stock_layers where id = d.id;
    v_left := v_left - v_t;
  end loop;
  -- ما بقي من قيمة العجز بعد استنفاد كميته يُرحَّل على الدفعة الأخيرة المتأثرة
  if d.remaining_qty = 0 and d.remaining_value <> 0 then
    update stock_layers set remaining_value = remaining_value + d.remaining_value
     where id = (select id from stock_layers
                  where branch_id = p_branch and product_id = p_product and not is_deficit
                  order by received_date desc, seq desc limit 1);
    update stock_layers set remaining_value = 0 where id = d.id;
  end if;
end;
$$;

-- إدخال كمية إلى مخزون جهة: يُنشئ دفعة (أو عدة دفعات عند التحويل) بتكلفتها
--   p_layers: [{qty, cost, date, origin}] لنقل دفعات مصدر بتكاليفها وتواريخها الأصلية
drop function if exists stock_in(date, uuid, uuid, numeric, numeric, doc_type, uuid, uuid, text, text, uuid, numeric);
create or replace function stock_in(
  p_date       date,
  p_branch_id  uuid,
  p_product_id uuid,
  p_qty        numeric,
  p_unit_cost  numeric,
  p_doc_type   doc_type,
  p_doc_id     uuid,
  p_doc_line_id uuid,
  p_doc_no     text default null,
  p_desc       text default null,
  p_user_id    uuid default null,
  p_total_cost numeric default null,
  p_layers     jsonb default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric(18,4);
  v_unit  numeric(18,6);
  v_mv    uuid;
  v_r     record;
  v_el    jsonb;
  v_sq    numeric := 0;
  v_sc    numeric := 0;
begin
  if p_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  perform _assert_product_branch(p_product_id, p_branch_id);

  v_total := coalesce(round(p_total_cost, 4), round(p_qty * p_unit_cost, 4));
  v_unit  := round(v_total / p_qty, 6);

  select * into v_r from _pbs_apply(p_branch_id, p_product_id, p_qty, v_total);

  insert into stock_movements (move_date, branch_id, product_id, direction, quantity,
                               unit_cost, total_cost, qty_after, avg_cost_after, value_after,
                               doc_type, doc_id, doc_line_id, doc_no, description, created_by)
  values (p_date, p_branch_id, p_product_id, 'in', p_qty,
          v_unit, v_total, v_r.qty_after, v_r.avg_after, v_r.value_after,
          p_doc_type, p_doc_id, p_doc_line_id, p_doc_no, p_desc, p_user_id)
  returning id into v_mv;

  if p_layers is null then
    insert into stock_layers (branch_id, product_id, received_date, movement_id,
                              doc_type, doc_id, doc_line_id, doc_no,
                              original_qty, original_value, unit_cost,
                              remaining_qty, remaining_value)
    values (p_branch_id, p_product_id, p_date, v_mv, p_doc_type, p_doc_id, p_doc_line_id, p_doc_no,
            p_qty, v_total, v_unit, p_qty, v_total);
  else
    for v_el in select * from jsonb_array_elements(p_layers) loop
      insert into stock_layers (branch_id, product_id, received_date, movement_id,
                                doc_type, doc_id, doc_line_id, doc_no, origin_layer_id,
                                original_qty, original_value, unit_cost,
                                remaining_qty, remaining_value)
      values (p_branch_id, p_product_id, (v_el->>'date')::date, v_mv,
              p_doc_type, p_doc_id, p_doc_line_id, p_doc_no,
              nullif(v_el->>'origin','')::uuid,
              (v_el->>'qty')::numeric, (v_el->>'cost')::numeric,
              case when (v_el->>'qty')::numeric = 0 then 0
                   else round((v_el->>'cost')::numeric / (v_el->>'qty')::numeric, 6) end,
              (v_el->>'qty')::numeric, (v_el->>'cost')::numeric);
      v_sq := v_sq + (v_el->>'qty')::numeric;
      v_sc := v_sc + (v_el->>'cost')::numeric;
    end loop;
    if round(v_sq, 4) <> round(p_qty, 4) or round(v_sc, 4) <> v_total then
      raise exception 'مجموع الدفعات (% / %) لا يطابق حركة المخزون (% / %)', v_sq, v_sc, p_qty, v_total;
    end if;
  end if;

  perform _layers_net_deficit(p_branch_id, p_product_id);
  return v_total;
end;
$$;

-- إخراج كمية: تُستهلك الدفعات بترتيب FIFO (الأقدم أولًا)، وتُسجَّل كل دفعة مستهلكة
-- بكميتها وتكلفتها، فتُحسب تكلفة البضاعة المباعة من الدفعات الفعلية.
--   في طريقة المتوسط المرجح تُحتسب تكلفة الحركة من وعاء المتوسط كما كان سابقًا،
--   وتبقى الدفعات تتبع الكميات للرجوع إليها.
--   p_prefer_doc: يستهلك دفعات مستند معين أولًا (مرتجع المشتريات من فاتورتها).
drop function if exists stock_out(date, uuid, uuid, numeric, doc_type, uuid, uuid, text, text, uuid, numeric);
create or replace function stock_out(
  p_date       date,
  p_branch_id  uuid,
  p_product_id uuid,
  p_qty        numeric,
  p_doc_type   doc_type,
  p_doc_id     uuid,
  p_doc_line_id uuid,
  p_doc_no     text default null,
  p_desc       text default null,
  p_user_id    uuid default null,
  p_forced_unit_cost numeric default null,
  p_prefer_doc uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_qty     numeric(18,4);
  v_avg     numeric(18,6);
  v_value   numeric(18,4);
  v_method  text;
  v_allow   boolean;
  v_pname   text;
  v_need    numeric(18,4);
  v_take    numeric(18,4);
  v_lcost   numeric(18,4);
  v_layer   record;
  v_def     uuid;
  v_ids     uuid[] := '{}';
  v_qs      numeric[] := '{}';
  v_cs      numeric[] := '{}';
  v_ltotal  numeric(18,4) := 0;
  v_total   numeric(18,4);
  v_unit    numeric(18,6);
  v_mv      uuid;
  v_r       record;
  i         int;
begin
  if p_qty <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  perform _assert_product_branch(p_product_id, p_branch_id);

  insert into product_branch_stock (product_id, branch_id) values (p_product_id, p_branch_id)
  on conflict do nothing;
  select quantity, avg_cost, stock_value into v_qty, v_avg, v_value
    from product_branch_stock
   where product_id = p_product_id and branch_id = p_branch_id for update;

  select inventory_valuation, allow_negative_stock into v_method, v_allow from settings where id;

  if v_qty - p_qty < 0 and not v_allow then
    select name_ar into v_pname from products where id = p_product_id;
    raise exception 'الكمية غير كافية للمنتج «%»: الرصيد % والمطلوب %',
      v_pname, v_qty, p_qty using errcode = 'P0001';
  end if;

  -- استهلاك الدفعات
  v_need := p_qty;
  for v_layer in
    select id, remaining_qty, remaining_value from stock_layers
     where branch_id = p_branch_id and product_id = p_product_id
       and remaining_qty > 0 and not is_deficit
     order by (case when p_prefer_doc is not null and doc_id = p_prefer_doc then 0 else 1 end),
              received_date, seq
       for update
  loop
    exit when v_need <= 0;
    v_take  := least(v_need, v_layer.remaining_qty);
    v_lcost := case when v_take = v_layer.remaining_qty then v_layer.remaining_value
                    else round(v_layer.remaining_value * v_take / v_layer.remaining_qty, 4) end;
    update stock_layers
       set remaining_qty = remaining_qty - v_take,
           remaining_value = remaining_value - v_lcost
     where id = v_layer.id;
    v_ids := v_ids || v_layer.id; v_qs := v_qs || v_take; v_cs := v_cs || v_lcost;
    v_ltotal := v_ltotal + v_lcost;
    v_need := v_need - v_take;
  end loop;

  -- عجز (مخزون سالب مسموح): يُحمَّل على دفعة عجز بتكلفة المتوسط
  if v_need > 0 then
    if not v_allow then
      raise exception 'اختلال بين دفعات المخزون ورصيده: راجع فحوص السلامة';
    end if;
    select id into v_def from stock_layers
     where branch_id = p_branch_id and product_id = p_product_id and is_deficit for update;
    if v_def is null then
      insert into stock_layers (branch_id, product_id, received_date, doc_type, doc_no,
                                original_qty, original_value, unit_cost,
                                remaining_qty, remaining_value, is_deficit)
      values (p_branch_id, p_product_id, p_date, p_doc_type, p_doc_no, 0, 0, v_avg, 0, 0, true)
      returning id into v_def;
    end if;
    v_lcost := round(v_need * v_avg, 4);
    update stock_layers set remaining_qty = remaining_qty - v_need,
                            remaining_value = remaining_value - v_lcost where id = v_def;
    v_ids := v_ids || v_def; v_qs := v_qs || v_need; v_cs := v_cs || v_lcost;
    v_ltotal := v_ltotal + v_lcost;
  end if;

  -- تكلفة الحركة في الدفتر
  if v_method = 'fifo' then
    v_total := v_ltotal;
  elsif p_forced_unit_cost is not null then
    v_total := round(p_qty * p_forced_unit_cost, 4);
  elsif v_qty > 0 and p_qty >= v_qty then
    v_total := v_value;
  elsif v_qty > 0 then
    v_total := round(v_value * p_qty / v_qty, 4);
  else
    v_total := round(p_qty * v_avg, 4);
  end if;
  v_unit := round(v_total / p_qty, 6);

  select * into v_r from _pbs_apply(p_branch_id, p_product_id, -p_qty, -v_total);

  insert into stock_movements (move_date, branch_id, product_id, direction, quantity,
                               unit_cost, total_cost, qty_after, avg_cost_after, value_after,
                               doc_type, doc_id, doc_line_id, doc_no, description, created_by)
  values (p_date, p_branch_id, p_product_id, 'out', p_qty,
          v_unit, v_total, v_r.qty_after, v_r.avg_after, v_r.value_after,
          p_doc_type, p_doc_id, p_doc_line_id, p_doc_no, p_desc, p_user_id)
  returning id into v_mv;

  for i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    insert into stock_layer_consumptions (movement_id, layer_id, qty, cost)
    values (v_mv, v_ids[i], v_qs[i], v_cs[i]);
  end loop;

  return v_total;
end;
$$;

-- عكس حركات مستند عند إلغائه، بحركات عكسية موثقة لا بحذف السجل.
--   عكس إدخال: الدفعة يجب أن تكون كاملة لم يُستهلك منها شيء، وإلا يُرفض الإلغاء
--              (بضاعة بيعت منها؛ يُستخدم مرتجع بدل الإلغاء).
--   عكس إخراج: تعود الكميات والتكاليف إلى الدفعات التي استُهلكت منها.
drop function if exists stock_reverse_document(doc_type, uuid, date, uuid);
create or replace function stock_reverse_document(
  p_doc_type doc_type,
  p_doc_id   uuid,
  p_date     date,
  p_user_id  uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m   record;
  c   record;
  l   record;
  v_r record;
begin
  for m in
    select * from stock_movements
     where doc_type = p_doc_type and doc_id = p_doc_id
       and description is distinct from 'عكس حركة ملغاة'
     order by created_at, id
  loop
    if m.direction = 'in' then
      for l in select * from stock_layers where movement_id = m.id for update loop
        if l.remaining_qty <> l.original_qty then
          raise exception 'لا يمكن الإلغاء: جزء من البضاعة الواردة (%) استُهلك بالبيع أو التحويل. استخدم مرتجعًا بدل الإلغاء.',
            coalesce(l.doc_no, '') using errcode = 'P0001';
        end if;
        update stock_layers set remaining_qty = 0, remaining_value = 0, voided_at = now()
         where id = l.id;
      end loop;

      select * into v_r from _pbs_apply(m.branch_id, m.product_id, -m.quantity, -m.total_cost);
      if v_r.qty_after < 0 and not (select allow_negative_stock from settings where id) then
        raise exception 'لا يمكن الإلغاء: الرصيد الحالي لا يكفي لعكس الحركة';
      end if;
      insert into stock_movements (move_date, branch_id, product_id, direction, quantity,
                                   unit_cost, total_cost, qty_after, avg_cost_after, value_after,
                                   doc_type, doc_id, doc_line_id, doc_no, description, created_by)
      values (p_date, m.branch_id, m.product_id, 'out', m.quantity, m.unit_cost, m.total_cost,
              v_r.qty_after, v_r.avg_after, v_r.value_after,
              p_doc_type, p_doc_id, null, m.doc_no, 'عكس حركة ملغاة', p_user_id);
    else
      for c in select * from stock_layer_consumptions where movement_id = m.id loop
        update stock_layers set remaining_qty = remaining_qty + c.qty,
                                remaining_value = remaining_value + c.cost
         where id = c.layer_id;
      end loop;

      select * into v_r from _pbs_apply(m.branch_id, m.product_id, m.quantity, m.total_cost);
      insert into stock_movements (move_date, branch_id, product_id, direction, quantity,
                                   unit_cost, total_cost, qty_after, avg_cost_after, value_after,
                                   doc_type, doc_id, doc_line_id, doc_no, description, created_by)
      values (p_date, m.branch_id, m.product_id, 'in', m.quantity, m.unit_cost, m.total_cost,
              v_r.qty_after, v_r.avg_after, v_r.value_after,
              p_doc_type, p_doc_id, null, m.doc_no, 'عكس حركة ملغاة', p_user_id);
      -- الحركة العكسية للإدخال لا تُنشئ دفعة جديدة؛ الدفعات المستعادة أعلاه تكفي
    end if;
  end loop;
end;
$$;

-- نسخ بطاقة المنتج إلى جهة أخرى عند أول تحويل (مطابقة بالكود)
create or replace function ensure_branch_product(p_product_id uuid, p_branch_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_src products; v_id uuid;
begin
  select * into v_src from products where id = p_product_id;
  if not found then raise exception 'المنتج غير موجود'; end if;
  if v_src.branch_id = p_branch_id then return v_src.id; end if;

  select id into v_id from products where branch_id = p_branch_id and code = v_src.code;
  if v_id is not null then return v_id; end if;

  insert into products
  select * from jsonb_populate_record(null::products,
           to_jsonb(v_src) || jsonb_build_object('id', gen_random_uuid(),
                                                 'branch_id', p_branch_id,
                                                 'created_at', now(), 'updated_at', now()))
  returning id into v_id;
  return v_id;
end;
$$;

-- تغيير طريقة التقييم: عند العودة إلى FIFO تُعاد معايرة قيم الدفعات لتطابق وعاء
-- التكلفة في الدفتر، فلا يختل تطابق المخزون مع القيود.
create or replace function set_valuation_method(p_method text, p_user_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s record; l record; v_sum numeric(18,4); v_oldest uuid; v_left numeric(18,4); v_new numeric(18,4);
begin
  if p_method not in ('fifo', 'wavg') then raise exception 'طريقة تقييم غير معروفة'; end if;

  if p_method = 'fifo' then
    for s in select * from product_branch_stock where quantity > 0 loop
      select coalesce(sum(remaining_value), 0) into v_sum from stock_layers
       where branch_id = s.branch_id and product_id = s.product_id and remaining_qty > 0;
      if v_sum = s.stock_value then continue; end if;
      if v_sum = 0 then
        update stock_layers set remaining_value = s.stock_value
         where id = (select id from stock_layers
                      where branch_id = s.branch_id and product_id = s.product_id and remaining_qty > 0
                      order by received_date, seq limit 1);
        continue;
      end if;
      v_left := s.stock_value;
      for l in select id, remaining_value from stock_layers
                where branch_id = s.branch_id and product_id = s.product_id and remaining_qty > 0
                order by received_date desc, seq desc
      loop
        v_new := round(l.remaining_value * s.stock_value / v_sum, 4);
        update stock_layers set remaining_value = v_new where id = l.id;
        v_left := v_left - v_new;
      end loop;
      -- فرق التقريب على أقدم دفعة
      update stock_layers set remaining_value = remaining_value + v_left
       where id = (select id from stock_layers
                    where branch_id = s.branch_id and product_id = s.product_id and remaining_qty > 0
                    order by received_date, seq limit 1);
    end loop;
  end if;

  update settings set inventory_valuation = p_method where id;
  insert into audit_logs (user_id, action, entity, entity_id, summary)
  values (p_user_id, 'update', 'settings', null,
          'تغيير طريقة تقييم المخزون إلى ' || case p_method when 'fifo' then 'FIFO' else 'المتوسط المرجح' end);
end;
$$;

-- =============================================================================
-- التحويل بين الجهات: بطاقة المستلم تُنشأ تلقائيًا، والدفعات تنتقل بتكاليفها
-- =============================================================================
create or replace function post_stock_transfer(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_tr     stock_transfers;
  v_line   record;
  v_to     uuid;
  v_cost   numeric(18,4);
  v_total  numeric(18,4) := 0;
  v_layers jsonb;
  v_mv     uuid;
  v_method text;
  v_entry  uuid;
begin
  select * into v_tr from stock_transfers where id = p_id for update;
  if v_tr.status <> 'draft' then raise exception 'لا يمكن ترحيل تحويل حالته %', v_tr.status; end if;
  perform assert_period_open(v_tr.transfer_date);
  select inventory_valuation into v_method from settings where id;

  for v_line in select * from stock_transfer_lines where transfer_id = p_id order by line_no
  loop
    v_to := ensure_branch_product(v_line.product_id, v_tr.to_branch_id);
    update stock_transfer_lines set to_product_id = v_to where id = v_line.id;

    -- الإخراج بتكلفة المصدر، والإدخال بالتكلفة نفسها: لا تتضاعف التكلفة ولا تُخلق قيمة
    v_cost := stock_out(v_tr.transfer_date, v_tr.from_branch_id, v_line.product_id, v_line.quantity,
                        'stock_transfer', p_id, v_line.id, v_tr.transfer_no,
                        'تحويل صادر ' || v_tr.transfer_no, p_user_id);

    v_layers := null;
    if v_method = 'fifo' then
      select id into v_mv from stock_movements
       where doc_type = 'stock_transfer' and doc_id = p_id and doc_line_id = v_line.id
         and direction = 'out' and branch_id = v_tr.from_branch_id;
      select jsonb_agg(jsonb_build_object('qty', c.qty, 'cost', c.cost,
                                          'date', l.received_date, 'origin', c.layer_id)
                       order by l.received_date, l.seq)
        into v_layers
        from stock_layer_consumptions c join stock_layers l on l.id = c.layer_id
       where c.movement_id = v_mv;
    end if;

    perform stock_in(v_tr.transfer_date, v_tr.to_branch_id, v_to, v_line.quantity,
                     case when v_line.quantity = 0 then 0 else v_cost / v_line.quantity end,
                     'stock_transfer', p_id, v_line.id, v_tr.transfer_no,
                     'تحويل وارد ' || v_tr.transfer_no, p_user_id, v_cost, v_layers);

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

-- =============================================================================
-- مرتجع المشتريات: يستهلك دفعات الفاتورة الأصلية أولًا، وفرق التكلفة يُسجَّل
--   (سعر المرتجع قد يختلف عن التكلفة الفعلية للدفعة بعد تحميل الشحن).
-- =============================================================================
create or replace function post_purchase_return(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_ret    purchase_returns;
  v_line   record;
  v_lines  jsonb := '[]'::jsonb;
  v_net    numeric(18,4) := 0;
  v_actual numeric(18,4) := 0;
  v_tax    numeric(18,4) := 0;
  v_diff   numeric(18,4);
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
    into v_net, v_tax from purchase_return_lines where return_id = p_id;

  update purchase_returns
     set subtotal = v_net, tax_total = v_tax, total = round(v_net + v_tax, 4)
   where id = p_id;

  for v_line in select * from purchase_return_lines where return_id = p_id order by line_no
  loop
    v_actual := v_actual + stock_out(v_ret.return_date, v_ret.branch_id, v_line.product_id,
                      v_line.quantity, 'purchase_return', p_id, v_line.id, v_ret.return_no,
                      'مرتجع مشتريات ' || v_ret.return_no, p_user_id,
                      v_line.unit_cost, v_ret.invoice_id);
  end loop;

  v_lines := v_lines || jsonb_build_object('account','inventory','branch',v_ret.branch_id,
               'credit', v_actual, 'description','بضاعة مرتجعة للمورد');
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_object('account','tax_input','branch',v_ret.branch_id,
                 'credit', v_tax, 'description','عكس ضريبة مشتريات');
  end if;

  -- فرق بين ما يرده المورد وتكلفة الدفعة الفعلية (مصاريف الشحن المحمّلة لا يردها المورد)
  v_diff := round(v_net - v_actual, 4);
  if v_diff > 0 then
    v_lines := v_lines || jsonb_build_object('account','inventory_adjustment','branch',v_ret.branch_id,
                 'credit', v_diff, 'description','فرق تكلفة مرتجع مشتريات');
  elsif v_diff < 0 then
    v_lines := v_lines || jsonb_build_object('account','inventory_adjustment','branch',v_ret.branch_id,
                 'debit', -v_diff, 'description','فرق تكلفة مرتجع مشتريات');
  end if;

  if v_ret.settle_mode = 'credit' then
    v_lines := v_lines || jsonb_build_object('account','ap','branch',v_ret.branch_id,
                 'debit', round(v_net + v_tax, 4), 'party_type','supplier','party',v_ret.supplier_id,
                 'description','خصم من ذمة المورد');
  else
    select kind into v_kind from treasury_accounts where id = v_ret.treasury_account_id;
    if v_kind is null then raise exception 'يجب تحديد الصندوق أو البنك لاسترداد قيمة المرتجع'; end if;
    v_lines := v_lines || jsonb_build_object(
                 'account', case when v_kind = 'cash' then 'cash' else 'bank' end,
                 'branch', v_ret.branch_id, 'debit', round(v_net + v_tax, 4),
                 'treasury', v_ret.treasury_account_id, 'description','استرداد قيمة مرتجع');
  end if;

  v_entry := post_journal(v_ret.return_date, v_ret.branch_id, 'purchase_return', p_id,
                          'مرتجع مشتريات ' || v_ret.return_no, v_lines, false, p_user_id);

  update purchase_returns set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

-- ---------------------- الصلاحيات على الدوال الحساسة ---------------------------
alter function stock_in(date, uuid, uuid, numeric, numeric, doc_type, uuid, uuid, text, text, uuid, numeric, jsonb)
  security definer set search_path = public;
alter function stock_out(date, uuid, uuid, numeric, doc_type, uuid, uuid, text, text, uuid, numeric, uuid)
  security definer set search_path = public;
alter function stock_reverse_document(doc_type, uuid, date, uuid)
  security definer set search_path = public;
grant execute on all functions in schema public to authenticated;
