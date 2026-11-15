import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { money, pct, qty } from "@/lib/format";
import Filters from "@/components/Filters";
import { BarChart, LineChart } from "@/components/Charts";
import Link from "next/link";
import { Card, Empty, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type BranchRow = {
  branch_id: string;
  branch_name: string;
  branch_kind: string;
  net_sales: string;
  gross_profit: string;
  margin_before: string;
  total_expenses: string;
  net_profit: string;
  margin_after: string;
  receivables: string;
  payables: string;
  inventory_value: string;
  cash_balance: string;
  bank_balance: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<BranchRow>(
    "select * from report_branch_financial($1::date, $2::date, $3::uuid)",
    [from, to, branch],
  );
  const [summary] = await queryAs<Record<string, string>>(
    "select * from report_company_summary($1::date, $2::date)",
    [from, to],
  );
  const lowStock = await queryAs<{
    branch_name: string;
    product_code: string;
    product_name: string;
    quantity: string;
    reorder_level: string;
  }>("select * from report_inventory($1::uuid, true) limit 12", [branch]);

  const daily = await queryAs<{ day: string; net_sales: string }>(
    `select to_char(i.invoice_date, 'DD') as day,
            round(sum(l.net_amount), 3)::text as net_sales
       from sales_invoices i
       join sales_invoice_lines l on l.invoice_id = i.id
      where i.status = 'posted'
        and i.invoice_date between $1::date and $2::date
        and ($3::uuid is null or i.branch_id = $3::uuid)
      group by 1 order by 1`,
    [from, to, branch],
  );

  const topSales = await queryAs<Record<string, string>>(
    "select * from report_top_products($1::date, $2::date, $3::uuid, 'sales', 5)",
    [from, to, branch],
  );
  const topProfit = await queryAs<Record<string, string>>(
    "select * from report_top_products($1::date, $2::date, $3::uuid, 'profit', 5)",
    [from, to, branch],
  );

  const branchRows = rows.filter((r) => r.branch_kind === "branch");
  const parentRow = rows.find((r) => r.branch_kind === "parent");
  const sum = (key: keyof BranchRow) =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
  const sumBranches = (key: keyof BranchRow) =>
    branchRows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  return (
    <>
      <PageHeader title="لوحة التحكم" subtitle={`الفترة من ${from} إلى ${to}`} />
      <Filters branches={branches} />

      <Grid cols={4}>
        {branchRows.map((r) => (
          <Stat key={r.branch_id} label={`مبيعات ${r.branch_name}`} value={money(r.net_sales)} />
        ))}
        <Stat
          label="إجمالي مبيعات الفروع"
          value={money(sumBranches("net_sales"))}
          tone="brand"
        />
      </Grid>

      <Grid cols={4}>
        <Stat label="إيراد الشركة الأم" value={money(summary?.parent_revenue)} />
        <Stat label="مجمل الربح" value={money(sumBranches("gross_profit"))} />
        <Stat
          label="صافي الربح بعد المصاريف"
          value={money(sumBranches("net_profit"))}
          tone={sumBranches("net_profit") >= 0 ? "good" : "bad"}
        />
        <Stat
          label="الربح بعد إضافة إيراد الشركة الأم"
          value={money(summary?.profit_after_parent_revenue)}
          hint={`قبل إضافته: ${money(summary?.profit_before_parent_revenue)}`}
          tone={Number(summary?.profit_after_parent_revenue ?? 0) >= 0 ? "good" : "bad"}
        />
      </Grid>

      <Grid cols={4}>
        <Stat
          label="إجمالي المصاريف التشغيلية"
          value={money(sum("total_expenses"))}
          hint={`منها إداري موزّع: ${money(summary?.admin_allocated_to_branches)}`}
        />
        <Stat label="رصيد الصندوق" value={money(sum("cash_balance"))} />
        <Stat label="رصيد البنك" value={money(sum("bank_balance"))} />
        <Stat label="قيمة المخزون" value={money(sum("inventory_value"))} />
      </Grid>

      <Grid cols={4}>
        <Stat label="إجمالي الذمم المدينة" value={money(sum("receivables"))} />
        <Stat label="إجمالي الذمم الدائنة" value={money(sum("payables"))} />
        <Stat
          label="منتجات قاربت على النفاد"
          value={String(lowStock.length)}
          tone={lowStock.length ? "bad" : "default"}
        />
        <Stat
          label="إيراد الشركة الأم مقابل الفروع"
          value={pct(
            sumBranches("net_sales") + Number(summary?.parent_revenue ?? 0) === 0
              ? 0
              : (Number(summary?.parent_revenue ?? 0) /
                  (sumBranches("net_sales") + Number(summary?.parent_revenue ?? 0))) *
                  100,
          )}
        />
      </Grid>

      <div className="grid-cards" style={{ "--min": "380px" } as React.CSSProperties}>
        <Card title="صافي مبيعات الفروع">
          <BarChart
            data={branchRows.map((r) => ({ label: r.branch_name, value: Number(r.net_sales) }))}
          />
        </Card>
        <Card title="صافي الربح بعد المصاريف">
          <BarChart
            data={branchRows.map((r) => ({ label: r.branch_name, value: Number(r.net_profit) }))}
          />
        </Card>
      </div>

      <Card title="حركة المبيعات اليومية">
        <LineChart data={daily.map((d) => ({ label: d.day, value: Number(d.net_sales) }))} />
      </Card>

      <Card title="انتقال سريع">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            ["/sales/new", "فاتورة مبيعات"],
            ["/purchases/new", "فاتورة مشتريات"],
            ["/inventory/transfers/new", "تحويل بضاعة"],
            ["/treasury/collections/new", "سند قبض"],
            ["/expenses/new", "تسجيل مصروف"],
            ["/reports/branches", "تقرير الفروع"],
            ["/reports/top-products", "أعلى 10 منتجات"],
            ["/settings/periods", "الإقفال الشهري"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>
              {label}
            </Link>
          ))}
        </div>
      </Card>

      <Card title="أداء الوحدات" padded={false}>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>الوحدة</th>
                <th className="cell-num">صافي المبيعات</th>
                <th className="cell-num">مجمل الربح</th>
                <th className="cell-num">هامش قبل المصاريف</th>
                <th className="cell-num">المصاريف</th>
                <th className="cell-num">صافي الربح</th>
                <th className="cell-num">هامش بعد المصاريف</th>
                <th className="cell-num">المخزون</th>
                <th className="cell-num">الصندوق</th>
                <th className="cell-num">البنك</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.branch_id}>
                  <td style={{ fontWeight: 600 }}>
                    {r.branch_name}
                    {r.branch_kind === "parent" ? (
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}> (الشركة الأم)</span>
                    ) : null}
                  </td>
                  <td className="cell-num">
                    <Money value={r.net_sales} />
                  </td>
                  <td className="cell-num">
                    <Money value={r.gross_profit} />
                  </td>
                  <td className="cell-num">{pct(r.margin_before)}</td>
                  <td className="cell-num">
                    <Money value={r.total_expenses} />
                  </td>
                  <td className="cell-num">
                    <Money value={r.net_profit} tone />
                  </td>
                  <td className="cell-num">{pct(r.margin_after)}</td>
                  <td className="cell-num">
                    <Money value={r.inventory_value} />
                  </td>
                  <td className="cell-num">
                    <Money value={r.cash_balance} />
                  </td>
                  <td className="cell-num">
                    <Money value={r.bank_balance} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>الإجمالي</td>
                <td className="cell-num">{money(sum("net_sales"))}</td>
                <td className="cell-num">{money(sum("gross_profit"))}</td>
                <td></td>
                <td className="cell-num">{money(sum("total_expenses"))}</td>
                <td className="cell-num">{money(sum("net_profit"))}</td>
                <td></td>
                <td className="cell-num">{money(sum("inventory_value"))}</td>
                <td className="cell-num">{money(sum("cash_balance"))}</td>
                <td className="cell-num">{money(sum("bank_balance"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid-cards" style={{ "--min": "380px" } as React.CSSProperties}>
        <Card title="أعلى 5 منتجات مبيعًا" padded={false}>
          {topSales.length === 0 ? (
            <Empty message="لا توجد مبيعات في الفترة" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>المنتج</th>
                  <th className="cell-num">الكمية</th>
                  <th className="cell-num">صافي المبيعات</th>
                </tr>
              </thead>
              <tbody>
                {topSales.map((p) => (
                  <tr key={p.product_id}>
                    <td className="num">{p.rank_no}</td>
                    <td>
                      <span style={{ color: "var(--muted)" }} className="num">
                        {p.product_code}
                      </span>{" "}
                      {p.product_name}
                    </td>
                    <td className="cell-num">{qty(p.qty_sold)}</td>
                    <td className="cell-num">{money(p.net_sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="أعلى 5 منتجات ربحًا" padded={false}>
          {topProfit.length === 0 ? (
            <Empty message="لا توجد أرباح في الفترة" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>المنتج</th>
                  <th className="cell-num">مجمل الربح</th>
                  <th className="cell-num">الهامش</th>
                </tr>
              </thead>
              <tbody>
                {topProfit.map((p) => (
                  <tr key={p.product_id}>
                    <td className="num">{p.rank_no}</td>
                    <td>
                      <span style={{ color: "var(--muted)" }} className="num">
                        {p.product_code}
                      </span>{" "}
                      {p.product_name}
                    </td>
                    <td className="cell-num">
                      <Money value={p.gross_profit} tone />
                    </td>
                    <td className="cell-num">{pct(p.margin_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {lowStock.length > 0 ? (
        <Card title="منتجات اقتربت من النفاد" padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th>المنتج</th>
                <th className="cell-num">الرصيد</th>
                <th className="cell-num">حد إعادة الطلب</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((p, i) => (
                <tr key={i}>
                  <td>{p.branch_name}</td>
                  <td>
                    <span className="num" style={{ color: "var(--muted)" }}>
                      {p.product_code}
                    </span>{" "}
                    {p.product_name}
                  </td>
                  <td className="cell-num" style={{ color: "var(--danger)" }}>
                    {qty(p.quantity)}
                  </td>
                  <td className="cell-num">{qty(p.reorder_level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {parentRow ? (
        <Card title="الشركة الأم">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 12,
            }}
          >
            <Stat label="إيراد نشاط الشركة الأم" value={money(summary?.parent_revenue)} />
            <Stat
              label="المصاريف الإدارية الكلية"
              value={money(summary?.admin_expenses_total)}
              hint={`الموزّع على الفروع: ${money(summary?.admin_allocated_to_branches)}`}
            />
            <Stat
              label="مصاريف غير موزّعة"
              value={money(summary?.parent_unallocated_expenses)}
            />
            <Stat label="قيمة المخزون المركزي" value={money(parentRow.inventory_value)} />
          </div>
        </Card>
      ) : null}
    </>
  );
}
