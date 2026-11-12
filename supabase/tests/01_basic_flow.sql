-- =============================================================================
-- اختبار 1: دورة كاملة بأرقام محسوبة يدويًا
--   شراء مركزي → تحويل لفرع → بيع نقدي وآجل → مرتجع → تحصيل → مصاريف → توزيع
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  d           date := current_date;
  hq          uuid; b1 uuid; b2 uuid; b3 uuid;
  p1          uuid; p2 uuid;
  sup         uuid; cus uuid;
  hq_bank     uuid; hq_cash uuid; b1_cash uuid;
  pi1         uuid; pi2 uuid; tr uuid; si1 uuid; si2 uuid; sr uuid; col uuid;
  ex1         uuid; ex_admin uuid;
  line        uuid;
  v           numeric;
  r           record;
begin
  select id into hq from branches where code = 'HQ';
  select id into b1 from branches where code = 'B1';
  select id into b2 from branches where code = 'B2';
  select id into b3 from branches where code = 'B3';
  select id into hq_bank from treasury_accounts where code = 'BANK-HQ';
  select id into hq_cash from treasury_accounts where code = 'CASH-HQ';
  select id into b1_cash from treasury_accounts where code = 'CASH-B1';

  -- ------------------------------ بيانات أساسية ------------------------------
  insert into products (code, name_ar, default_sale_price, default_unit_cost, reorder_level)
  values ('P1', 'منتج تجريبي 1', 15, 10, 5) returning id into p1;
  insert into products (code, name_ar, default_sale_price, default_unit_cost)
  values ('P2', 'منتج تجريبي 2', 30, 20) returning id into p2;

  insert into suppliers (code, name) values ('S1', 'مورد تجريبي') returning id into sup;
  insert into customers (code, name, branch_id, credit_limit)
  values ('C1', 'عميل تجريبي', b1, 10000) returning id into cus;

  -- ---------------------- 1) شراء مركزي نقدي 100 × 10 -------------------------
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, is_central)
  values (next_document_number('purchase_invoice', hq, d), d, sup, hq, true) returning id into pi1;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  values (pi1, 1, p1, 100, 10);
  insert into purchase_invoice_payments (invoice_id, method, treasury_account_id, amount)
  values (pi1, 'bank', hq_bank, 1000);
  perform post_purchase_invoice(pi1);

  perform assert_eq('مخزون الشركة الأم من P1 بعد الشراء', 100,
    (select quantity from product_branch_stock where product_id = p1 and branch_id = hq));
  perform assert_eq('تكلفة P1 المتوسطة', 10,
    (select avg_cost from product_branch_stock where product_id = p1 and branch_id = hq));

  -- ---------------------- 2) شراء مركزي آجل 50 × 20 ---------------------------
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, is_central)
  values (next_document_number('purchase_invoice', hq, d), d, sup, hq, true) returning id into pi2;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  values (pi2, 1, p2, 50, 20);
  perform post_purchase_invoice(pi2);

  perform assert_eq('ذمة المورد بعد الشراء الآجل', 1000, supplier_balance(sup));

  -- ---------------------- 3) تحويل 50 وحدة من P1 إلى الفرع الأول --------------
  insert into stock_transfers (transfer_no, transfer_date, from_branch_id, to_branch_id)
  values (next_document_number('stock_transfer', hq, d), d, hq, b1) returning id into tr;
  insert into stock_transfer_lines (transfer_id, line_no, product_id, quantity)
  values (tr, 1, p1, 50);
  perform post_stock_transfer(tr);

  perform assert_eq('مخزون الشركة الأم بعد التحويل', 50,
    (select quantity from product_branch_stock where product_id = p1 and branch_id = hq));
  perform assert_eq('مخزون الفرع الأول بعد التحويل', 50,
    (select quantity from product_branch_stock where product_id = p1 and branch_id = b1));
  perform assert_eq('تكلفة الوحدة في الفرع = تكلفة المصدر', 10,
    (select avg_cost from product_branch_stock where product_id = p1 and branch_id = b1));

  -- التحويل ليس إيرادًا ولا مصروفًا
  perform assert_eq('التحويل لم يسجل أي إيراد', 0,
    (select coalesce(sum(jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.doc_type = 'stock_transfer' and a.type = 'revenue'));
  perform assert_eq('صافي أثر التحويل على الشركة = صفر', 0,
    (select coalesce(sum(jl.debit - jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
      where je.doc_type = 'stock_transfer'));

  -- ---------------------- 4) بيع نقدي 30 × 15 من الفرع الأول ------------------
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'عميل نقدي') returning id into si1;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si1, 1, p1, 30, 15);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  values (si1, 'cash', b1_cash, 450);
  perform post_sales_invoice(si1);

  perform assert_eq('تكلفة البضاعة المباعة للفاتورة النقدية', 300,
    (select cogs_total from sales_invoices where id = si1));
  perform assert_eq('رصيد صندوق الفرع بعد البيع النقدي', 450, treasury_balance(b1_cash));

  -- ---------------------- 5) بيع آجل 10 × 15 للعميل ---------------------------
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_id)
  values (next_document_number('sales_invoice', b1, d), d, b1, cus) returning id into si2;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si2, 1, p1, 10, 15) returning id into line;
  perform post_sales_invoice(si2);

  perform assert_eq('ذمة العميل بعد البيع الآجل', 150, customer_balance(cus));
  perform assert_eq('الصندوق لم يتأثر بالفاتورة الآجلة', 450, treasury_balance(b1_cash));

  -- ---------------------- 6) مرتجع مبيعات وحدتين ------------------------------
  insert into sales_returns (return_no, return_date, branch_id, customer_id, invoice_id, refund_mode)
  values (next_document_number('sales_return', b1, d), d, b1, cus, si2, 'credit') returning id into sr;
  insert into sales_return_lines (return_id, line_no, product_id, source_line_id, quantity, unit_price)
  values (sr, 1, p1, line, 2, 15);
  perform post_sales_return(sr);

  perform assert_eq('ذمة العميل بعد المرتجع', 120, customer_balance(cus));
  perform assert_eq('المخزون بعد المرتجع', 12,
    (select quantity from product_branch_stock where product_id = p1 and branch_id = b1));

  -- ---------------------- 7) تحصيل 100 نقدًا ----------------------------------
  insert into collections (collection_no, collection_date, branch_id, customer_id, method,
                           treasury_account_id, amount)
  values (next_document_number('collection', b1, d), d, b1, cus, 'cash', b1_cash, 100)
  returning id into col;
  insert into collection_allocations (collection_id, invoice_id, amount) values (col, si2, 100);
  perform post_collection(col);

  perform assert_eq('ذمة العميل بعد التحصيل', 20, customer_balance(cus));
  perform assert_eq('الصندوق بعد التحصيل', 550, treasury_balance(b1_cash));
  perform assert_eq('التحصيل لم يُسجَّل إيرادًا', 0,
    (select coalesce(sum(jl.credit), 0) from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.doc_type = 'collection' and a.type = 'revenue'));

  -- ---------------------- 8) مصروف تشغيلي للفرع 50 ----------------------------
  insert into expenses (expense_no, expense_date, branch_id, expense_type_id, amount,
                        payment_mode, treasury_account_id, description)
  select next_document_number('expense', b1, d), d, b1, et.id, 50, 'cash', b1_cash, 'إيجار الفرع'
    from expense_types et where et.code = 'RENT' returning id into ex1;
  perform post_expense(ex1);

  perform assert_eq('الصندوق بعد المصروف', 500, treasury_balance(b1_cash));

  -- ---------------------- 9) مصروف إداري قابل للتوزيع 90 ----------------------
  insert into expenses (expense_no, expense_date, branch_id, expense_type_id, amount,
                        payment_mode, treasury_account_id, is_admin, is_allocatable, description)
  select next_document_number('expense', hq, d), d, hq, et.id, 90, 'cash', hq_cash, true, true,
         'مصاريف إدارية عامة'
    from expense_types et where et.code = 'ADMOFF' returning id into ex_admin;
  perform post_expense(ex_admin);

  perform assert_eq('نصيب كل فرع من المصاريف الإدارية', 30,
    (select allocated_amount from admin_expense_allocation(d, d) where branch_id = b1));
  perform assert_eq('مجموع التوزيع = المصروف الإداري', 90,
    (select sum(allocated_amount) from admin_expense_allocation(d, d)));

  -- ---------------------- 10) التقرير المالي للفرع الأول ----------------------
  select * into r from report_branch_financial(d, d, b1);

  perform assert_eq('إجمالي المبيعات',            600, r.gross_sales);
  perform assert_eq('مرتجعات المبيعات',            30, r.sales_returns);
  perform assert_eq('صافي المبيعات',              570, r.net_sales);
  perform assert_eq('تكلفة البضاعة المباعة',      380, r.cogs);
  perform assert_eq('مجمل الربح',                 190, r.gross_profit);
  perform assert_eq('هامش الربح قبل المصاريف',  33.3333, round(r.margin_before, 4), 0.001);
  perform assert_eq('المصاريف التشغيلية المباشرة', 50, r.direct_expenses);
  perform assert_eq('نصيب الفرع من المصاريف الإدارية', 30, r.admin_share);
  perform assert_eq('إجمالي المصاريف المحملة',     80, r.total_expenses);
  perform assert_eq('صافي الربح بعد المصاريف',    110, r.net_profit);
  perform assert_eq('هامش الربح بعد المصاريف', 19.2982, round(r.margin_after, 4), 0.001);
  perform assert_eq('إجمالي التحصيلات',           100, r.collections);
  perform assert_eq('الذمم المدينة',               20, r.receivables);
  perform assert_eq('قيمة المخزون في الفرع',      120, r.inventory_value);
  perform assert_eq('رصيد الصندوق',               500, r.cash_balance);

  -- ---------------------- 11) ملخص الشركة -------------------------------------
  select * into r from report_company_summary(d, d);
  perform assert_eq('أرباح الفروع مجتمعة', 110 - 60, r.branches_net_profit);  -- فرعان بلا نشاط يتحملان 30 لكل منهما
  perform assert_eq('المصاريف الإدارية الكلية', 90, r.admin_expenses_total);
  perform assert_eq('الموزع على الفروع',        90, r.admin_allocated_to_branches);
  perform assert_eq('مصاريف الشركة الأم غير الموزعة', 0, r.parent_unallocated_expenses);
  perform assert_eq('إيراد الشركة الأم',         0, r.parent_revenue);

  -- ---------------------- 12) مخزون الشركة ككل --------------------------------
  perform assert_eq('قيمة مخزون الشركة الأم', 1500,
    (select sum(stock_value) from product_branch_stock where branch_id = hq));
  perform assert_eq('قيمة مخزون الشركة كاملة', 1620,
    (select sum(stock_value) from product_branch_stock));

  -- ---------------------- 13) فحوص السلامة ------------------------------------
  for r in select * from system_integrity_check() loop
    perform assert_true('فحص: ' || r.check_name, r.is_ok);
  end loop;

  raise notice '===== اختبار الدورة الأساسية: ناجح =====';
end;
$$;

rollback;
