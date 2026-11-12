import { queryAs } from "@/lib/auth";
import { getBranches, getProducts, periodFrom } from "@/lib/data";
import { DOC_TYPE_LABEL, dateStr, money, qty } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, Grid, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProductCardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);
  const [branches, products] = await Promise.all([getBranches(), getProducts()]);

  const branchId = sp.branch || branches[0]?.id;
  const productId = sp.product || products[0]?.id;

  const rows =
    branchId && productId
      ? await queryAs<Record<string, string>>(
          "select * from report_product_card($1::uuid, $2::uuid, $3::date, $4::date)",
          [productId, branchId, from, to],
        )
      : [];

  const [balance] = productId && branchId
    ? await queryAs<Record<string, string>>(
        `select quantity, avg_cost, stock_value from product_branch_stock
          where product_id = $1 and branch_id = $2`,
        [productId, branchId],
      )
    : [];

  const totalIn = rows.reduce((a, r) => a + Number(r.qty_in ?? 0), 0);
  const totalOut = rows.reduce((a, r) => a + Number(r.qty_out ?? 0), 0);

  return (
    <>
      <PageHeader title="بطاقة حركة المنتج" subtitle="كل حركة واردة وصادرة مع الرصيد بعدها" />
      <Filters
        branches={branches}
        allBranchesLabel="اختر الوحدة"
        extra={[
          {
            name: "product",
            label: "المنتج",
            options: products.map((p) => ({ value: p.id, label: `${p.code} — ${p.name_ar}` })),
          },
        ]}
      />

      <Grid cols={4}>
        <Stat label="إجمالي الوارد" value={qty(totalIn)} />
        <Stat label="إجمالي الصادر" value={qty(totalOut)} />
        <Stat label="الرصيد الحالي" value={qty(balance?.quantity ?? 0)} tone="brand" />
        <Stat label="قيمة الرصيد" value={money(balance?.stock_value ?? 0)} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد حركات لهذا المنتج في الفترة المحددة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>نوع الحركة</th>
                <th>المستند</th>
                <th>البيان</th>
                <th className="cell-num">وارد</th>
                <th className="cell-num">صادر</th>
                <th className="cell-num">تكلفة الوحدة</th>
                <th className="cell-num">الرصيد</th>
                <th className="cell-num">قيمة الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="num">{dateStr(r.move_date)}</td>
                  <td>{DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type}</td>
                  <td className="num">{r.doc_no}</td>
                  <td style={{ color: "var(--muted)" }}>{r.description}</td>
                  <td className="cell-num" style={{ color: "var(--success)" }}>
                    {Number(r.qty_in) ? qty(r.qty_in) : ""}
                  </td>
                  <td className="cell-num" style={{ color: "var(--danger)" }}>
                    {Number(r.qty_out) ? qty(r.qty_out) : ""}
                  </td>
                  <td className="cell-num">{money(r.unit_cost)}</td>
                  <td className="cell-num" style={{ fontWeight: 600 }}>{qty(r.balance_qty)}</td>
                  <td className="cell-num">{money(r.balance_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
