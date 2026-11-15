-- =============================================================================
-- اختبار 2: تقارير أعلى 10 منتجات — بمنتجات كثيرة، وعمليات متكررة، وقيم
--   متساوية، ومرتجعات، ومنتجات ذات ربح سالب (شرط الملف صراحةً)
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  d        date := current_date;
  hq       uuid; b1 uuid; b2 uuid;
  sup      uuid;
  b1_cash  uuid; b2_cash uuid; hq_bank uuid;
  pid      uuid;
  pi       uuid; si uuid; tr uuid; sr uuid;
  i        int;
  n        int := 250;              -- 250 منتجًا لكل فرع كما يشترط الملف
  v_rows   int;
  v_dup    int;
  r        record;
  line     uuid;
  v_sales  numeric; v_report numeric;
begin
  select id into hq from branches where code='HQ';
  select id into b1 from branches where code='B1';
  select id into b2 from branches where code='B2';
  select id into hq_bank from treasury_accounts where code='BANK-HQ';
  select id into b1_cash from treasury_accounts where code='CASH-B1';
  select id into b2_cash from treasury_accounts where code='CASH-B2';
  insert into suppliers (code, name) values ('SB', 'مورد الجملة') returning id into sup;

  -- ------------------------- 250 منتجًا + شراء مركزي --------------------------
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, is_central)
  values (next_document_number('purchase_invoice', hq, d), d, sup, hq, true) returning id into pi;

  for i in 1..n loop
    insert into products (code, name_ar, default_sale_price, default_unit_cost)
    values (lpad(i::text, 4, '0'), 'منتج ' || i, 10 + (i % 7), 8 + (i % 5))
    returning id into pid;

    insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
    values (pi, i, pid, 1000, 8 + (i % 5));
  end loop;

  insert into purchase_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select pi, 'bank', hq_bank, sum(quantity * unit_cost) from purchase_invoice_lines where invoice_id = pi;
  perform post_purchase_invoice(pi);

  perform assert_eq('عدد المنتجات المشتراة', n,
    (select count(*) from purchase_invoice_lines where invoice_id = pi));

  -- --------------------- تحويل كل المنتجات إلى الفرعين ------------------------
  insert into stock_transfers (transfer_no, transfer_date, from_branch_id, to_branch_id)
  values (next_document_number('stock_transfer', hq, d), d, hq, b1) returning id into tr;
  insert into stock_transfer_lines (transfer_id, line_no, product_id, quantity)
  select tr, row_number() over (order by p.code), p.id, 400 from products p where p.branch_id = hq;
  perform post_stock_transfer(tr);

  insert into stock_transfers (transfer_no, transfer_date, from_branch_id, to_branch_id)
  values (next_document_number('stock_transfer', hq, d), d, hq, b2) returning id into tr;
  insert into stock_transfer_lines (transfer_id, line_no, product_id, quantity)
  select tr, row_number() over (order by p.code), p.id, 300 from products p where p.branch_id = hq;
  perform post_stock_transfer(tr);

  -- ------------------ مبيعات متكررة: كل منتج في عدة فواتير --------------------
  -- 5 فواتير × 250 سطرًا في الفرع الأول: نختبر التجميع وعدم تكرار المنتج
  for i in 1..5 loop
    insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
    values (next_document_number('sales_invoice', b1, d), d, b1, 'عميل نقدي') returning id into si;

    insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
    select si, row_number() over (order by p.code), p.id, 2, p.default_sale_price from products p where p.branch_id = b1;

    perform recalc_sales_invoice(si);
    insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
    select si, 'cash', b1_cash, total from sales_invoices where id = si;
    perform post_sales_invoice(si);
  end loop;

  -- فاتورة في الفرع الثاني: تختبر أن التقرير يتغير بتغير الفرع
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b2, d), d, b2, 'عميل نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  select si, row_number() over (order by p.code), p.id, 1, p.default_sale_price
    from products p where p.code::int <= 20 and p.branch_id = b2;
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b2_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);

  -- ------------------- منتج بربح سالب (بيع بأقل من التكلفة) -------------------
  select id into pid from products where code = '0007' and branch_id = b1;
  insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
  values (next_document_number('sales_invoice', b1, d), d, b1, 'عميل نقدي') returning id into si;
  insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
  values (si, 1, pid, 50, 1);          -- التكلفة ~10 والسعر 1 → خسارة
  perform recalc_sales_invoice(si);
  insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select si, 'cash', b1_cash, total from sales_invoices where id = si;
  perform post_sales_invoice(si);

  perform assert_true('منتج ذو ربح سالب يظهر بربح سالب',
    (select gross_profit < 0 from report_product_profitability(d, d, b1) where product_code = '0007'));

  -- ----------------------------- مرتجع مبيعات --------------------------------
  select id into pid from products where code = '0003' and branch_id = b1;
  insert into sales_returns (return_no, return_date, branch_id, refund_mode, treasury_account_id)
  values (next_document_number('sales_return', b1, d), d, b1, 'cash', b1_cash) returning id into sr;
  insert into sales_return_lines (return_id, line_no, product_id, quantity, unit_price)
  select sr, 1, pid, 4, p.default_sale_price from products p where p.id = pid;
  perform post_sales_return(sr);

  -- =========================== التحقق من التقرير =============================

  -- 1) لا تكرار للمنتج رغم تكرار الفواتير
  select count(*), count(*) - count(distinct product_id)
    into v_rows, v_dup
    from report_product_profitability(d, d, b1);
  perform assert_eq('لا تكرار للمنتجات في التقرير', 0, v_dup);

  -- 2) الترتيب الافتراضي حسب صافي المبيعات تنازليًا
  perform assert_true('أعلى 10 مبيعًا مرتبة تنازليًا حسب القيمة',
    (select bool_and(ok) from (
       select net_sales <= lag(net_sales) over (order by rank_no) as ok
         from report_top_products(d, d, b1, 'sales', 10)
     ) x where ok is not null));

  -- 3) الترتيب حسب الربح مختلف ومرتب تنازليًا حسب مجمل الربح
  perform assert_true('أعلى 10 ربحًا مرتبة تنازليًا حسب الربح',
    (select bool_and(ok) from (
       select gross_profit <= lag(gross_profit) over (order by rank_no) as ok
         from report_top_products(d, d, b1, 'profit', 10)
     ) x where ok is not null));

  -- 4) عدد النتائج 10 بالضبط
  perform assert_eq('عدد صفوف أعلى 10', 10, (select count(*) from report_top_products(d, d, b1, 'sales', 10)));

  -- 5) الترتيب ثابت عند تساوي القيم (كود المنتج يحسم)
  perform assert_true('تساوي القيم يُرتَّب بكود المنتج',
    (select bool_and(ok) from (
       select (net_sales < lag(net_sales) over (order by rank_no))
              or product_code > lag(product_code) over (order by rank_no) as ok
         from report_top_products(d, d, b1, 'sales', 50)
     ) x where ok is not null));

  -- 6) المنتجات بلا مبيعات مستبعدة افتراضيًا
  perform assert_eq('المنتجات بلا مبيعات مستبعدة', 0,
    (select count(*) from report_product_profitability(d, d, b2) where qty_sold = 0 and net_sales = 0));
  perform assert_true('يمكن إظهارها عند الطلب',
    (select count(*) > 20 from report_product_profitability(d, d, b2, true)));

  -- 7) نتائج الفرعين مختلفة
  perform assert_true('التقرير يتغير بتغير الفرع',
    (select count(*) from report_product_profitability(d, d, b1))
    <> (select count(*) from report_product_profitability(d, d, b2)));

  -- 8) التقرير يتغير بتغير الفترة
  perform assert_eq('فترة بلا حركة تعطي نتائج فارغة', 0,
    (select count(*) from report_product_profitability(d - 30, d - 20, b1)));

  -- 9) مجموع التقرير = تفاصيل الفواتير (عدم ازدواجية الاحتساب)
  select coalesce(sum(l.net_amount), 0) - coalesce((
           select sum(rl.net_amount) from sales_return_lines rl
             join sales_returns sret on sret.id = rl.return_id
            where sret.status='posted' and sret.branch_id = b1 and sret.return_date = d), 0)
    into v_sales
    from sales_invoice_lines l
    join sales_invoices inv on inv.id = l.invoice_id
   where inv.status = 'posted' and inv.branch_id = b1 and inv.invoice_date = d;

  select coalesce(sum(net_sales), 0) into v_report from report_product_profitability(d, d, b1, true);
  perform assert_eq('مجموع التقرير = مجموع تفاصيل الفواتير', v_sales, v_report);

  -- 10) صافي مبيعات التقرير = صافي مبيعات دفتر الأستاذ
  select net_sales into v_report from report_branch_financial(d, d, b1);
  perform assert_eq('تقرير المنتجات يطابق التقرير المالي', v_sales, v_report);

  -- 11) المرتجع مخصوم من الكمية والقيمة
  perform assert_eq('الكمية بعد خصم المرتجع', 10 - 4,
    (select qty_sold from report_product_profitability(d, d, b1) where product_code = '0003'));

  -- 12) مجموع أرباح المنتجات = مجمل ربح الفرع
  select sum(gross_profit) into v_report from report_product_profitability(d, d, b1, true);
  select gross_profit into v_sales from report_branch_financial(d, d, b1);
  perform assert_eq('مجموع أرباح المنتجات = مجمل ربح الفرع', v_sales, v_report, 0.01);

  -- 13) فحوص السلامة بعد الحمل الكبير
  for r in select * from system_integrity_check() loop
    perform assert_true('فحص: ' || r.check_name, r.is_ok);
  end loop;

  raise notice '===== اختبار أعلى 10 منتجات: ناجح (% منتج، % صف تقرير) =====', n, v_rows;
end;
$$;

rollback;
