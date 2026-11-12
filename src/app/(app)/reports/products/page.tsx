import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money, pct, qty } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Money, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProductProfitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const includeZero = sp.zero === "1";
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const rows = await queryAs<Record<string, string>>(
    "select * from report_product_profitability($1::date, $2::date, $3::uuid, $4)",
    [from, to, branch, includeZero],
  );

  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  return (
    <>
      <PageHeader title="ربحية المنتجات" subtitle="صافي المبيعات والتكلفة ومجمل الربح لكل منتج" />
      <Filters
        exportReport="products"
        branches={branches}
        extra={[
          {
            name: "zero",
            label: "المنتجات بلا حركة",
            options: [
              { value: "", label: "استبعادها" },
              { value: "1", label: "إظهارها" },
            ],
          },
        ]}
      />

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="تقرير ربحية المنتجات"
          extra={[{ label: "الفترة", value: `${from} — ${to}` }]}
        />
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الكود</th>
                  <th>المنتج</th>
                  <th>التصنيف</th>
                  <th className="cell-num">الكمية</th>
                  <th className="cell-num">صافي المبيعات</th>
                  <th className="cell-num">التكلفة</th>
                  <th className="cell-num">مجمل الربح</th>
                  <th className="cell-num">الهامش</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product_id}>
                    <td className="num">{r.product_code}</td>
                    <td>{r.product_name}</td>
                    <td style={{ color: "var(--muted)" }}>{r.category_name}</td>
                    <td className="cell-num">{qty(r.qty_sold)}</td>
                    <td className="cell-num">{money(r.net_sales)}</td>
                    <td className="cell-num">{money(r.cogs)}</td>
                    <td className="cell-num"><Money value={r.gross_profit} tone /></td>
                    <td className="cell-num">{pct(r.margin_pct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>الإجمالي ({rows.length} منتج)</td>
                  <td className="cell-num">{qty(sum("qty_sold"))}</td>
                  <td className="cell-num">{money(sum("net_sales"))}</td>
                  <td className="cell-num">{money(sum("cogs"))}</td>
                  <td className="cell-num">{money(sum("gross_profit"))}</td>
                  <td className="cell-num">
                    {pct(sum("net_sales") === 0 ? 0 : (sum("gross_profit") / sum("net_sales")) * 100)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
