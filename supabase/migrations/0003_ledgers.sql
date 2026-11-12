-- =============================================================================
-- 0003_ledgers.sql — دفتر الأستاذ العام وحركة المخزون
--
--   مبدأ التصميم: كل أثر مالي في النظام يُسجَّل مرة واحدة فقط في journal_lines،
--   وكل التقارير (الأرباح، الصندوق، البنك، الذمم، ميزان المراجعة) تُقرأ من هذا
--   الدفتر نفسه. هذا يجعل ازدواجية الاحتساب مستحيلة بنيويًا لا بالاتفاق فقط.
--   وحركة الكميات تُسجَّل في stock_movements بنفس المنطق.
-- =============================================================================

-- ------------------------------ القيود المحاسبية ------------------------------
create table journal_entries (
  id                uuid primary key default gen_random_uuid(),
  entry_no          text not null,
  entry_date        date not null,
  branch_id         uuid references branches(id) on delete restrict,
  doc_type          doc_type not null,
  doc_id            uuid,
  description       text,
  is_reversal       boolean not null default false,
  reverses_entry_id uuid references journal_entries(id) on delete restrict,
  created_by        uuid references app_users(id),
  created_at        timestamptz not null default now()
);

-- لا يمكن ترحيل المستند نفسه مرتين: الحماية البنيوية من ازدواجية الاحتساب
create unique index journal_entries_doc_once
  on journal_entries (doc_type, doc_id) where doc_id is not null and not is_reversal;
create unique index journal_entries_doc_reversed_once
  on journal_entries (doc_type, doc_id) where doc_id is not null and is_reversal;
create index journal_entries_date_idx on journal_entries(entry_date);

create table journal_lines (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references journal_entries(id) on delete cascade,
  line_no             int  not null,
  entry_date          date not null,                                   -- منسوخ للفهرسة
  account_id          uuid not null references accounts(id) on delete restrict,
  branch_id           uuid references branches(id) on delete restrict, -- الوحدة التي تتحمل الحركة
  debit               numeric(18,4) not null default 0 check (debit  >= 0),
  credit              numeric(18,4) not null default 0 check (credit >= 0),
  party_type          party_type,
  party_id            uuid,
  treasury_account_id uuid references treasury_accounts(id) on delete restrict,
  product_id          uuid references products(id) on delete restrict,
  description         text,
  check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0) or (debit = 0 and credit = 0)
  )
);

create index journal_lines_entry_idx    on journal_lines(entry_id);
create index journal_lines_account_idx  on journal_lines(account_id, entry_date);
create index journal_lines_branch_idx   on journal_lines(branch_id, entry_date);
create index journal_lines_party_idx    on journal_lines(party_type, party_id, entry_date);
create index journal_lines_treasury_idx on journal_lines(treasury_account_id, entry_date);
create index journal_lines_product_idx  on journal_lines(product_id, entry_date);

-- ------------------------------- حركة المخزون ---------------------------------
create table stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  move_date          date not null,
  branch_id          uuid not null references branches(id) on delete restrict,
  product_id         uuid not null references products(id) on delete restrict,
  direction          stock_direction not null,
  quantity           numeric(18,4) not null check (quantity > 0),
  unit_cost          numeric(18,6) not null check (unit_cost >= 0),
  total_cost         numeric(18,4) not null,
  qty_after          numeric(18,4) not null,
  avg_cost_after     numeric(18,6) not null,
  value_after        numeric(18,4) not null,
  doc_type           doc_type not null,
  doc_id             uuid,
  doc_line_id        uuid,
  doc_no             text,
  description        text,
  created_by         uuid references app_users(id),
  created_at         timestamptz not null default now()
);

create index stock_movements_prod_branch_idx on stock_movements(product_id, branch_id, move_date);
create index stock_movements_doc_idx         on stock_movements(doc_type, doc_id);
-- السطر الواحد من المستند لا يحرك المخزون أكثر من مرة في الاتجاه نفسه
create unique index stock_movements_line_once
  on stock_movements(doc_type, doc_id, doc_line_id, direction, branch_id)
  where doc_line_id is not null;

-- =============================================================================
-- دوال الترحيل
-- =============================================================================

-- ترحيل قيد محاسبي متوازن. p_lines مصفوفة JSON من الكائنات:
--   { account: '<system_key أو code>', branch: uuid, debit: n, credit: n,
--     party_type: 'customer'|'supplier', party: uuid, treasury: uuid,
--     product: uuid, description: text }
create or replace function post_journal(
  p_date        date,
  p_branch_id   uuid,
  p_doc_type    doc_type,
  p_doc_id      uuid,
  p_description text,
  p_lines       jsonb,
  p_is_reversal boolean default false,
  p_user_id     uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_entry_id   uuid;
  v_entry_no   text;
  v_line       jsonb;
  v_no         int := 0;
  v_account_id uuid;
  v_debit      numeric(18,4);
  v_credit     numeric(18,4);
  v_sum_debit  numeric(18,4) := 0;
  v_sum_credit numeric(18,4) := 0;
begin
  perform assert_period_open(p_date);

  v_entry_no := next_document_number('journal_voucher'::doc_type, null, p_date);
  v_entry_no := 'JV-' || v_entry_no;

  insert into journal_entries (entry_no, entry_date, branch_id, doc_type, doc_id,
                               description, is_reversal, created_by)
  values (v_entry_no, p_date, p_branch_id, p_doc_type, p_doc_id,
          p_description, p_is_reversal, p_user_id)
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_debit  := round(coalesce((v_line->>'debit')::numeric,  0), 4);
    v_credit := round(coalesce((v_line->>'credit')::numeric, 0), 4);

    if v_debit = 0 and v_credit = 0 then
      continue;  -- تجاهل الأسطر الصفرية
    end if;

    select id into v_account_id
      from accounts
     where system_key = (v_line->>'account')
        or code       = (v_line->>'account')
     order by (system_key = (v_line->>'account')) desc
     limit 1;

    if v_account_id is null then
      raise exception 'الحساب % غير معرف في دليل الحسابات', v_line->>'account';
    end if;

    v_no := v_no + 1;
    insert into journal_lines (entry_id, line_no, entry_date, account_id, branch_id,
                               debit, credit, party_type, party_id,
                               treasury_account_id, product_id, description)
    values (
      v_entry_id, v_no, p_date, v_account_id,
      coalesce((v_line->>'branch')::uuid, p_branch_id),
      v_debit, v_credit,
      nullif(v_line->>'party_type','')::party_type,
      nullif(v_line->>'party','')::uuid,
      nullif(v_line->>'treasury','')::uuid,
      nullif(v_line->>'product','')::uuid,
      v_line->>'description'
    );

    v_sum_debit  := v_sum_debit  + v_debit;
    v_sum_credit := v_sum_credit + v_credit;
  end loop;

  if round(v_sum_debit, 4) <> round(v_sum_credit, 4) then
    raise exception 'القيد غير متوازن: مدين % ودائن %', v_sum_debit, v_sum_credit
      using errcode = 'P0001';
  end if;

  if v_no = 0 then
    raise exception 'لا يمكن ترحيل قيد بلا أسطر' using errcode = 'P0001';
  end if;

  return v_entry_id;
end;
$$;

-- عكس قيد مستند عند الإلغاء (بنفس القيم وباتجاه معاكس)
create or replace function reverse_journal(
  p_doc_type doc_type,
  p_doc_id   uuid,
  p_date     date,
  p_reason   text default null,
  p_user_id  uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_src      journal_entries;
  v_entry_id uuid;
  v_entry_no text;
begin
  select * into v_src
    from journal_entries
   where doc_type = p_doc_type and doc_id = p_doc_id and not is_reversal;

  if not found then
    raise exception 'لا يوجد قيد مرحل لهذا المستند';
  end if;

  perform assert_period_open(p_date);

  v_entry_no := 'JV-R-' || next_document_number('journal_voucher'::doc_type, null, p_date);

  insert into journal_entries (entry_no, entry_date, branch_id, doc_type, doc_id, description,
                               is_reversal, reverses_entry_id, created_by)
  values (v_entry_no, p_date, v_src.branch_id, p_doc_type, p_doc_id,
          coalesce(p_reason, 'إلغاء: ' || coalesce(v_src.description, '')),
          true, v_src.id, p_user_id)
  returning id into v_entry_id;

  insert into journal_lines (entry_id, line_no, entry_date, account_id, branch_id,
                             debit, credit, party_type, party_id,
                             treasury_account_id, product_id, description)
  select v_entry_id, line_no, p_date, account_id, branch_id,
         credit, debit,            -- العكس
         party_type, party_id, treasury_account_id, product_id,
         'عكس: ' || coalesce(description, '')
    from journal_lines
   where entry_id = v_src.id;

  return v_entry_id;
end;
$$;

-- ----------------------------- حركات المخزون ----------------------------------

-- إدخال كمية إلى مخزون فرع + إعادة حساب المتوسط المرجح المتحرك
--
--   قيمة المخزون (stock_value) هي وعاء التكلفة المرجعي: تتحرك بنفس المبالغ
--   التي تدخل القيد المحاسبي بالضبط، ومتوسط التكلفة يُشتق منها. بهذا يتطابق
--   تقرير المخزون مع حساب المخزون في الدفتر بلا فروقات تقريب.
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
  p_total_cost numeric default null   -- تكلفة إجمالية محددة بدل (كمية × سعر)
) returns numeric          -- يعيد التكلفة الإجمالية المدخلة
language plpgsql
as $$
declare
  v_old_qty   numeric(18,4);
  v_old_avg   numeric(18,6);
  v_old_value numeric(18,4);
  v_new_qty   numeric(18,4);
  v_new_avg   numeric(18,6);
  v_new_value numeric(18,4);
  v_total     numeric(18,4);
  v_unit      numeric(18,6);
begin
  if p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  insert into product_branch_stock (product_id, branch_id)
  values (p_product_id, p_branch_id)
  on conflict do nothing;

  select quantity, avg_cost, stock_value into v_old_qty, v_old_avg, v_old_value
    from product_branch_stock
   where product_id = p_product_id and branch_id = p_branch_id
   for update;

  v_total     := coalesce(round(p_total_cost, 4), round(p_qty * p_unit_cost, 4));
  v_unit      := case when p_qty = 0 then p_unit_cost else round(v_total / p_qty, 6) end;
  v_new_qty   := v_old_qty + p_qty;
  v_new_value := round(v_old_value + v_total, 4);

  if v_new_qty > 0 then
    v_new_avg := round(v_new_value / v_new_qty, 6);
  else
    v_new_avg := v_old_avg;
  end if;

  update product_branch_stock
     set quantity = v_new_qty,
         avg_cost = v_new_avg,
         stock_value = v_new_value,
         last_movement_at = now()
   where product_id = p_product_id and branch_id = p_branch_id;

  insert into stock_movements (move_date, branch_id, product_id, direction, quantity,
                               unit_cost, total_cost, qty_after, avg_cost_after, value_after,
                               doc_type, doc_id, doc_line_id, doc_no, description, created_by)
  values (p_date, p_branch_id, p_product_id, 'in', p_qty,
          v_unit, v_total, v_new_qty, v_new_avg, v_new_value,
          p_doc_type, p_doc_id, p_doc_line_id, p_doc_no, p_desc, p_user_id);

  return v_total;
end;
$$;

-- إخراج كمية من مخزون فرع بتكلفة المتوسط المرجح وقت الحركة
-- p_forced_unit_cost: يُستخدم في مرتجع المشتريات وعكس القيود بتكلفة محددة
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
  p_forced_unit_cost numeric default null
) returns numeric          -- يعيد تكلفة البضاعة المخرجة
language plpgsql
as $$
declare
  v_qty        numeric(18,4);
  v_avg        numeric(18,6);
  v_value      numeric(18,4);
  v_unit_cost  numeric(18,6);
  v_total      numeric(18,4);
  v_new_qty    numeric(18,4);
  v_new_value  numeric(18,4);
  v_new_avg    numeric(18,6);
  v_allow_neg  boolean;
  v_pname      text;
begin
  if p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر';
  end if;

  insert into product_branch_stock (product_id, branch_id)
  values (p_product_id, p_branch_id)
  on conflict do nothing;

  select quantity, avg_cost, stock_value into v_qty, v_avg, v_value
    from product_branch_stock
   where product_id = p_product_id and branch_id = p_branch_id
   for update;

  select allow_negative_stock into v_allow_neg from settings where id;

  v_new_qty := v_qty - p_qty;

  if v_new_qty < 0 and not v_allow_neg then
    select name_ar into v_pname from products where id = p_product_id;
    raise exception 'الكمية غير كافية للمنتج «%»: الرصيد % والمطلوب %',
      v_pname, v_qty, p_qty using errcode = 'P0001';
  end if;

  if p_forced_unit_cost is not null then
    v_unit_cost := p_forced_unit_cost;
    v_total     := round(p_qty * v_unit_cost, 4);
  elsif v_qty > 0 and p_qty >= v_qty then
    v_total     := v_value;              -- خروج كامل الرصيد: يُفرَّغ وعاء التكلفة
    v_unit_cost := round(v_total / p_qty, 6);
  elsif v_qty > 0 then
    v_total     := round(v_value * p_qty / v_qty, 4);
    v_unit_cost := round(v_total / p_qty, 6);
  else
    v_unit_cost := v_avg;
    v_total     := round(p_qty * v_unit_cost, 4);
  end if;

  v_new_value := round(v_value - v_total, 4);
  v_new_avg   := case when v_new_qty > 0 then round(v_new_value / v_new_qty, 6) else v_avg end;

  update product_branch_stock
     set quantity = v_new_qty,
         avg_cost = v_new_avg,
         stock_value = v_new_value,
         last_movement_at = now()
   where product_id = p_product_id and branch_id = p_branch_id;

  insert into stock_movements (move_date, branch_id, product_id, direction, quantity,
                               unit_cost, total_cost, qty_after, avg_cost_after, value_after,
                               doc_type, doc_id, doc_line_id, doc_no, description, created_by)
  values (p_date, p_branch_id, p_product_id, 'out', p_qty,
          v_unit_cost, v_total, v_new_qty, v_new_avg, v_new_value,
          p_doc_type, p_doc_id, p_doc_line_id, p_doc_no, p_desc, p_user_id);

  return v_total;
end;
$$;

-- حذف حركات مستند من المخزون عند الإلغاء (بحركة عكسية موثقة لا بحذف السجل)
create or replace function stock_reverse_document(
  p_doc_type doc_type,
  p_doc_id   uuid,
  p_date     date,
  p_user_id  uuid default null
) returns void
language plpgsql
as $$
declare
  m record;
begin
  for m in
    select * from stock_movements
     where doc_type = p_doc_type and doc_id = p_doc_id
       and description is distinct from 'عكس حركة ملغاة'
     order by created_at
  loop
    if m.direction = 'in' then
      perform stock_out(p_date, m.branch_id, m.product_id, m.quantity,
                        p_doc_type, p_doc_id, null, m.doc_no, 'عكس حركة ملغاة',
                        p_user_id, m.unit_cost);
    else
      perform stock_in(p_date, m.branch_id, m.product_id, m.quantity, m.unit_cost,
                       p_doc_type, p_doc_id, null, m.doc_no, 'عكس حركة ملغاة', p_user_id);
    end if;
  end loop;
end;
$$;
