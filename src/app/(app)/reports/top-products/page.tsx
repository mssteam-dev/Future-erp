import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money, pct, qty } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Money, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TopProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const orderBy = sp.order === "quantity" ? "quantity" : "sales";
  const limit = Number(sp.limit ?? 10) || 10;

  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const [bySales, byProfit] = await Promise.all([
    queryAs<Record<string, string>>(
      "select * from report_top_products($1::date, $2::date, $3::uuid, $4, $5)",
      [from, to, branch, orderBy, limit],
    ),
    queryAs<Record<string, string>>(
      "select * from report_top_products($1::date, $2::date, $3::uuid, 'profit', $4)",
      [from, to, branch, limit],
    ),
  ]);

  const table = (rows: Record<string, string>[], title: string, note: string) => (
    <div className="card print-full" style={{ padding: 20, marginBottom: 16 }}>
      <PrintHeader
        company={settings}
        title={title}
        extra={[
          { label: "الفترة", value: `${from} — ${to}` },
          { label: "الوحدة", value: branch ? branches.find((b) => b.id === branch)?.name_ar ?? "" : "كل الفروع" },
        ]}
      />
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>{note}</div>
      {rows.length === 0 ? (
        <Empty message="لا توجد مبيعات في الفترة المحددة" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>الترتيب</th>
              <th>كود المنتج</th>
              <th>اسم المنتج</th>
              <th className="cell-num">الكمية المباعة</th>
              <th className="cell-num">صافي المبيعات</th>
              <th className="cell-num">تكلفة البضاعة المباعة</th>
              <th className="cell-num">مجمل الربح</th>
              <th className="cell-num">هامش الربح</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id}>
                <td className="num" style={{ fontWeight: 700, color: "var(--brand)" }}>{r.rank_no}</td>
                <td className="num">{r.product_code}</td>
                <td>{r.product_name}</td>
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
              <td colSpan={4}>الإجمالي</td>
              <td className="cell-num">{money(rows.reduce((a, r) => a + Number(r.net_sales), 0))}</td>
              <td className="cell-num">{money(rows.reduce((a, r) => a + Number(r.cogs), 0))}</td>
              <td className="cell-num">{money(rows.reduce((a, r) => a + Number(r.gross_profit), 0))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="أعلى 10 منتجات" subtitle="مجمَّعة لكل منتج خلال الفترة، بلا تكرار بسبب تعدد الفواتير" />
      <Filters
        exportReport="top-sales"
        branches={branches}
        extra={[
          {
            name: "order",
            label: "ترتيب الأعلى مبيعًا",
            options: [
              { value: "sales", label: "حسب القيمة" },
              { value: "quantity", label: "حسب الكمية" },
            ],
          },
          {
            name: "limit",
            label: "عدد النتائج",
            options: [
              { value: "10", label: "10" },
              { value: "20", label: "20" },
              { value: "50", label: "50" },
            ],
          },
        ]}
      />

      {table(
        bySales,
        `أعلى ${limit} منتجات مبيعًا`,
        orderBy === "sales"
          ? "الترتيب حسب صافي المبيعات بالقيمة من الأعلى إلى الأقل، وعند التساوي يُرتَّب بكود المنتج."
          : "الترتيب حسب الكمية المباعة من الأعلى إلى الأقل، وعند التساوي يُرتَّب بكود المنتج.",
      )}

      {table(
        byProfit,
        `أعلى ${limit} منتجات ربحًا`,
        "الترتيب حسب إجمالي مجمل الربح، لا حسب سعر البيع أو هامش الربح وحده.",
      )}
    </>
  );
}
