-- =============================================================================
-- 0011_security.sql — حماية البيانات على مستوى قاعدة البيانات (RLS)
--   دفتر الأستاذ وحركات المخزون لا تُكتب مباشرة من التطبيق إطلاقًا، بل عبر
--   دوال الترحيل وحدها، فلا يمكن تزوير رصيد أو تكرار حركة من الواجهة.
-- =============================================================================

alter function post_journal(date, uuid, doc_type, uuid, text, jsonb, boolean, uuid)
  security definer set search_path = public;
alter function reverse_journal(doc_type, uuid, date, text, uuid)
  security definer set search_path = public;
alter function stock_in(date, uuid, uuid, numeric, numeric, doc_type, uuid, uuid, text, text, uuid, numeric)
  security definer set search_path = public;
alter function stock_out(date, uuid, uuid, numeric, doc_type, uuid, uuid, text, text, uuid, numeric)
  security definer set search_path = public;
alter function stock_reverse_document(doc_type, uuid, date, uuid)
  security definer set search_path = public;
alter function next_document_number(doc_type, uuid, date)
  security definer set search_path = public;

-- تفعيل RLS على كل الجداول
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename not like 'pg_%'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- --------------------------- سياسات القراءة -----------------------------------
-- جداول مرجعية: القراءة لكل مستخدم فعّال
do $$
declare t text;
begin
  foreach t in array array[
    'branches','settings','accounts','units_of_measure','product_categories',
    'expense_types','revenue_types','document_kinds','roles','permissions',
    'role_permissions','fiscal_periods','admin_allocation_shares','document_sequences'
  ]
  loop
    execute format($f$
      create policy %I_read on public.%I for select
        using (current_app_user_id() is not null)
    $f$, t, t);
  end loop;
end;
$$;

-- جداول العمليات: القراءة حسب صلاحية الوحدة والوصول إلى الفرع
create policy products_read   on products   for select using (has_permission('products.view'));
create policy stock_read      on product_branch_stock for select
  using (has_permission('inventory.view') and can_access_branch(branch_id));
create policy customers_read  on customers  for select using (has_permission('parties.view'));
create policy suppliers_read  on suppliers  for select using (has_permission('parties.view'));
create policy treasury_read   on treasury_accounts for select
  using (has_permission('treasury.view') and can_access_branch(branch_id));
create policy attachments_read on attachments for select using (current_app_user_id() is not null);

create policy sales_inv_read   on sales_invoices for select
  using (has_permission('sales.view') and can_access_branch(branch_id));
create policy sales_line_read  on sales_invoice_lines for select
  using (exists (select 1 from sales_invoices i where i.id = invoice_id
                  and has_permission('sales.view') and can_access_branch(i.branch_id)));
create policy sales_pay_read   on sales_invoice_payments for select
  using (exists (select 1 from sales_invoices i where i.id = invoice_id
                  and has_permission('sales.view') and can_access_branch(i.branch_id)));
create policy sales_ret_read   on sales_returns for select
  using (has_permission('sales.view') and can_access_branch(branch_id));
create policy sales_ret_line_read on sales_return_lines for select
  using (exists (select 1 from sales_returns r where r.id = return_id
                  and has_permission('sales.view') and can_access_branch(r.branch_id)));

create policy pur_inv_read     on purchase_invoices for select
  using (has_permission('purchases.view') and can_access_branch(branch_id));
create policy pur_line_read    on purchase_invoice_lines for select
  using (exists (select 1 from purchase_invoices i where i.id = invoice_id
                  and has_permission('purchases.view') and can_access_branch(i.branch_id)));
create policy pur_pay_read     on purchase_invoice_payments for select
  using (exists (select 1 from purchase_invoices i where i.id = invoice_id
                  and has_permission('purchases.view') and can_access_branch(i.branch_id)));
create policy pur_ret_read     on purchase_returns for select
  using (has_permission('purchases.view') and can_access_branch(branch_id));
create policy pur_ret_line_read on purchase_return_lines for select
  using (exists (select 1 from purchase_returns r where r.id = return_id
                  and has_permission('purchases.view') and can_access_branch(r.branch_id)));

create policy transfer_read    on stock_transfers for select
  using (has_permission('inventory.view')
         and (can_access_branch(from_branch_id) or can_access_branch(to_branch_id)));
create policy transfer_line_read on stock_transfer_lines for select
  using (exists (select 1 from stock_transfers t where t.id = transfer_id
                  and has_permission('inventory.view')
                  and (can_access_branch(t.from_branch_id) or can_access_branch(t.to_branch_id))));
create policy adj_read         on stock_adjustments for select
  using (has_permission('inventory.view') and can_access_branch(branch_id));
create policy adj_line_read    on stock_adjustment_lines for select
  using (exists (select 1 from stock_adjustments a where a.id = adjustment_id
                  and has_permission('inventory.view') and can_access_branch(a.branch_id)));
create policy stock_move_read  on stock_movements for select
  using (has_permission('inventory.view') and can_access_branch(branch_id));

create policy coll_read        on collections for select
  using (has_permission('treasury.view') and can_access_branch(branch_id));
create policy coll_alloc_read  on collection_allocations for select
  using (exists (select 1 from collections c where c.id = collection_id
                  and has_permission('treasury.view') and can_access_branch(c.branch_id)));
create policy sup_pay_read     on supplier_payments for select
  using (has_permission('treasury.view') and can_access_branch(branch_id));
create policy sup_pay_alloc_read on supplier_payment_allocations for select
  using (exists (select 1 from supplier_payments p where p.id = payment_id
                  and has_permission('treasury.view') and can_access_branch(p.branch_id)));
create policy tr_transfer_read on treasury_transfers for select using (has_permission('treasury.view'));
create policy vouchers_read    on vouchers for select
  using (has_permission('treasury.view') and can_access_branch(branch_id));
create policy bank_rec_read    on bank_reconciliations for select using (has_permission('treasury.view'));
create policy bank_rec_line_read on bank_reconciliation_lines for select using (has_permission('treasury.view'));

create policy expenses_read    on expenses for select
  using (has_permission('expenses.view') and can_access_branch(branch_id));
create policy exp_settle_read  on expense_settlements for select using (has_permission('expenses.view'));
create policy parent_rev_read  on parent_revenues for select using (has_permission('reports.view'));

create policy journal_read     on journal_entries for select using (has_permission('reports.view'));
create policy journal_line_read on journal_lines for select using (has_permission('reports.view'));
create policy audit_read       on audit_logs for select using (has_permission('audit.view'));
create policy backup_read      on backup_log for select using (has_permission('backup.run'));

create policy app_users_read   on app_users for select
  using (has_permission('users.view') or id = current_uid() or auth_user_id = current_uid());
create policy user_roles_read  on user_roles for select using (has_permission('users.view'));
create policy user_branches_read on user_branches for select
  using (has_permission('users.view') or user_id = current_app_user_id());

-- --------------------------- سياسات الكتابة -----------------------------------
-- دفتر الأستاذ وحركات المخزون: لا كتابة مباشرة إطلاقًا (الدوال فقط)

create policy products_write   on products for all
  using (has_permission('products.edit')) with check (has_permission('products.create'));
create policy categories_write on product_categories for all
  using (has_permission('products.edit')) with check (has_permission('products.edit'));
create policy uom_write        on units_of_measure for all
  using (has_permission('products.edit')) with check (has_permission('products.edit'));
create policy customers_write  on customers for all
  using (has_permission('parties.edit')) with check (has_permission('parties.create'));
create policy suppliers_write  on suppliers for all
  using (has_permission('parties.edit')) with check (has_permission('parties.create'));
create policy treasury_write   on treasury_accounts for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy attachments_write on attachments for all
  using (current_app_user_id() is not null) with check (current_app_user_id() is not null);

-- المستندات: الإنشاء والتعديل مسموح على المسودات فقط؛ الترحيل يتم عبر الدوال
create policy sales_inv_write on sales_invoices for all
  using (has_permission('sales.edit') and can_access_branch(branch_id))
  with check (has_permission('sales.create') and can_access_branch(branch_id));
create policy sales_line_write on sales_invoice_lines for all
  using (exists (select 1 from sales_invoices i where i.id = invoice_id
                  and i.status = 'draft' and has_permission('sales.edit')
                  and can_access_branch(i.branch_id)))
  with check (exists (select 1 from sales_invoices i where i.id = invoice_id
                  and i.status = 'draft' and has_permission('sales.create')
                  and can_access_branch(i.branch_id)));
create policy sales_pay_write on sales_invoice_payments for all
  using (exists (select 1 from sales_invoices i where i.id = invoice_id
                  and i.status = 'draft' and has_permission('sales.edit')))
  with check (exists (select 1 from sales_invoices i where i.id = invoice_id
                  and i.status = 'draft' and has_permission('sales.create')));
create policy sales_ret_write on sales_returns for all
  using (has_permission('sales.edit') and can_access_branch(branch_id))
  with check (has_permission('sales.create') and can_access_branch(branch_id));
create policy sales_ret_line_write on sales_return_lines for all
  using (exists (select 1 from sales_returns r where r.id = return_id and r.status='draft'
                  and has_permission('sales.edit')))
  with check (exists (select 1 from sales_returns r where r.id = return_id and r.status='draft'
                  and has_permission('sales.create')));

create policy pur_inv_write on purchase_invoices for all
  using (has_permission('purchases.edit') and can_access_branch(branch_id))
  with check (has_permission('purchases.create') and can_access_branch(branch_id));
create policy pur_line_write on purchase_invoice_lines for all
  using (exists (select 1 from purchase_invoices i where i.id = invoice_id and i.status='draft'
                  and has_permission('purchases.edit')))
  with check (exists (select 1 from purchase_invoices i where i.id = invoice_id and i.status='draft'
                  and has_permission('purchases.create')));
create policy pur_pay_write on purchase_invoice_payments for all
  using (exists (select 1 from purchase_invoices i where i.id = invoice_id and i.status='draft'
                  and has_permission('purchases.edit')))
  with check (exists (select 1 from purchase_invoices i where i.id = invoice_id and i.status='draft'
                  and has_permission('purchases.create')));
create policy pur_ret_write on purchase_returns for all
  using (has_permission('purchases.edit') and can_access_branch(branch_id))
  with check (has_permission('purchases.create') and can_access_branch(branch_id));
create policy pur_ret_line_write on purchase_return_lines for all
  using (exists (select 1 from purchase_returns r where r.id = return_id and r.status='draft'
                  and has_permission('purchases.edit')))
  with check (exists (select 1 from purchase_returns r where r.id = return_id and r.status='draft'
                  and has_permission('purchases.create')));

create policy transfer_write on stock_transfers for all
  using (has_permission('inventory.edit') and can_access_branch(from_branch_id))
  with check (has_permission('inventory.create') and can_access_branch(from_branch_id));
create policy transfer_line_write on stock_transfer_lines for all
  using (exists (select 1 from stock_transfers t where t.id = transfer_id and t.status='draft'
                  and has_permission('inventory.edit')))
  with check (exists (select 1 from stock_transfers t where t.id = transfer_id and t.status='draft'
                  and has_permission('inventory.create')));
create policy adj_write on stock_adjustments for all
  using (has_permission('inventory.edit') and can_access_branch(branch_id))
  with check (has_permission('inventory.create') and can_access_branch(branch_id));
create policy adj_line_write on stock_adjustment_lines for all
  using (exists (select 1 from stock_adjustments a where a.id = adjustment_id and a.status='draft'
                  and has_permission('inventory.edit')))
  with check (exists (select 1 from stock_adjustments a where a.id = adjustment_id and a.status='draft'
                  and has_permission('inventory.create')));

create policy coll_write on collections for all
  using (has_permission('treasury.edit') and can_access_branch(branch_id))
  with check (has_permission('treasury.create') and can_access_branch(branch_id));
create policy coll_alloc_write on collection_allocations for all
  using (exists (select 1 from collections c where c.id = collection_id and c.status='draft'
                  and has_permission('treasury.edit')))
  with check (exists (select 1 from collections c where c.id = collection_id and c.status='draft'
                  and has_permission('treasury.create')));
create policy sup_pay_write on supplier_payments for all
  using (has_permission('treasury.edit') and can_access_branch(branch_id))
  with check (has_permission('treasury.create') and can_access_branch(branch_id));
create policy sup_pay_alloc_write on supplier_payment_allocations for all
  using (exists (select 1 from supplier_payments p where p.id = payment_id and p.status='draft'
                  and has_permission('treasury.edit')))
  with check (exists (select 1 from supplier_payments p where p.id = payment_id and p.status='draft'
                  and has_permission('treasury.create')));
create policy tr_transfer_write on treasury_transfers for all
  using (has_permission('treasury.edit')) with check (has_permission('treasury.create'));
create policy vouchers_write on vouchers for all
  using (has_permission('treasury.edit') and can_access_branch(branch_id))
  with check (has_permission('treasury.create') and can_access_branch(branch_id));
create policy bank_rec_write on bank_reconciliations for all
  using (has_permission('treasury.edit')) with check (has_permission('treasury.create'));
create policy bank_rec_line_write on bank_reconciliation_lines for all
  using (has_permission('treasury.edit')) with check (has_permission('treasury.create'));

create policy expenses_write on expenses for all
  using (has_permission('expenses.edit') and can_access_branch(branch_id))
  with check (has_permission('expenses.create') and can_access_branch(branch_id));
create policy exp_settle_write on expense_settlements for all
  using (has_permission('expenses.edit')) with check (has_permission('expenses.create'));
create policy parent_rev_write on parent_revenues for all
  using (has_permission('expenses.edit')) with check (has_permission('expenses.create'));

create policy settings_write on settings for update
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy branches_write on branches for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy accounts_write on accounts for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy exp_types_write on expense_types for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy rev_types_write on revenue_types for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy doc_kinds_write on document_kinds for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy alloc_shares_write on admin_allocation_shares for all
  using (has_permission('settings.edit')) with check (has_permission('settings.edit'));
create policy periods_write on fiscal_periods for all
  using (has_permission('periods.close')) with check (has_permission('periods.close'));

create policy users_write on app_users for all
  using (has_permission('users.manage')) with check (has_permission('users.manage'));
create policy user_roles_write on user_roles for all
  using (has_permission('users.manage')) with check (has_permission('users.manage'));
create policy user_branches_write on user_branches for all
  using (has_permission('users.manage')) with check (has_permission('users.manage'));
create policy roles_write on roles for all
  using (has_permission('users.manage')) with check (has_permission('users.manage'));
create policy role_perms_write on role_permissions for all
  using (has_permission('users.manage')) with check (has_permission('users.manage'));
create policy backup_write on backup_log for all
  using (has_permission('backup.run')) with check (has_permission('backup.run'));

-- سجل العمليات: يُكتب ولا يُعدَّل ولا يُحذف
create policy audit_insert on audit_logs for insert with check (current_app_user_id() is not null);
