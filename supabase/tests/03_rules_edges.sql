-- =============================================================================
-- اختبار 3: القواعد والحالات الحدّية — المتوسط المرجح، منع المخزون السالب،
--   منع الترحيل المزدوج، الفترة المقفلة، الحد الائتماني، المصروف المستحق،
--   الإلغاء، التحويل بين الصندوق والبنك، وإيراد الشركة الأم
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  d        date := current_date;
  hq uuid; b1 uuid; b2 uuid;
  sup uuid; cus uuid; pid uuid; pid2 uuid;
  hq_bank uuid; hq_cash uuid; b1_cash uuid; b2_cash uuid;
  pi uuid; si uuid; sr uuid; tt uuid; ex uuid; st uuid; pr uuid; col uuid; sp uuid;
  line uuid;
  v numeric; v2 numeric;
  before_profit numeric; after_profit numeric;
  r record;
begin
  select id into hq from branches where code='HQ';
  select id into b1 from branches where code='B1';
  select id into b2 from branches where code='B2';
  select id into hq_bank from treasury_accounts where code='BANK-HQ';
  select id into hq_cash from treasury_accounts where code='CASH-HQ';
  select id into b1_cash from treasury_accounts where code='CASH-B1';
  select id into b2_cash from treasury_accounts where code='CASH-B2';

  insert into suppliers (code, name) values ('SX','مورد') returning id into sup;
  insert into customers (code, name, branch_id, credit_limit)
  values ('CX','عميل محدود', b1, 100) returning id into cus;
  insert into products (code, name_ar, default_sale_price, default_unit_cost)
  values ('X1','منتج المتوسط', 30, 10) returning id into pid;

  -- ===================== 1) المتوسط المرجح المتحرك ==========================
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id)
  values (next_document_number('purchase_invoice', b1, d), d, sup, b1) returning id into pi;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  values (pi, 1, pid, 100, 10);
  insert into purchase_invoice_payments (invoice_id, method, treasury_account_id, amount)
  values (pi, 'cash', b1_cash, 1000);
  perform post_purchase_invoice(pi);
  perform assert_eq('المتوسط بعد الشراء الأول', 10,
    (select avg_cost from product_branch_stock where product_id=pid and branch_id=b1));

  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id)
  values (next_document_number('purchase_invoice', b1, d), d, sup, b1) returning id into pi;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  values (pi, 1, pid, 100, 20);
  perform post_purchase_invoice(pi);
  perform assert_eq('المتوسط بعد الشراء الثاني بسعر مختلف', 15,
    (select avg_cost from product_branch_stock where product_id=pid and branch_id=b1));

  -- البيع يُحمَّل بالمتوسط وقت الحركة
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 50, 30);
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b1_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);

  perform assert_eq('تكلفة البضاعة المباعة بالمتوسط', 750,
    (select cogs_total from sales_invoices where id = si));
  perform assert_eq('قيمة المخزون المتبقي', 2250,
    (select stock_value from product_branch_stock where product_id=pid and branch_id=b1));
  perform assert_eq('المتوسط لم يتغير بالبيع', 15,
    (select avg_cost from product_branch_stock where product_id=pid and branch_id=b1));

  -- ===================== 2) منع المخزون السالب ===============================
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 500, 30);
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b1_cash, total from sales_invoices where id = si;   -- مدفوعة نقدًا بالكامل
  perform assert_raises('منع البيع بكمية أكبر من الرصيد',
    format('select post_sales_invoice(%L)', si));
  delete from sales_invoices where id = si;

  -- ===================== 3) منع الترحيل المزدوج ==============================
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 1, 30);
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b1_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);
  perform assert_raises('منع ترحيل الفاتورة مرتين',
    format('select post_sales_invoice(%L)', si));

  -- ===================== 4) الإلغاء يعكس المخزون والقيد ======================
  select quantity into v from product_branch_stock where product_id=pid and branch_id=b1;
  perform cancel_sales_invoice(si, 'اختبار الإلغاء');
  select quantity into v2 from product_branch_stock where product_id=pid and branch_id=b1;
  perform assert_eq('الإلغاء يعيد الكمية للمخزون', v + 1, v2);
  perform assert_eq('الإلغاء يصفّي أثر القيد', 0,
    (select coalesce(sum(jl.debit - jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
      where je.doc_type='sales_invoice' and je.doc_id = si));

  -- ===================== 5) العميل النقدي لا تُفتح له ذمة ====================
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 1, 30);
  perform assert_raises('منع البيع الآجل لعميل نقدي',
    format('select post_sales_invoice(%L)', si));
  delete from sales_invoices where id = si;

  -- ===================== 6) الحد الائتماني ==================================
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_id)
  values (next_document_number('sales_invoice', b1, d), d, b1, cus) returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 10, 30);   -- 300 > الحد 100
  perform assert_raises('منع تجاوز الحد الائتماني',
    format('select post_sales_invoice(%L)', si));
  delete from sales_invoices where id = si;

  -- ===================== 7) منع إرجاع أكثر مما بيع ===========================
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 5, 30) returning id into line;
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b1_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);

  insert into sales_returns (return_no, return_date, branch_id, invoice_id, refund_mode, treasury_account_id)
  values (next_document_number('sales_return', b1, d), d, b1, si, 'cash', b1_cash) returning id into sr;
  insert into sales_return_lines (return_id, line_no, product_id, source_line_id, quantity, unit_price)
  values (sr, 1, pid, line, 9, 30);
  perform assert_raises('منع إرجاع كمية أكبر من المباعة',
    format('select post_sales_return(%L)', sr));
  delete from sales_returns where id = sr;

  -- ===================== 8) التحويل بين الصندوق والبنك =======================
  select treasury_balance(b1_cash) into v;
  insert into treasury_transfers (transfer_no, transfer_date, from_account_id, to_account_id, amount)
  values (next_document_number('treasury_transfer', b1, d), d, b1_cash, hq_bank, 200)
  returning id into tt;
  perform post_treasury_transfer(tt);

  perform assert_eq('الصندوق انخفض بقيمة التحويل', v - 200, treasury_balance(b1_cash));
  perform assert_eq('البنك ارتفع بالقيمة نفسها', 200, treasury_balance(hq_bank) -
    (select coalesce(sum(jl.debit - jl.credit),0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
      where jl.treasury_account_id = hq_bank and je.doc_type <> 'treasury_transfer'));
  perform assert_eq('التحويل لم ينشئ إيرادًا أو مصروفًا', 0,
    (select coalesce(sum(jl.debit - jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.doc_type='treasury_transfer' and a.type in ('revenue','expense')));
  perform assert_eq('صافي النقدية لم يتغير بالتحويل', 0,
    (select coalesce(sum(jl.debit - jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
      where je.doc_type='treasury_transfer'));

  -- ===================== 9) مصروف غير مدفوع = التزام مستحق ===================
  select treasury_balance(b1_cash) into v;
  insert into expenses (expense_no, expense_date, branch_id, expense_type_id, amount, payment_mode)
  select next_document_number('expense', b1, d), d, b1, et.id, 70, 'unpaid'
    from expense_types et where et.code='ELEC' returning id into ex;
  perform post_expense(ex);

  perform assert_eq('المصروف غير المدفوع لم يمس الصندوق', v, treasury_balance(b1_cash));
  perform assert_eq('المصروف غير المدفوع أنشأ التزامًا', 70,
    (select coalesce(sum(jl.credit - jl.debit),0) from journal_lines jl
       join accounts a on a.id = jl.account_id where a.system_key='accrued_expenses'));

  insert into expense_settlements (settlement_no, settlement_date, expense_id, treasury_account_id, amount)
  values (next_document_number('payment_voucher', b1, d), d, ex, b1_cash, 70) returning id into st;
  perform post_expense_settlement(st);

  perform assert_eq('السداد خفض الصندوق', v - 70, treasury_balance(b1_cash));
  perform assert_eq('السداد أقفل الالتزام', 0,
    (select coalesce(sum(jl.credit - jl.debit),0) from journal_lines jl
       join accounts a on a.id = jl.account_id where a.system_key='accrued_expenses'));
  perform assert_eq('المصروف لم يُسجَّل مرتين', 70,
    (select coalesce(sum(jl.debit - jl.credit),0) from journal_lines jl
       join accounts a on a.id = jl.account_id where a.code='5203'));

  -- ===================== 10) دفع المورد لا يُسجَّل مشتريات ===================
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id)
  values (next_document_number('purchase_invoice', b1, d), d, sup, b1) returning id into pi;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  values (pi, 1, pid, 10, 12);
  perform post_purchase_invoice(pi);           -- آجل بالكامل
  select supplier_balance(sup) into v;

  insert into supplier_payments (payment_no, payment_date, branch_id, supplier_id, method,
                                 treasury_account_id, amount)
  values (next_document_number('supplier_payment', b1, d), d, b1, sup, 'cash', b1_cash, 50)
  returning id into sp;
  insert into supplier_payment_allocations (payment_id, invoice_id, amount) values (sp, pi, 50);
  perform post_supplier_payment(sp);

  perform assert_eq('ذمة المورد انخفضت بالدفع', v - 50, supplier_balance(sup));
  perform assert_eq('الدفع لم يزد المخزون', 0,
    (select coalesce(sum(jl.debit - jl.credit),0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.doc_type='supplier_payment' and a.system_key='inventory'));

  -- ===================== 11) إيراد الشركة الأم منفصل =========================
  select profit_before_parent_revenue, profit_after_parent_revenue
    into before_profit, after_profit from report_company_summary(d, d);
  perform assert_eq('قبل التسجيل: الربحان متساويان', before_profit, after_profit);

  insert into parent_revenues (revenue_no, revenue_date, revenue_type_id, amount,
                               receipt_mode, treasury_account_id, description)
  select next_document_number('parent_revenue', hq, d), d, rt.id, 500, 'cash', hq_cash, 'إيراد خدمات'
    from revenue_types rt where rt.code='MAIN' returning id into pr;
  perform post_parent_revenue(pr);

  select profit_before_parent_revenue, profit_after_parent_revenue, parent_revenue
    into before_profit, after_profit, v from report_company_summary(d, d);
  perform assert_eq('إيراد الشركة الأم مسجل', 500, v);
  perform assert_eq('الفرق بين الربحين = إيراد الشركة الأم', 500, after_profit - before_profit);

  perform assert_eq('إيراد الشركة الأم لا يدخل مبيعات الفروع', 0,
    (select coalesce(sum(net_sales),0) from report_branch_financial(d, d, hq)));

  -- مبيعات الفروع لا تُحتسب إيرادًا للشركة الأم
  perform assert_eq('مبيعات الفروع ليست إيراد الشركة الأم', 500,
    (select coalesce(sum(jl.credit - jl.debit), 0) from journal_lines jl
       join accounts a on a.id = jl.account_id
       join branches b on b.id = jl.branch_id
      where b.kind='parent' and a.type='revenue'));

  -- ===================== 12) صافي مبيعات صفر لا يسبب خطأ قسمة ================
  select * into r from report_branch_financial(d, d, b2);
  perform assert_eq('هامش الربح عند غياب المبيعات = صفر', 0, r.margin_before);
  perform assert_eq('هامش الربح بعد المصاريف عند غياب المبيعات', 0, r.margin_after);

  -- ===================== 13) الفترة المقفلة ترفض الحركة ======================
  perform close_period(extract(year from d)::int, extract(month from d)::int);
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 1, 30);
  perform assert_raises('منع الترحيل في فترة مقفلة',
    format('select post_sales_invoice(%L)', si));

  perform assert_true('الشهر التالي فُتح تلقائيًا',
    exists (select 1 from fiscal_periods
             where year = extract(year from (d + interval '1 month'))::int
               and month = extract(month from (d + interval '1 month'))::int
               and status = 'open'));

  -- الأرصدة محفوظة بعد الإقفال (الدفتر متصل)
  perform assert_eq('رصيد الصندوق محفوظ بعد الإقفال', treasury_balance(b1_cash),
    treasury_balance(b1_cash, d + 40));

  perform reopen_period(extract(year from d)::int, extract(month from d)::int);
  delete from sales_invoices where id = si;

  -- ===================== 14) فحوص السلامة ====================================
  for r in select * from system_integrity_check() loop
    perform assert_true('فحص: ' || r.check_name, r.is_ok);
  end loop;

  raise notice '===== اختبار القواعد والحالات الحدّية: ناجح =====';
end;
$$;

rollback;
