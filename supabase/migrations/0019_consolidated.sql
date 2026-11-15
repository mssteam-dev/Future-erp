-- =============================================================================
-- 0019_consolidated.sql — التقرير المجمّع للشركة والفروع الثلاثة
--   • الإيراد الخارجي (مبيعات لعملاء خارج المجموعة) منفصل عن التحويلات الداخلية.
--   • التحويلات الداخلية تُعرض بتكلفتها الأصلية كبيان للمطابقة فقط، ولا تدخل في
--     الإيراد ولا في الربح، ويتساوى مجموع الصادر والوارد منها عند التجميع.
--   • المصاريف الإدارية تُحسب مرة واحدة (عند الشركة الأم)، أما توزيعها على الفروع
--     فيُعرض في تقرير الفروع ويُستبعد هنا حتى لا يتكرر.
-- =============================================================================
create or replace function report_consolidated(p_from date, p_to date)
returns table (
  branch_id          uuid,
  branch_name        text,
  branch_kind        branch_kind,
  external_sales     numeric,
  other_revenue      numeric,
  cogs               numeric,
  gross_profit       numeric,
  operating_expenses numeric,
  net_profit         numeric,
  transfers_out      numeric,
  transfers_in       numeric
)
language sql
stable
as $$
  with admin_exp as (
    -- المصاريف الإدارية (حسابات 53xx) تُسجَّل عند الشركة الأم وتُحسب مرة واحدة
    select coalesce(sum(jl.debit - jl.credit), 0) as amt
      from journal_lines jl join accounts a on a.id = jl.account_id
     where a.code like '53%' and jl.entry_date between p_from and p_to
  ),
  parent_rev as (
    select coalesce(sum(r.amount), 0) as amt
      from parent_revenues r
     where r.status = 'posted' and r.revenue_date between p_from and p_to
  )
  select b.id, b.name_ar, b.kind,
         p.net_sales,
         case when b.kind = 'parent' then round(pr.amt, 4) else 0 end,
         p.cogs,
         p.gross_profit,
         round(p.direct_expenses + case when b.kind = 'parent' then ae.amt else 0 end, 4),
         round(p.net_sales - p.cogs - p.direct_expenses
               + case when b.kind = 'parent' then pr.amt - ae.amt else 0 end, 4),
         coalesce((select round(sum(l.total_cost), 4)
                     from stock_transfers t join stock_transfer_lines l on l.transfer_id = t.id
                    where t.status = 'posted' and t.from_branch_id = b.id
                      and t.transfer_date between p_from and p_to), 0),
         coalesce((select round(sum(l.total_cost), 4)
                     from stock_transfers t join stock_transfer_lines l on l.transfer_id = t.id
                    where t.status = 'posted' and t.to_branch_id = b.id
                      and t.transfer_date between p_from and p_to), 0)
    from branches b
    cross join lateral branch_pnl(p_from, p_to, b.id) p
    cross join admin_exp ae
    cross join parent_rev pr
   where b.is_active
   order by b.sort_order;
$$;


-- ملخص الشركة: إن باعت الشركة الأم بضاعة مباشرة تُخصم تكلفة هذه المبيعات من الربح
-- (كانت تُستثنى سابقًا فيزيد الربح بقيمتها).
create or replace function report_company_summary(p_from date, p_to date)
returns table (
  branches_net_sales          numeric,
  branches_cogs               numeric,
  branches_gross_profit       numeric,
  branches_direct_expenses    numeric,
  admin_expenses_total        numeric,
  admin_allocated_to_branches numeric,
  branches_net_profit         numeric,
  parent_unallocated_expenses numeric,
  profit_before_parent_revenue numeric,
  parent_revenue              numeric,
  profit_after_parent_revenue numeric
)
language sql
stable
as $$
  with br as (
    select coalesce(sum(p.net_sales),0) ns, coalesce(sum(p.cogs),0) cg,
           coalesce(sum(p.gross_profit),0) gp, coalesce(sum(p.direct_expenses),0) de,
           coalesce(sum(p.admin_share),0) sh, coalesce(sum(p.net_profit),0) np
      from branches b
      cross join lateral branch_pnl(p_from, p_to, b.id) p
     where b.kind = 'branch'
  ),
  parent as (
    select
      coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'revenue'), 0) as revenue,
      coalesce(sum(jl.debit - jl.credit) filter (
        where a.type = 'expense' and a.system_key is distinct from 'cogs'), 0)  as expenses,
      coalesce(sum(jl.debit - jl.credit) filter (where a.system_key = 'cogs'), 0) as cogs
      from journal_lines jl
      join accounts a on a.id = jl.account_id
      join branches b on b.id = jl.branch_id and b.kind = 'parent'
     where jl.entry_date between p_from and p_to
  ),
  admin_total as (
    select coalesce(sum(e.amount), 0) amt
      from expenses e
     where e.status = 'posted' and e.is_admin
       and e.expense_date between p_from and p_to
  )
  select
    round(br.ns, 4), round(br.cg, 4), round(br.gp, 4), round(br.de, 4),
    round((select amt from admin_total), 4),
    round(br.sh, 4),
    round(br.np, 4),
    round(parent.expenses - br.sh, 4)                                  as parent_unallocated,
    round(br.np - (parent.expenses - br.sh) - parent.cogs, 4)          as profit_before_parent_rev,
    round(parent.revenue, 4),
    round(br.np - (parent.expenses - br.sh) - parent.cogs + parent.revenue, 4) as profit_after_parent_rev
  from br, parent;
$$;

grant execute on function report_consolidated(date, date) to authenticated;
grant execute on function report_company_summary(date, date) to authenticated;
