import { queryAs } from "@/lib/auth";
import { getBranches } from "@/lib/data";
import { money, qty } from "@/lib/format";
import Filters from "@/components/Filters";
import { ProductThumb } from "@/components/doc/ProductPicker";
import { Card, Empty, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const branch = sp.branch || null;
  const lowOnly = sp.low === "1";
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    "select * from report_inventory($1::uuid, $2)",
    [branch, lowOnly],
  );
  const withImages = new Set(
    (await queryAs<{ id: string }>("select id from products where image is not null")).map((p) => p.id),
  );

  const totalValue = rows.reduce((a, r) => a + Number(r.stock_value ?? 0), 0);
  const lowCount = rows.filter((r) => String(r.is_low) === "true").length;

  const byBranch = new Map<string, number>();
  for (const r of rows) {
    byBranch.set(r.branch_name, (byBranch.get(r.branch_name) ?? 0) + Number(r.stock_value ?? 0));
  }

  return (
    <>
      <PageHeader title="أرصدة المخزون" subtitle="الكميات والتكلفة المتوسطة في كل وحدة" />
      <Filters
        exportReport="inventory"
        branches={branches}
        showPeriod={false}
        extra={[
          {
            name: "low",
            label: "التصفية",
            options: [
              { value: "", label: "كل المنتجات" },
              { value: "1", label: "ما قارب على النفاد فقط" },
            ],
          },
        ]}
      />

      <Grid cols={3}>
        <Stat label="قيمة المخزون" value={money(totalValue)} tone="brand" />
        <Stat label="عدد الأصناف" value={String(rows.length)} />
        <Stat label="أصناف قاربت على النفاد" value={String(lowCount)} tone={lowCount ? "bad" : "default"} />
      </Grid>

      {byBranch.size > 1 ? (
        <Grid cols={4}>
          {[...byBranch.entries()].map(([name, value]) => (
            <Stat key={name} label={`مخزون ${name}`} value={money(value)} />
          ))}
        </Grid>
      ) : null}

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد أرصدة" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 46 }}></th>
                  <th>الوحدة</th>
                  <th>الكود</th>
                  <th>المنتج</th>
                  <th>التصنيف</th>
                  <th className="cell-num">الكمية</th>
                  <th className="cell-num">متوسط التكلفة</th>
                  <th className="cell-num">قيمة المخزون</th>
                  <th className="cell-num">حد الطلب</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={String(r.is_low) === "true" ? { background: "#fff8f7" } : undefined}>
                    <td>
                      <ProductThumb
                        product={{ id: r.product_id, name_ar: r.product_name, has_image: withImages.has(r.product_id) }}
                        size={30}
                      />
                    </td>
                    <td>{r.branch_name}</td>
                    <td className="num">{r.product_code}</td>
                    <td>{r.product_name}</td>
                    <td style={{ color: "var(--muted)" }}>{r.category_name}</td>
                    <td className="cell-num" style={String(r.is_low) === "true" ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
                      {qty(r.quantity)}
                    </td>
                    <td className="cell-num">{money(r.avg_cost)}</td>
                    <td className="cell-num"><Money value={r.stock_value} /></td>
                    <td className="cell-num" style={{ color: "var(--muted)" }}>{qty(r.reorder_level)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>الإجمالي</td>
                  <td className="cell-num">{money(totalValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
