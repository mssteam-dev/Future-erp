-- =============================================================================
-- اختبار 4: الشحنات وتوزيع المصاريف، FIFO، التحويل بين الجهات بدفعاتها،
--   الأرصدة الافتتاحية، المدفوع مقدمًا، تبديل طريقة التقييم، الإقفال الشهري.
--   كل رقم محسوب يدويًا (انظر التعليقات).
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  d  date := current_date;
  y  int  := extract(year  from current_date)::int;
  m  int  := extract(month from current_date)::int;
  hq uuid; b1 uuid; b2 uuid; b3 uuid;
  hq_cash uuid; hq_bank uuid; b1_cash uuid; b2_cash uuid;
  sup uuid; car uuid; cus uuid;
  t1 uuid; t2 uuid; t3 uuid;            -- قميص، بنطلون، حقيبة (الشركة الأم)
  s1 uuid; s2 uuid; s3 uuid;            -- الشحنات
  si uuid; si2 uuid; tr uuid; tr2 uuid; adj uuid;
  b1_shirt uuid; b1_bag uuid;
  z uuid; r1 uuid; r2 uuid; r3 uuid; op1 uuid;
  pp1 uuid; pp2 uuid;
  oe uuid; ex_type uuid;
  v numeric; rec record;
  cnt int;
begin
  select id into hq from branches where code='HQ';
  select id into b1 from branches where code='B1';
  select id into b2 from branches where code='B2';
  select id into b3 from branches where code='B3';
  select id into hq_cash from treasury_accounts where code='CASH-HQ';
  select id into hq_bank from treasury_accounts where code='BANK-HQ';
  select id into b1_cash from treasury_accounts where code='CASH-B1';
  select id into b2_cash from treasury_accounts where code='CASH-B2';

  insert into suppliers (code, name) values ('SUP4', 'مورد الشحنات') returning id into sup;
  insert into suppliers (code, name) values ('CAR4', 'شركة الشحن والتخليص') returning id into car;

  perform assert_eq('الطريقة الافتراضية FIFO', 1,
    (select (inventory_valuation = 'fifo')::int from settings where id));

  -- ========================= 1) الأرصدة الافتتاحية ===========================
  update treasury_accounts set opening_balance = 5000 where id = hq_cash;
  update treasury_accounts set opening_balance = 20000 where id = hq_bank;
  perform post_treasury_opening(hq_cash);
  perform post_treasury_opening(hq_bank);
  perform assert_eq('رصيد صندوق الشركة الأم الافتتاحي', 5000, treasury_balance(hq_cash));
  perform assert_eq('رصيد بنك الشركة الأم الافتتاحي', 20000, treasury_balance(hq_bank));

  insert into customers (code, name, branch_id) values ('OC4', 'عميل افتتاحي', b1) returning id into cus;

  -- عميل: مدين 700 في الفرع الأول
  insert into opening_entries (entry_no, entry_date, branch_id, kind, customer_id, side, amount)
  values ('OP-C-1', d, b1, 'customer', cus, 'debit', 700) returning id into oe;
  perform post_opening_entry(oe);
  perform assert_eq('رصيد العميل الافتتاحي', 700, customer_balance(cus));

  -- مورد: دائن 900 في الفرع الأول
  insert into opening_entries (entry_no, entry_date, branch_id, kind, supplier_id, side, amount)
  values ('OP-S-1', d, b1, 'supplier', car, 'credit', 900) returning id into oe;
  perform post_opening_entry(oe);
  perform assert_eq('رصيد المورد الافتتاحي', 900, supplier_balance(car));

  -- رصيد مدين آخر: ضريبة مدخلات 120 في الفرع الثاني
  insert into opening_entries (entry_no, entry_date, branch_id, kind, account_id, side, amount, description)
  select 'OP-O-1', d, b2, 'other', a.id, 'debit', 120, 'رصيد ضريبة مدخلات أول المدة'
    from accounts a where a.system_key = 'tax_input' returning id into oe;
  perform post_opening_entry(oe);
  perform assert_raises('منع رصيد افتتاحي على حساب الصندوق عبر الأرصدة الأخرى',
    $q$ select post_opening_entry((
          with x as (insert into opening_entries (entry_no, entry_date, branch_id, kind, account_id, side, amount)
                     select 'OP-O-2', current_date, (select id from branches where code='B2'), 'other', a.id, 'debit', 5
                       from accounts a where a.system_key = 'cash' returning id) select id from x)) $q$);
  delete from opening_entries where entry_no = 'OP-O-2';

  -- مخزون افتتاحي في الفرع الثالث: 10 قطع بتكلفة 4
  insert into products (code, name_ar, branch_id, default_sale_price) values ('OP1', 'منتج افتتاحي', b3, 9)
    returning id into op1;
  insert into stock_adjustments (adjustment_no, adjustment_date, branch_id, kind, reason)
  values ('ADJ-OP-1', d, b3, 'opening', 'مخزون أول المدة') returning id into adj;
  insert into stock_adjustment_lines (adjustment_id, line_no, product_id, system_qty, counted_qty, difference_qty, unit_cost)
  values (adj, 1, op1, 0, 10, 10, 4);
  perform post_stock_adjustment(adj);
  perform assert_eq('قيمة المخزون الافتتاحي للفرع الثالث', 40,
    (select stock_value from product_branch_stock where product_id = op1 and branch_id = b3));

  -- كل الأرصدة الافتتاحية مقابل حقوق الملكية وليست إيرادًا:
  -- 5000 + 20000 + 700 (عميل) - 900 (مورد) + 120 (أخرى) + 40 (مخزون) = 24960
  select coalesce(sum(jl.credit - jl.debit), 0) into v
    from journal_lines jl join accounts a on a.id = jl.account_id
   where a.system_key = 'opening_equity';
  perform assert_eq('رصيد حساب الأرصدة الافتتاحية (حقوق ملكية)', 24960, v);
  perform assert_eq('الأرصدة الافتتاحية لا تمس الإيرادات', 0,
    (select count(*) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.doc_type in ('opening_balance','opening_stock') and a.type = 'revenue'));

  -- ===================== 2) الشحنة الأولى: توزيع بالقطع ======================
  --   مثال المواصفات: 100 قطعة، مصاريف 30 → 0.30 للقطعة
  insert into products (code, name_ar, branch_id, default_sale_price) values ('T1', 'قميص', hq, 6) returning id into t1;
  insert into products (code, name_ar, branch_id, default_sale_price) values ('T2', 'بنطلون', hq, 8) returning id into t2;
  insert into products (code, name_ar, branch_id, default_sale_price) values ('T3', 'حقيبة', hq, 9) returning id into t3;

  insert into purchase_invoices (invoice_no, shipment_no, invoice_date, supplier_id, branch_id, carrier, alloc_method)
  values (next_document_number('purchase_invoice', hq, d), 'SHP-1', d, sup, hq, 'شحن دولي', 'qty') returning id into s1;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost, weight_kg) values
    (s1, 1, t1, 40, 2, 2), (s1, 2, t2, 30, 3, 3), (s1, 3, t3, 30, 4, 5);
  insert into purchase_invoice_expenses (invoice_id, kind, description, amount, treasury_account_id) values
    (s1, 'freight', 'شحن', 12, hq_bank);                       -- يُدفع فورًا من البنك
  insert into purchase_invoice_expenses (invoice_id, kind, description, amount, supplier_id) values
    (s1, 'customs', 'تخليص جمركي', 10, car);                   -- مستحق لشركة التخليص
  insert into purchase_invoice_expenses (invoice_id, kind, description, amount) values
    (s1, 'transport', 'نقل', 5), (s1, 'insurance', 'تأمين', 2), (s1, 'other', 'أخرى', 1);
  insert into purchase_invoice_payments (invoice_id, method, treasury_account_id, amount)
  values (s1, 'cash', hq_cash, 100);
  perform post_purchase_invoice(s1);

  perform assert_eq('إجمالي مصاريف الشحنة', 30, (select shipping_cost from purchase_invoices where id = s1));
  perform assert_eq('إجمالي وزن الشحنة', 10, (select total_weight_kg from purchase_invoices where id = s1));
  perform assert_eq('نصيب القميص من المصاريف (40 × 0.30)', 12,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s1 and line_no = 1));
  perform assert_eq('نصيب البنطلون (30 × 0.30)', 9,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s1 and line_no = 2));
  perform assert_eq('نصيب الحقيبة (30 × 0.30)', 9,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s1 and line_no = 3));
  perform assert_eq('تكلفة القميص النهائية 2.30', 2.30,
    (select landed_unit_cost from purchase_invoice_lines where invoice_id = s1 and line_no = 1));
  perform assert_eq('تكلفة البنطلون النهائية 3.30', 3.30,
    (select landed_unit_cost from purchase_invoice_lines where invoice_id = s1 and line_no = 2));
  perform assert_eq('تكلفة الحقيبة النهائية 4.30', 4.30,
    (select landed_unit_cost from purchase_invoice_lines where invoice_id = s1 and line_no = 3));
  perform assert_eq('مجموع الموزع = المصاريف', 30,
    (select sum(amount) from purchase_invoice_line_allocations a
       join purchase_invoice_lines l on l.id = a.line_id where l.invoice_id = s1));

  -- الفاتورة: بضاعة 290 + مستحق للمورد الأساسي (نقل 5 + تأمين 2 + أخرى 1 = 8) = 298، المدفوع 100
  perform assert_eq('إجمالي مستحق المورد على الشحنة', 298, (select total from purchase_invoices where id = s1));
  perform assert_eq('ذمة المورد الأساسي', 198, supplier_balance(sup));
  perform assert_eq('ذمة شركة التخليص', 10 + 900, supplier_balance(car));
  perform assert_eq('البنك بعد دفع الشحن', 19988, treasury_balance(hq_bank));
  perform assert_eq('الصندوق بعد دفعة المورد', 4900, treasury_balance(hq_cash));
  perform assert_eq('مخزون الشركة الأم = بضاعة 290 + مصاريف 30', 320,
    (select sum(stock_value) from product_branch_stock where branch_id = hq));
  perform assert_eq('دفعة القميص تحمل رقم الشحنة', 1,
    (select count(*) from stock_layers where product_id = t1 and doc_no = 'SHP-1' and original_qty = 40));

  -- ================= 3) الشحنة الثانية: بالوزن + أساس مستقل لكل مصروف ==========
  --   شحن 20 بالوزن (10 كجم → 2 للكيلو): قميص 4، بنطلون 6، حقيبة 10
  --   تخليص 10 بالقطع (100 قطعة → 0.10): قميص 4، بنطلون 3، حقيبة 3
  insert into purchase_invoices (invoice_no, shipment_no, invoice_date, supplier_id, branch_id, alloc_method)
  values (next_document_number('purchase_invoice', hq, d), 'SHP-2', d, sup, hq, 'weight') returning id into s2;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost, weight_kg) values
    (s2, 1, t1, 40, 2, 2), (s2, 2, t2, 30, 3, 3), (s2, 3, t3, 30, 4, 5);
  insert into purchase_invoice_expenses (invoice_id, kind, description, amount) values
    (s2, 'freight', 'شحن', 20);
  insert into purchase_invoice_expenses (invoice_id, kind, description, amount, alloc_basis) values
    (s2, 'customs', 'تخليص', 10, 'qty');
  perform post_purchase_invoice(s2);

  perform assert_eq('تكلفة الكيلو من الشحنة الثانية = 30 ÷ 10', 3,
    (select per_kg_cost from report_shipments(d, d, hq) where invoice_id = s2));
  perform assert_eq('نصيب القميص 4 + 4', 8,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s2 and line_no = 1));
  perform assert_eq('نصيب البنطلون 6 + 3', 9,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s2 and line_no = 2));
  perform assert_eq('نصيب الحقيبة 10 + 3', 13,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s2 and line_no = 3));
  perform assert_eq('تكلفة القميص بعد الشحنة الثانية (88 ÷ 40)', 2.2,
    (select landed_unit_cost from purchase_invoice_lines where invoice_id = s2 and line_no = 1));
  perform assert_eq('تكلفة الحقيبة بعد الشحنة الثانية (133 ÷ 30)', 4.433333,
    (select landed_unit_cost from purchase_invoice_lines where invoice_id = s2 and line_no = 3), 0.000001);
  perform assert_eq('الشحنة الثانية لم تغيّر تكلفة الأولى', 2.30,
    (select landed_unit_cost from purchase_invoice_lines where invoice_id = s1 and line_no = 1));
  perform assert_eq('ذمة المورد بعد الشحنتين: 198 + (290 + 30)', 518, supplier_balance(sup));
  perform assert_eq('مخزون الشركة الأم بعد الشحنتين', 640,
    (select sum(stock_value) from product_branch_stock where branch_id = hq));

  perform assert_raises('منع التوزيع بالوزن بلا أوزان',
    $q$ do $x$ declare i uuid; begin
          insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, alloc_method)
          values ('NOWT-1', current_date, (select id from suppliers where code='SUP4'),
                  (select id from branches where code='HQ'), 'weight') returning id into i;
          insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
          values (i, 1, (select id from products where code='T1' and branch_id=(select id from branches where code='HQ')), 1, 1);
          insert into purchase_invoice_expenses (invoice_id, kind, amount) values (i, 'freight', 5);
          perform post_purchase_invoice(i);
        end $x$ $q$);

  -- ================= 4) شحنة لفرع + فرق التقريب بلا زيادة ولا نقص ===============
  insert into products (code, name_ar, branch_id) values ('R1','منتج 1', b3) returning id into r1;
  insert into products (code, name_ar, branch_id) values ('R2','منتج 2', b3) returning id into r2;
  insert into products (code, name_ar, branch_id) values ('R3','منتج 3', b3) returning id into r3;
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, alloc_method)
  values (next_document_number('purchase_invoice', b3, d), d, sup, b3, 'qty') returning id into s3;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost) values
    (s3, 1, r1, 1, 1), (s3, 2, r2, 1, 1), (s3, 3, r3, 1, 1);
  insert into purchase_invoice_expenses (invoice_id, kind, amount) values (s3, 'freight', 10);
  perform post_purchase_invoice(s3);
  perform assert_eq('مجموع الموزع 10 بالضبط رغم القسمة 3.3333', 10,
    (select sum(alloc_expense) from purchase_invoice_lines where invoice_id = s3));
  perform assert_eq('فرق التقريب على السطر الأول', 3.3334,
    (select alloc_expense from purchase_invoice_lines where invoice_id = s3 and line_no = 1));
  perform assert_eq('مخزون الفرع الثالث تكلفة 3 + 10 مصاريف + 40 افتتاحي', 53,
    (select sum(stock_value) from product_branch_stock where branch_id = b3));
  perform assert_raises('منتج الشركة الأم لا يُشترى لفرع',
    $q$ do $x$ declare i uuid; begin
          insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id)
          values ('WRONG-1', current_date, (select id from suppliers where code='SUP4'),
                  (select id from branches where code='B1')) returning id into i;
          insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
          values (i, 1, (select id from products where code='T1' and branch_id=(select id from branches where code='HQ')), 1, 1);
          perform post_purchase_invoice(i);
        end $x$ $q$);

  -- ========================= 5) FIFO في البيع ================================
  --   قميص: دفعة أ 40 @2.30 (92)، دفعة ب 40 @2.20 (88). بيع 50:
  --   40 × 2.30 + 10 × 2.20 = 114، المتبقي 30 @2.20 = 66
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', hq, d), d, hq, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, t1, 50, 5);
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  values (si, 'cash', hq_cash, 250);
  perform post_sales_invoice(si);

  perform assert_eq('تكلفة البضاعة المباعة FIFO', 114, (select cogs_total from sales_invoices where id = si));
  perform assert_eq('قيمة المخزون المتبقي', 66,
    (select stock_value from product_branch_stock where product_id = t1 and branch_id = hq));
  perform assert_eq('المتبقي من الدفعة الأقدم', 0,
    (select remaining_qty from stock_layers where product_id = t1 and doc_no = 'SHP-1' and original_qty = 40));
  perform assert_eq('المتبقي من الدفعة الثانية', 30,
    (select remaining_qty from stock_layers l join purchase_invoices i on i.id = l.doc_id
      where l.product_id = t1 and i.shipment_no = 'SHP-2'));
  perform assert_eq('تكلفة وحدة البيع في السطر', 2.28,
    (select cogs_unit_cost from sales_invoice_lines where invoice_id = si));

  -- الإلغاء يعيد الدفعات كما كانت
  perform cancel_sales_invoice(si, 'اختبار');
  perform assert_eq('بعد الإلغاء: قيمة القميص', 180,
    (select stock_value from product_branch_stock where product_id = t1 and branch_id = hq));
  perform assert_eq('بعد الإلغاء: الدفعة الأقدم 40', 40,
    (select remaining_qty from stock_layers where product_id = t1 and doc_no = 'SHP-1' and original_qty = 40));

  -- إعادة البيع
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', hq, d), d, hq, 'نقدي') returning id into si2;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si2, 1, t1, 50, 5);
  perform recalc_sales_invoice(si2);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  values (si2, 'cash', hq_cash, 250);
  perform post_sales_invoice(si2);
  perform assert_eq('التكلفة نفسها بعد إعادة البيع', 114, (select cogs_total from sales_invoices where id = si2));

  perform assert_raises('منع إلغاء شحنة استُهلك جزء من بضاعتها',
    format('select cancel_purchase_invoice(%L, %L)', s1, 'اختبار'));

  -- ========== 6) التحويل بين الشركة الأم والفرع: دفعات بتكاليفها الأصلية ========
  --   قميص 30 (من دفعة ب @2.20 = 66)، حقيبة 40 = 30 @4.30 (129) + 10 @4.4333 (44.3333)
  insert into stock_transfers (transfer_no, transfer_date, from_branch_id, to_branch_id)
  values (next_document_number('stock_transfer', hq, d), d, hq, b1) returning id into tr;
  insert into stock_transfer_lines (transfer_id, line_no, product_id, quantity) values
    (tr, 1, t1, 30), (tr, 2, t3, 40);
  perform post_stock_transfer(tr);

  select id into b1_shirt from products where branch_id = b1 and code = 'T1';
  select id into b1_bag   from products where branch_id = b1 and code = 'T3';
  perform assert_true('بطاقة القميص في الفرع الأول أُنشئت تلقائيًا', b1_shirt is not null and b1_shirt <> t1);
  perform assert_eq('الاسم نفسه والكود نفسه في الفرع', 1,
    (select count(*) from products where id = b1_shirt and name_ar = 'قميص' and code = 'T1'));
  perform assert_eq('تكلفة التحويل للقميص = 66', 66,
    (select total_cost from stock_transfer_lines where transfer_id = tr and line_no = 1));
  perform assert_eq('تكلفة تحويل الحقيبة = 173.3333', 173.3333,
    (select total_cost from stock_transfer_lines where transfer_id = tr and line_no = 2));
  perform assert_eq('مخزون القميص في الشركة الأم بعد التحويل', 0,
    (select quantity from product_branch_stock where product_id = t1 and branch_id = hq));
  perform assert_eq('الحقيبة في الشركة الأم: متبقي 20 بقيمة 88.6667', 88.6667,
    (select stock_value from product_branch_stock where product_id = t3 and branch_id = hq));
  perform assert_eq('دفعات الحقيبة في الفرع: دفعتان بتكلفتهما', 2,
    (select count(*) from stock_layers where product_id = b1_bag and branch_id = b1));
  perform assert_eq('تكلفة الدفعة الأولى محفوظة 4.30', 4.30,
    (select unit_cost from stock_layers where product_id = b1_bag and original_qty = 30));
  perform assert_eq('تكلفة الدفعة الثانية محفوظة 4.433333', 4.433333,
    (select unit_cost from stock_layers where product_id = b1_bag and original_qty = 10), 0.00001);
  perform assert_eq('التحويل لم يسجل أي إيراد ولا ربح', 0,
    (select coalesce(sum(jl.debit - jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id where je.doc_type = 'stock_transfer'));

  -- بيع من الفرع: قميص 5 + حقيبة 35 (FIFO داخل الفرع)
  --   قميص: 5 × 2.20 = 11 | حقيبة: 30 × 4.30 + 5 × 4.43333 = 129 + 22.1667
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price) values
    (si, 1, b1_shirt, 5, 6), (si, 2, b1_bag, 35, 9);
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b1_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);
  perform assert_eq('تكلفة مبيعات الفرع من دفعات التحويل', 162.1667,
    (select cogs_total from sales_invoices where id = si), 0.0002);
  perform assert_eq('منع بيع منتج الشركة الأم من الفرع', 1,
    (select count(*) from product_branch_stock where product_id = t1 and branch_id = hq and quantity = 0));

  -- ========================= 7) تبديل طريقة التقييم ===========================
  insert into products (code, name_ar, branch_id) values ('Z1','منتج التبديل', b3) returning id into z;
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id)
  values (next_document_number('purchase_invoice', b3, d), d, sup, b3) returning id into s3;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost) values (s3, 1, z, 10, 1);
  perform post_purchase_invoice(s3);
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id)
  values (next_document_number('purchase_invoice', b3, d), d, sup, b3) returning id into s3;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost) values (s3, 1, z, 10, 3);
  perform post_purchase_invoice(s3);

  perform set_valuation_method('wavg');
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b3, d), d, b3, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price) values (si, 1, z, 10, 5);
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', hq_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);
  perform assert_eq('المتوسط: 10 × ((10 + 30) ÷ 20)', 20, (select cogs_total from sales_invoices where id = si));

  perform set_valuation_method('fifo');
  perform assert_eq('بعد العودة لـ FIFO: قيمة الدفعات تطابق الدفتر', 20,
    (select sum(remaining_value) from stock_layers where product_id = z));
  perform assert_eq('الدفعات المتبقية 10 قطع', 10,
    (select sum(remaining_qty) from stock_layers where product_id = z));

  -- ======================= 8) المصاريف المدفوعة مقدمًا ========================
  --   إيجار سنة 2400 على 12 شهرًا في الفرع الثاني = 200 شهريًا
  select id into ex_type from expense_types where code = 'RENT';
  insert into prepaid_expenses (prepaid_no, name, branch_id, expense_type_id, pay_date, start_date, end_date,
                                months, total_amount, payment_mode, treasury_account_id)
  values ('PP-T1', 'إيجار سنوي', b2, ex_type, d, date_trunc('month', d)::date,
          (date_trunc('month', d) + interval '12 months - 1 day')::date, 12, 2400, 'cash', b2_cash)
  returning id into pp1;
  perform post_prepaid_expense(pp1);

  perform assert_eq('الدفع المقدم أصل متداول لا مصروف: مصاريف الفرع صفر', 0,
    (select direct_expenses from branch_pnl(date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month - 1 day')::date, b2)));
  perform assert_eq('رصيد المدفوع مقدمًا بعد الدفع', 2400,
    (select coalesce(sum(jl.debit - jl.credit), 0) from journal_lines jl
       join accounts a on a.id = jl.account_id where a.system_key = 'prepaid_expenses' and jl.branch_id = b2));
  perform assert_eq('القسط الشهري', 200, (select monthly_amount from prepaid_expenses where id = pp1));
  perform assert_eq('عدد أشهر الجدول', 12, (select count(*) from prepaid_schedule where prepaid_id = pp1));

  cnt := post_prepaid_amortization(y, m);
  perform assert_eq('تحميل الشهر الحالي: صف واحد', 1, cnt);
  perform assert_eq('مصروف الإيجار الشهري المحمَّل', 200, (select direct_expenses from branch_pnl(date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month - 1 day')::date, b2)));
  cnt := post_prepaid_amortization(y, m);
  perform assert_eq('منع تحميل الشهر نفسه مرتين', 0, cnt);
  perform assert_eq('المصروف لم يتكرر', 200, (select direct_expenses from branch_pnl(date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month - 1 day')::date, b2)));
  perform assert_eq('المتبقي من المصروف المدفوع مقدمًا', 2200,
    (select remaining_amount from report_prepaid(b2) where prepaid_id = pp1));

  -- 1000 على 3 أشهر: 333.3333 + 333.3333 + 333.3334 (الأخير يستوعب الفرق)
  select id into ex_type from expense_types where code = 'INS';
  insert into prepaid_expenses (prepaid_no, name, branch_id, expense_type_id, pay_date, start_date, end_date,
                                months, total_amount, payment_mode, treasury_account_id)
  values ('PP-T2', 'تأمين ربع سنوي', b2, ex_type, d, date_trunc('month', d)::date,
          (date_trunc('month', d) + interval '3 months - 1 day')::date, 3, 1000, 'cash', b2_cash)
  returning id into pp2;
  perform post_prepaid_expense(pp2);
  perform assert_eq('مجموع جدول القسط = 1000 بالضبط', 1000,
    (select sum(amount) from prepaid_schedule where prepaid_id = pp2));
  perform assert_eq('القسط الأخير يستوعب فرق التقريب', 333.3334,
    (select amount from prepaid_schedule where prepaid_id = pp2 order by period_year desc, period_month desc limit 1));

  -- ========================= 9) الإقفال الشهري ===============================
  -- تحميل القسط الأول للتأمين يتم تلقائيًا عند الإقفال
  perform close_period(y, m);
  perform assert_true('الفترة مقفلة', (select status = 'closed' from fiscal_periods where year = y and month = m));
  perform assert_eq('الإقفال حمّل قسط التأمين تلقائيًا', 1,
    (select count(*) from prepaid_schedule where prepaid_id = pp2 and status = 'posted'));
  perform assert_eq('مصاريف الفرع الثاني بعد الإقفال: 200 + 333.3333', 533.3333,
    (select total_expenses from period_snapshots where period_year = y and period_month = m and branch_id = b2), 0.0001);
  perform assert_eq('رصيد المدفوع مقدمًا في اللقطة: 2200 + 666.6667', 2866.6667,
    (select prepaid_balance from period_snapshots where period_year = y and period_month = m and branch_id = b2), 0.0001);
  perform assert_eq('اللقطة تشمل الجهات الأربع', 4,
    (select count(*) from period_snapshots where period_year = y and period_month = m));
  perform assert_eq('مخزون الفرع الأول في اللقطة', (select sum(stock_value) from product_branch_stock where branch_id = b1),
    (select inventory_value from period_snapshots where period_year = y and period_month = m and branch_id = b1), 0.001);
  perform assert_true('الشهر التالي فُتح تلقائيًا', exists (select 1 from fiscal_periods
    where (year, month) = (extract(year from d + interval '1 month')::int, extract(month from d + interval '1 month')::int)
      and status = 'open'));
  perform assert_raises('منع الترحيل في شهر مقفل',
    format('select post_prepaid_amortization(%s, %s)', y, m) || ' ; ' ||
    $q$ insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
        values ('CLOSED-1', current_date, (select id from branches where code='HQ'), 'x');
        select post_sales_invoice((select id from sales_invoices where invoice_no='CLOSED-1')) $q$);
  perform reopen_period(y, m);
  perform assert_eq('إعادة الفتح تحذف اللقطة', 0,
    (select count(*) from period_snapshots where period_year = y and period_month = m));

  -- ============================ 10) التقارير =================================
  select * into rec from report_shipments(d, d, hq) where invoice_id = s1;
  perform assert_eq('تقرير الشحنات: القطع', 100, rec.pieces);
  perform assert_eq('تقرير الشحنات: قيمة البضاعة', 290, rec.goods_value);
  perform assert_eq('تقرير الشحنات: الشحن', 12, rec.freight);
  perform assert_eq('تقرير الشحنات: التخليص', 10, rec.customs);
  perform assert_eq('تقرير الشحنات: إجمالي المصاريف', 30, rec.total_expenses);
  perform assert_eq('تقرير الشحنات: الإجمالي بعد المصاريف', 320, rec.landed_total);
  perform assert_eq('تقرير الشحنات: تكلفة القطعة من المصاريف', 0.3, rec.per_piece_cost);

  select * into rec from report_product_costs(hq) where product_code = 'T1';
  perform assert_eq('بطاقة القميص: السعر الأساسي', 2, rec.base_price);
  perform assert_eq('بطاقة القميص: المصاريف المحملة للقطعة', 0.2, rec.loaded_expense);
  perform assert_eq('بطاقة القميص: التكلفة النهائية', 2.2, rec.final_cost);
  perform assert_eq('بطاقة القميص: وزن آخر شحنة', 2, rec.last_weight_kg);
  perform assert_eq('بطاقة القميص: وزن القطعة (2 ÷ 40)', 0.05, rec.unit_weight_kg);
  perform assert_eq('بطاقة القميص: المباع (الفاتورة الملغاة لا تُحتسب)', 50, rec.qty_sold);

  perform assert_eq('تقرير الدفعات: دفعتان لحقيبة الفرع (كل الدفعات)', 2,
    (select count(*) from report_stock_layers(b1, b1_bag, false)));
  perform assert_eq('تقرير الدفعات المفتوحة: دفعة واحدة متبقيتها 5', 5,
    (select sum(remaining_qty) from report_stock_layers(b1, b1_bag, true)));
  perform assert_eq('المصاريف التشغيلية للفرع الثاني (إيجار)', 200,
    (select amount from report_operating_expenses(date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month - 1 day')::date, b2) where account_code = '5201'));
  perform assert_eq('تقرير التحويلات', 1, (select count(*) from report_transfers(d, d)));

  -- ======================= التقرير المجمّع =====================================
  perform assert_eq('المجمّع: صادر التحويلات الداخلية = وارده', 0,
    (select sum(transfers_out) - sum(transfers_in)
       from report_consolidated(date_trunc('month', d)::date, d)));
  perform assert_eq('المجمّع: ربح المجموعة = ملخص الشركة بعد إيراد الأم',
    (select profit_after_parent_revenue from report_company_summary(date_trunc('month', d)::date, d)),
    (select sum(net_profit) from report_consolidated(date_trunc('month', d)::date, d)), 0.001);
  perform assert_eq('المجمّع: التحويلات لا تظهر ضمن المبيعات الخارجية', 0,
    (select count(*) from report_consolidated(date_trunc('month', d)::date, d)
      where external_sales <> (select net_sales from branch_pnl(date_trunc('month', d)::date, d, branch_id))));

  -- ============================ 11) فحوص السلامة ==============================
  for rec in select * from system_integrity_check() loop
    perform assert_true('فحص: ' || rec.check_name, rec.is_ok);
  end loop;

  raise notice '===== اختبار الشحنات وFIFO والمدفوع مقدمًا: ناجح =====';
end;
$$;

rollback;
