-- =============================================================================
-- 0007_treasury_parties.sql — التحصيلات، مدفوعات الموردين، سندات القبض والصرف،
--   التحويل بين الصندوق والبنك، الأرصدة الافتتاحية، ودوال الأرصدة
-- =============================================================================

alter table customers add column opening_posted boolean not null default false;
alter table suppliers add column opening_posted boolean not null default false;
alter table treasury_accounts add column opening_posted boolean not null default false;

-- ------------------------------- التحصيلات -----------------------------------
create table collections (
  id                  uuid primary key default gen_random_uuid(),
  collection_no       text not null unique,
  collection_date     date not null,
  branch_id           uuid not null references branches(id) on delete restrict,
  customer_id         uuid not null references customers(id) on delete restrict,
  method              payment_method not null check (method in ('cash','bank')),
  treasury_account_id uuid not null references treasury_accounts(id) on delete restrict,
  amount              numeric(18,4) not null check (amount > 0),
  reference           text,
  notes               text,
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text
);

create index collections_customer_idx on collections(customer_id, collection_date);

-- توزيع الدفعة الواحدة على فاتورة أو عدة فواتير
create table collection_allocations (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  invoice_id    uuid not null references sales_invoices(id) on delete restrict,
  amount        numeric(18,4) not null check (amount > 0),
  unique (collection_id, invoice_id)
);

-- ---------------------------- مدفوعات الموردين --------------------------------
create table supplier_payments (
  id                  uuid primary key default gen_random_uuid(),
  payment_no          text not null unique,
  payment_date        date not null,
  branch_id           uuid not null references branches(id) on delete restrict,
  supplier_id         uuid not null references suppliers(id) on delete restrict,
  method              payment_method not null check (method in ('cash','bank')),
  treasury_account_id uuid not null references treasury_accounts(id) on delete restrict,
  amount              numeric(18,4) not null check (amount > 0),
  reference           text,
  notes               text,
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text
);

create table supplier_payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references supplier_payments(id) on delete cascade,
  invoice_id  uuid not null references purchase_invoices(id) on delete restrict,
  amount      numeric(18,4) not null check (amount > 0),
  unique (payment_id, invoice_id)
);

-- --------------------- التحويل بين الصندوق والبنك -----------------------------
create table treasury_transfers (
  id              uuid primary key default gen_random_uuid(),
  transfer_no     text not null unique,
  transfer_date   date not null,
  from_account_id uuid not null references treasury_accounts(id) on delete restrict,
  to_account_id   uuid not null references treasury_accounts(id) on delete restrict,
  amount          numeric(18,4) not null check (amount > 0),
  fees            numeric(18,4) not null default 0 check (fees >= 0),   -- رسوم بنكية إن وجدت
  reference       text,
  notes           text,
  status          doc_status not null default 'draft',
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  check (from_account_id <> to_account_id)
);

-- ------------------------ سندات القبض والصرف العامة ---------------------------
-- للمقبوضات والمدفوعات التي لا تمر بالعملاء أو الموردين
create table vouchers (
  id                  uuid primary key default gen_random_uuid(),
  voucher_no          text not null unique,
  voucher_date        date not null,
  kind                text not null check (kind in ('receipt','payment')),
  branch_id           uuid not null references branches(id) on delete restrict,
  treasury_account_id uuid not null references treasury_accounts(id) on delete restrict,
  counter_account_id  uuid not null references accounts(id) on delete restrict,
  amount              numeric(18,4) not null check (amount > 0),
  payee               text,
  description         text,
  reference           text,
  status              doc_status not null default 'draft',
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  posted_at           timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text
);

-- ------------------------ المطابقة البنكية ------------------------------------
create table bank_reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  treasury_account_id uuid not null references treasury_accounts(id) on delete cascade,
  statement_date      date not null,
  statement_balance   numeric(18,4) not null,
  book_balance        numeric(18,4) not null,
  difference          numeric(18,4) not null,
  notes               text,
  created_by          uuid references app_users(id),
  created_at          timestamptz not null default now(),
  unique (treasury_account_id, statement_date)
);

create table bank_reconciliation_lines (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references bank_reconciliations(id) on delete cascade,
  journal_line_id   uuid not null references journal_lines(id) on delete restrict,
  is_cleared        boolean not null default false,
  unique (reconciliation_id, journal_line_id)
);

-- =============================================================================
-- دوال الأرصدة — كلها تقرأ من دفتر الأستاذ نفسه
-- =============================================================================

-- رصيد العميل = مدين − دائن على حساب الذمم المدينة
create or replace function customer_balance(p_customer_id uuid, p_as_of date default null)
returns numeric
language sql
stable
as $$
  select coalesce(round(sum(l.debit - l.credit), 4), 0)
    from journal_lines l
    join accounts a on a.id = l.account_id
   where a.system_key = 'ar'
     and l.party_type = 'customer'
     and l.party_id = p_customer_id
     and (p_as_of is null or l.entry_date <= p_as_of);
$$;

-- رصيد المورد = دائن − مدين على حساب الذمم الدائنة
create or replace function supplier_balance(p_supplier_id uuid, p_as_of date default null)
returns numeric
language sql
stable
as $$
  select coalesce(round(sum(l.credit - l.debit), 4), 0)
    from journal_lines l
    join accounts a on a.id = l.account_id
   where a.system_key = 'ap'
     and l.party_type = 'supplier'
     and l.party_id = p_supplier_id
     and (p_as_of is null or l.entry_date <= p_as_of);
$$;

-- رصيد صندوق أو حساب بنكي
create or replace function treasury_balance(p_account_id uuid, p_as_of date default null)
returns numeric
language sql
stable
as $$
  select coalesce(round(sum(l.debit - l.credit), 4), 0)
    from journal_lines l
   where l.treasury_account_id = p_account_id
     and (p_as_of is null or l.entry_date <= p_as_of);
$$;

-- المتبقي على فاتورة مبيعات (بعد التحصيلات والمرتجعات المخصومة من الذمة)
create or replace function sales_invoice_outstanding(p_invoice_id uuid)
returns numeric
language sql
stable
as $$
  select round(
    (select remaining from sales_invoices where id = p_invoice_id)
    - coalesce((select sum(a.amount) from collection_allocations a
                 join collections c on c.id = a.collection_id
                where a.invoice_id = p_invoice_id and c.status = 'posted'), 0)
    - coalesce((select sum(r.total) from sales_returns r
                where r.invoice_id = p_invoice_id and r.status = 'posted'
                  and r.refund_mode = 'credit'), 0)
  , 4);
$$;

create or replace function purchase_invoice_outstanding(p_invoice_id uuid)
returns numeric
language sql
stable
as $$
  select round(
    (select remaining from purchase_invoices where id = p_invoice_id)
    - coalesce((select sum(a.amount) from supplier_payment_allocations a
                 join supplier_payments p on p.id = a.payment_id
                where a.invoice_id = p_invoice_id and p.status = 'posted'), 0)
    - coalesce((select sum(r.total) from purchase_returns r
                where r.invoice_id = p_invoice_id and r.status = 'posted'
                  and r.settle_mode = 'credit'), 0)
  , 4);
$$;

-- =============================================================================
-- الترحيل
-- =============================================================================

-- التحصيل: يخفض ذمة العميل ويزيد الصندوق أو البنك — ولا يُسجَّل إيرادًا جديدًا
create or replace function post_collection(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_col   collections;
  v_kind  treasury_kind;
  v_alloc numeric(18,4);
  v_entry uuid;
begin
  select * into v_col from collections where id = p_id for update;
  if v_col.status <> 'draft' then raise exception 'لا يمكن ترحيل تحصيل حالته %', v_col.status; end if;
  perform assert_period_open(v_col.collection_date);

  select coalesce(sum(amount), 0) into v_alloc from collection_allocations where collection_id = p_id;
  if v_alloc > v_col.amount + 0.0001 then
    raise exception 'مجموع التوزيع على الفواتير (%) أكبر من مبلغ التحصيل (%)', v_alloc, v_col.amount;
  end if;

  select kind into v_kind from treasury_accounts where id = v_col.treasury_account_id;

  v_entry := post_journal(v_col.collection_date, v_col.branch_id, 'collection', p_id,
    'سند قبض ' || v_col.collection_no,
    jsonb_build_array(
      jsonb_build_object('account', case when v_kind='cash' then 'cash' else 'bank' end,
                         'branch', v_col.branch_id, 'debit', v_col.amount,
                         'treasury', v_col.treasury_account_id, 'description','تحصيل من عميل'),
      jsonb_build_object('account','ar','branch',v_col.branch_id,'credit', v_col.amount,
                         'party_type','customer','party', v_col.customer_id,
                         'description','تخفيض ذمة العميل')
    ), false, p_user_id);

  update collections set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

create or replace function post_supplier_payment(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_pay   supplier_payments;
  v_kind  treasury_kind;
  v_alloc numeric(18,4);
  v_entry uuid;
begin
  select * into v_pay from supplier_payments where id = p_id for update;
  if v_pay.status <> 'draft' then raise exception 'لا يمكن ترحيل سند حالته %', v_pay.status; end if;
  perform assert_period_open(v_pay.payment_date);

  select coalesce(sum(amount), 0) into v_alloc from supplier_payment_allocations where payment_id = p_id;
  if v_alloc > v_pay.amount + 0.0001 then
    raise exception 'مجموع التوزيع (%) أكبر من مبلغ الدفعة (%)', v_alloc, v_pay.amount;
  end if;

  select kind into v_kind from treasury_accounts where id = v_pay.treasury_account_id;

  -- دفع للمورد: تخفيض الذمة وتخفيض النقدية فقط، بلا تسجيل مشتريات جديدة
  v_entry := post_journal(v_pay.payment_date, v_pay.branch_id, 'supplier_payment', p_id,
    'سند صرف لمورد ' || v_pay.payment_no,
    jsonb_build_array(
      jsonb_build_object('account','ap','branch',v_pay.branch_id,'debit', v_pay.amount,
                         'party_type','supplier','party', v_pay.supplier_id,
                         'description','تخفيض ذمة المورد'),
      jsonb_build_object('account', case when v_kind='cash' then 'cash' else 'bank' end,
                         'branch', v_pay.branch_id, 'credit', v_pay.amount,
                         'treasury', v_pay.treasury_account_id, 'description','دفع لمورد')
    ), false, p_user_id);

  update supplier_payments set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

-- التحويل بين الصندوق والبنك: حركة واحدة بطرفين، بلا إيراد ولا مصروف
create or replace function post_treasury_transfer(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_tr    treasury_transfers;
  v_from  treasury_accounts;
  v_to    treasury_accounts;
  v_lines jsonb;
  v_entry uuid;
begin
  select * into v_tr from treasury_transfers where id = p_id for update;
  if v_tr.status <> 'draft' then raise exception 'لا يمكن ترحيل تحويل حالته %', v_tr.status; end if;
  perform assert_period_open(v_tr.transfer_date);

  select * into v_from from treasury_accounts where id = v_tr.from_account_id;
  select * into v_to   from treasury_accounts where id = v_tr.to_account_id;

  v_lines := jsonb_build_array(
    jsonb_build_object('account', case when v_to.kind='cash' then 'cash' else 'bank' end,
                       'branch', v_to.branch_id, 'debit', v_tr.amount,
                       'treasury', v_to.id, 'description','تحويل وارد'),
    jsonb_build_object('account', case when v_from.kind='cash' then 'cash' else 'bank' end,
                       'branch', v_from.branch_id, 'credit', v_tr.amount,
                       'treasury', v_from.id, 'description','تحويل صادر')
  );

  if v_tr.fees > 0 then
    v_lines := v_lines
      || jsonb_build_object('account','bank_fees','branch', v_from.branch_id,
                            'debit', v_tr.fees, 'description','رسوم تحويل')
      || jsonb_build_object('account', case when v_from.kind='cash' then 'cash' else 'bank' end,
                            'branch', v_from.branch_id, 'credit', v_tr.fees,
                            'treasury', v_from.id, 'description','خصم رسوم التحويل');
  end if;

  v_entry := post_journal(v_tr.transfer_date, v_from.branch_id, 'treasury_transfer', p_id,
                          'تحويل ' || v_tr.transfer_no, v_lines, false, p_user_id);

  update treasury_transfers set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

-- سند قبض / صرف عام
create or replace function post_voucher(p_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_v     vouchers;
  v_kind  treasury_kind;
  v_acc   text;
  v_cnt   text;
  v_entry uuid;
begin
  select * into v_v from vouchers where id = p_id for update;
  if v_v.status <> 'draft' then raise exception 'لا يمكن ترحيل سند حالته %', v_v.status; end if;
  perform assert_period_open(v_v.voucher_date);

  select kind into v_kind from treasury_accounts where id = v_v.treasury_account_id;
  v_acc := case when v_kind = 'cash' then 'cash' else 'bank' end;
  select code into v_cnt from accounts where id = v_v.counter_account_id;

  if v_v.kind = 'receipt' then
    v_entry := post_journal(v_v.voucher_date, v_v.branch_id, 'receipt_voucher', p_id,
      'سند قبض ' || v_v.voucher_no,
      jsonb_build_array(
        jsonb_build_object('account', v_acc, 'branch', v_v.branch_id, 'debit', v_v.amount,
                           'treasury', v_v.treasury_account_id, 'description', v_v.description),
        jsonb_build_object('account', v_cnt, 'branch', v_v.branch_id, 'credit', v_v.amount,
                           'description', v_v.description)
      ), false, p_user_id);
  else
    v_entry := post_journal(v_v.voucher_date, v_v.branch_id, 'payment_voucher', p_id,
      'سند صرف ' || v_v.voucher_no,
      jsonb_build_array(
        jsonb_build_object('account', v_cnt, 'branch', v_v.branch_id, 'debit', v_v.amount,
                           'description', v_v.description),
        jsonb_build_object('account', v_acc, 'branch', v_v.branch_id, 'credit', v_v.amount,
                           'treasury', v_v.treasury_account_id, 'description', v_v.description)
      ), false, p_user_id);
  end if;

  update vouchers set status = 'posted', posted_at = now() where id = p_id;
  return v_entry;
end;
$$;

-- ---------------------------- الأرصدة الافتتاحية ------------------------------
create or replace function post_customer_opening(p_customer_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare v_c customers; v_date date; v_branch uuid; v_entry uuid;
begin
  select * into v_c from customers where id = p_customer_id for update;
  if v_c.opening_posted then raise exception 'الرصيد الافتتاحي لهذا العميل مرحّل مسبقًا'; end if;
  if coalesce(v_c.opening_balance, 0) = 0 then
    update customers set opening_posted = true where id = p_customer_id;
    return null;
  end if;

  select coalesce(v_c.opening_date, system_start_date) into v_date from settings where id;
  select coalesce(v_c.branch_id, (select id from branches where kind='parent')) into v_branch;

  v_entry := post_journal(v_date, v_branch, 'opening_balance', p_customer_id,
    'رصيد افتتاحي للعميل ' || v_c.name,
    jsonb_build_array(
      jsonb_build_object('account','ar','branch',v_branch,'debit', v_c.opening_balance,
                         'party_type','customer','party', p_customer_id,
                         'description','رصيد افتتاحي'),
      jsonb_build_object('account','opening_equity','branch',v_branch,
                         'credit', v_c.opening_balance, 'description','مقابل رصيد افتتاحي')
    ), false, p_user_id);

  update customers set opening_posted = true where id = p_customer_id;
  return v_entry;
end;
$$;

create or replace function post_supplier_opening(p_supplier_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare v_s suppliers; v_date date; v_branch uuid; v_entry uuid;
begin
  select * into v_s from suppliers where id = p_supplier_id for update;
  if v_s.opening_posted then raise exception 'الرصيد الافتتاحي لهذا المورد مرحّل مسبقًا'; end if;
  if coalesce(v_s.opening_balance, 0) = 0 then
    update suppliers set opening_posted = true where id = p_supplier_id;
    return null;
  end if;

  select coalesce(v_s.opening_date, system_start_date) into v_date from settings where id;
  select id into v_branch from branches where kind = 'parent';

  v_entry := post_journal(v_date, v_branch, 'opening_balance', p_supplier_id,
    'رصيد افتتاحي للمورد ' || v_s.name,
    jsonb_build_array(
      jsonb_build_object('account','opening_equity','branch',v_branch,
                         'debit', v_s.opening_balance, 'description','مقابل رصيد افتتاحي'),
      jsonb_build_object('account','ap','branch',v_branch,'credit', v_s.opening_balance,
                         'party_type','supplier','party', p_supplier_id,
                         'description','رصيد افتتاحي')
    ), false, p_user_id);

  update suppliers set opening_posted = true where id = p_supplier_id;
  return v_entry;
end;
$$;

create or replace function post_treasury_opening(p_account_id uuid, p_user_id uuid default null)
returns uuid
language plpgsql
as $$
declare v_t treasury_accounts; v_date date; v_entry uuid;
begin
  select * into v_t from treasury_accounts where id = p_account_id for update;
  if v_t.opening_posted then raise exception 'الرصيد الافتتاحي لهذا الحساب مرحّل مسبقًا'; end if;
  if coalesce(v_t.opening_balance, 0) = 0 then
    update treasury_accounts set opening_posted = true where id = p_account_id;
    return null;
  end if;

  select coalesce(v_t.opening_date, system_start_date) into v_date from settings where id;

  v_entry := post_journal(v_date, v_t.branch_id, 'opening_balance', p_account_id,
    'رصيد افتتاحي — ' || v_t.name_ar,
    jsonb_build_array(
      jsonb_build_object('account', case when v_t.kind='cash' then 'cash' else 'bank' end,
                         'branch', v_t.branch_id, 'debit', v_t.opening_balance,
                         'treasury', p_account_id, 'description','رصيد افتتاحي'),
      jsonb_build_object('account','opening_equity','branch', v_t.branch_id,
                         'credit', v_t.opening_balance, 'description','مقابل رصيد افتتاحي')
    ), false, p_user_id);

  update treasury_accounts set opening_posted = true where id = p_account_id;
  return v_entry;
end;
$$;

-- ------------------------------ الإلغاء العام ---------------------------------
-- إلغاء مستند خزينة أو ذمم (تحصيل، دفعة، تحويل، سند) بعكس قيده
create or replace function cancel_simple_document(
  p_table text, p_id uuid, p_doc_type doc_type, p_date_col text,
  p_reason text, p_user_id uuid default null
) returns void
language plpgsql
as $$
declare v_status doc_status; v_date date;
begin
  execute format('select status, %I from %I where id = $1 for update', p_date_col, p_table)
    into v_status, v_date using p_id;

  if v_status is null then raise exception 'المستند غير موجود'; end if;
  if v_status <> 'posted' then raise exception 'المستند غير مرحل'; end if;

  perform reverse_journal(p_doc_type, p_id, v_date, p_reason, p_user_id);

  execute format(
    'update %I set status = ''cancelled'', cancelled_at = now(), cancel_reason = $2 where id = $1',
    p_table) using p_id, p_reason;
end;
$$;
