-- =============================================================================
-- بيانات تجريبية واقعية لاختبار النظام قبل الاعتماد.
-- تُشغَّل مرة واحدة على قاعدة بيانات فارغة:  psql -d erp_dev -f scripts/seed-demo.sql
-- =============================================================================
\set ON_ERROR_STOP on
begin;

do $$
declare
  hq uuid; b1 uuid; b2 uuid; b3 uuid;
  hq_bank uuid; hq_cash uuid; b1_cash uuid; b2_cash uuid; b3_cash uuid;
  sup1 uuid; sup2 uuid;
  cus record; prod record;
  pi uuid; tr uuid; si uuid; sr uuid; col uuid; ex uuid; pr uuid;
  d0 date := date_trunc('month', current_date)::date;
  d date;
  i int; j int; k int;
  branch uuid; branch_cash uuid;
  qty_ numeric; price numeric;
  cust uuid;
  line uuid;
begin
  select id into hq from branches where code='HQ';
  select id into b1 from branches where code='B1';
  select id into b2 from branches where code='B2';
  select id into b3 from branches where code='B3';
  select id into hq_bank from treasury_accounts where code='BANK-HQ';
  select id into hq_cash from treasury_accounts where code='CASH-HQ';
  select id into b1_cash from treasury_accounts where code='CASH-B1';
  select id into b2_cash from treasury_accounts where code='CASH-B2';
  select id into b3_cash from treasury_accounts where code='CASH-B3';

  -- رصيد افتتاحي للصناديق
  update treasury_accounts set opening_balance = 150000, opening_date = d0 where id = hq_bank;
  perform post_treasury_opening(hq_bank);

  -- الموردون
  insert into suppliers (code, name, phone) values ('S0001','مؤسسة التوريد الحديثة','0790000001')
    returning id into sup1;
  insert into suppliers (code, name, phone) values ('S0002','شركة الغذاء الوطنية','0790000002')
    returning id into sup2;

  -- العملاء
  insert into customers (code, name, phone, branch_id, credit_limit) values
    ('C0001','مطعم البيت الدمشقي','0791111111', b1, 5000),
    ('C0002','سوبرماركت الواحة','0792222222', b2, 8000),
    ('C0003','كافتيريا الجامعة','0793333333', b3, 3000),
    ('C0004','فندق الأردن الكبير','0794444444', b1, 15000);

  -- المنتجات
  insert into products (code, name_ar, category_id, uom_id, default_sale_price, default_unit_cost, reorder_level)
  select lpad(g::text, 4, '0'),
         (array['أرز بسمتي','زيت ذرة','سكر ناعم','شاي أخضر','قهوة عربية','معكرونة','عدس أحمر',
                'حمص حب','فول مدمس','زيتون أخضر','لبنة','جبنة بيضاء','تونة معلبة','صلصة بندورة',
                'ملح طعام','فلفل أسود','كمون مطحون','طحين فاخر','نشا ذرة','خميرة فورية'])[((g - 1) % 20) + 1]
           || ' ' || (array['1كغ','2كغ','5كغ','500غ'])[((g - 1) % 4) + 1],
         (select id from product_categories limit 1),
         (select id from units_of_measure where code='PCS'),
         round((2 + (g % 9) * 0.75)::numeric, 3),
         round((1.2 + (g % 9) * 0.5)::numeric, 3),
         15
    from generate_series(1, 40) g;

  -- ------------------------- شراء مركزي للشركة الأم --------------------------
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, is_central, shipping_cost)
  values (next_document_number('purchase_invoice', hq, d0), d0, sup1, hq, true, 120)
  returning id into pi;

  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  select pi, row_number() over (order by p.code), p.id, 2500, p.default_unit_cost from products p;

  insert into purchase_invoice_payments (invoice_id, method, treasury_account_id, amount)
  select pi, 'bank', hq_bank, round(sum(quantity * unit_cost) * 0.4, 3)
    from purchase_invoice_lines where invoice_id = pi;
  perform post_purchase_invoice(pi);

  -- شراء ثانٍ بسعر مختلف لاختبار المتوسط المرجح
  insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, is_central)
  values (next_document_number('purchase_invoice', hq, d0 + 5), d0 + 5, sup2, hq, true)
  returning id into pi;
  insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity, unit_cost)
  select pi, row_number() over (order by p.code), p.id, 1200, round(p.default_unit_cost * 1.15, 6)
    from products p where p.code::int <= 20;
  perform post_purchase_invoice(pi);

  -- -------------------------- تحويل البضاعة للفروع ---------------------------
  foreach branch in array array[b1, b2, b3]
  loop
    insert into stock_transfers (transfer_no, transfer_date, from_branch_id, to_branch_id)
    values (next_document_number('stock_transfer', hq, d0 + 1), d0 + 1, hq, branch)
    returning id into tr;

    insert into stock_transfer_lines (transfer_id, line_no, product_id, quantity)
    select tr, row_number() over (order by p.code), p.id, 800 from products p;

    perform post_stock_transfer(tr);
  end loop;

  -- ------------------------------- المبيعات ----------------------------------
  for i in 0..24 loop
    d := d0 + i;
    exit when d > least(current_date, (d0 + interval '1 month - 1 day')::date);

    for j in 1..3 loop
      branch := (array[b1, b2, b3])[j];
      branch_cash := (array[b1_cash, b2_cash, b3_cash])[j];

      -- فاتورة نقدية
      insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_name)
      values (next_document_number('sales_invoice', branch, d), d, branch, 'عميل نقدي')
      returning id into si;

      insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price, discount)
      select si, row_number() over (order by p.code), p.id,
             6 + ((i + j + p.code::int) % 14),
             p.default_sale_price,
             case when (p.code::int + i) % 7 = 0 then 0.5 else 0 end
        from products p
       where (p.code::int + i * j) % 4 = 0;

      if exists (select 1 from sales_invoice_lines where invoice_id = si) then
        perform recalc_sales_invoice(si);
        insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
        select si, 'cash', branch_cash, inv.total from sales_invoices inv where inv.id = si;
        perform post_sales_invoice(si);
      else
        delete from sales_invoices where id = si;
      end if;

      -- فاتورة آجلة لعميل مسجّل كل ثلاثة أيام
      if i % 3 = 0 then
        select id into cust from customers where branch_id = branch limit 1;
        if cust is not null then
          insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_id)
          values (next_document_number('sales_invoice', branch, d), d, branch, cust)
          returning id into si;

          insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity, unit_price)
          select si, row_number() over (order by p.code), p.id, 12, p.default_sale_price
            from products p where (p.code::int + i) % 11 = 0;

          if exists (select 1 from sales_invoice_lines where invoice_id = si) then
            perform recalc_sales_invoice(si);
            -- دفعة جزئية نقدية والباقي ذمة
            insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
            select si, 'cash', branch_cash, round(inv.total * 0.3, 3) from sales_invoices inv where inv.id = si;
            perform post_sales_invoice(si);
          else
            delete from sales_invoices where id = si;
          end if;
        end if;
      end if;
    end loop;
  end loop;

  -- ------------------------------- مرتجع مبيعات -------------------------------
  select i.id, i.branch_id into si, branch
    from sales_invoices i where i.status='posted' and i.customer_id is not null limit 1;
  if si is not null then
    select l.id into line from sales_invoice_lines l where l.invoice_id = si limit 1;

    insert into sales_returns (return_no, return_date, branch_id, invoice_id, refund_mode, customer_id)
    select next_document_number('sales_return', branch, current_date), current_date, branch, si,
           'credit', i.customer_id from sales_invoices i where i.id = si
    returning id into sr;

    insert into sales_return_lines (return_id, line_no, product_id, source_line_id, quantity, unit_price)
    select sr, 1, l.product_id, l.id, 1, l.unit_price
      from sales_invoice_lines l where l.id = line;
    perform post_sales_return(sr);
  end if;

  -- -------------------------------- التحصيلات ---------------------------------
  for cus in select c.id, c.branch_id, customer_balance(c.id) as bal from customers c
             where customer_balance(c.id) > 0
  loop
    select t.id into branch_cash from treasury_accounts t
     where t.branch_id = coalesce(cus.branch_id, b1) and t.kind='cash' limit 1;

    insert into collections (collection_no, collection_date, branch_id, customer_id, method,
                             treasury_account_id, amount)
    values (next_document_number('collection', coalesce(cus.branch_id, b1), current_date),
            current_date, coalesce(cus.branch_id, b1), cus.id, 'cash', branch_cash,
            round(cus.bal * 0.5, 3))
    returning id into col;
    perform post_collection(col);
  end loop;

  -- --------------------------------- المصاريف ---------------------------------
  for j in 1..3 loop
    branch := (array[b1, b2, b3])[j];
    branch_cash := (array[b1_cash, b2_cash, b3_cash])[j];

    for k in 1..4 loop
      insert into expenses (expense_no, expense_date, branch_id, expense_type_id, description,
                            amount, payment_mode, treasury_account_id)
      select next_document_number('expense', branch, d0 + k * 3), d0 + k * 3, branch, et.id,
             et.name_ar || ' — ' || to_char(d0, 'MM/YYYY'),
             (array[350, 120, 80, 60])[k], 'cash', branch_cash
        from expense_types et
       where et.code = (array['RENT','ELEC','COMM','MAINT'])[k]
      returning id into ex;
      perform post_expense(ex);
    end loop;
  end loop;

  -- مصاريف إدارية قابلة للتوزيع
  for k in 1..3 loop
    insert into expenses (expense_no, expense_date, branch_id, expense_type_id, description,
                          amount, payment_mode, treasury_account_id, is_admin, is_allocatable)
    select next_document_number('expense', hq, d0 + k * 5), d0 + k * 5, hq, et.id,
           et.name_ar, (array[900, 450, 300])[k], 'bank', hq_bank, true, true
      from expense_types et where et.code = (array['ADMSAL','ADMRNT','ADMOFF'])[k]
    returning id into ex;
    perform post_expense(ex);
  end loop;

  -- مصروف إداري غير قابل للتوزيع
  insert into expenses (expense_no, expense_date, branch_id, expense_type_id, description,
                        amount, payment_mode, treasury_account_id, is_admin, is_allocatable)
  select next_document_number('expense', hq, d0 + 7), d0 + 7, hq, et.id,
         'مصاريف خاصة بنشاط الشركة الأم', 200, 'bank', hq_bank, true, false
    from expense_types et where et.code = 'ADMOTH'
  returning id into ex;
  perform post_expense(ex);

  -- ---------------------------- إيراد الشركة الأم ------------------------------
  insert into parent_revenues (revenue_no, revenue_date, revenue_type_id, description, amount,
                               receipt_mode, treasury_account_id)
  select next_document_number('parent_revenue', hq, d0 + 10), d0 + 10, rt.id,
         'عمولات وخدمات توريد', 1800, 'bank', hq_bank
    from revenue_types rt where rt.code = 'MAIN'
  returning id into pr;
  perform post_parent_revenue(pr);

  -- -------------------------- تحويل بين الصندوق والبنك -------------------------
  insert into treasury_transfers (transfer_no, transfer_date, from_account_id, to_account_id, amount)
  values (next_document_number('treasury_transfer', null, current_date), current_date,
          b1_cash, hq_bank, 500)
  returning id into tr;
  perform post_treasury_transfer(tr);

  raise notice 'تم إنشاء البيانات التجريبية';
end;
$$;

commit;

-- تقرير سريع بعد التحميل
select check_name, expected, actual, is_ok from system_integrity_check();
