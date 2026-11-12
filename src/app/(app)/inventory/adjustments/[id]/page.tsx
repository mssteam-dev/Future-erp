import { notFound } from "next/navigation";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { money, qty } from "@/lib/format";
import { postStockAdjustment } from "@/lib/actions/inventory";
import PrintHeader from "@/components/doc/PrintHeader";
import JournalView from "@/components/doc/JournalView";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdjustmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const { error } = await searchParams;

  const [adj] = await queryAs<Record<string, string>>(
    `select a.*, b.name_ar as branch_name from stock_adjustments a
       join branches b on b.id = a.branch_id where a.id = $1`,
    [id],
  );
  if (!adj) notFound();

  const lines = await queryAs<Record<string, string>>(
    `select l.*, p.code as product_code, p.name_ar as product_name
       from stock_adjustment_lines l join products p on p.id = l.product_id
      where l.adjustment_id = $1 order by l.line_no`,
    [id],
  );
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title={`تسوية ${adj.adjustment_no}`}
        subtitle={adj.branch_name}
        action={
          <>
            <StatusBadge status={adj.status} />
            {adj.status === "draft" && can(user, "inventory.post") ? (
              <form action={postStockAdjustment}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-primary btn-sm">ترحيل</button>
              </form>
            ) : null}
          </>
        }
      />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="سند تسوية مخزنية"
          docNo={adj.adjustment_no}
          date={adj.adjustment_date}
          branch={adj.branch_name}
        />
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>كود</th>
              <th>الصنف</th>
              <th className="cell-num">الرصيد الدفتري</th>
              <th className="cell-num">الجرد الفعلي</th>
              <th className="cell-num">الفرق</th>
              <th className="cell-num">تكلفة الوحدة</th>
              <th className="cell-num">قيمة الفرق</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="num">{l.line_no}</td>
                <td className="num">{l.product_code}</td>
                <td>{l.product_name}</td>
                <td className="cell-num">{qty(l.system_qty)}</td>
                <td className="cell-num">{qty(l.counted_qty)}</td>
                <td className="cell-num" style={{ color: Number(l.difference_qty) < 0 ? "var(--danger)" : "var(--success)" }}>
                  {qty(l.difference_qty)}
                </td>
                <td className="cell-num">{money(l.unit_cost)}</td>
                <td className="cell-num">{money(l.total_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {adj.reason ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <strong>السبب:</strong> {adj.reason}
          </div>
        ) : null}
      </div>

      {adj.status === "posted" ? (
        <Card title="القيد المحاسبي" padded={false}>
          <JournalView docType={adj.kind === "opening" ? "opening_stock" : "stock_adjustment"} docId={id} />
        </Card>
      ) : null}
    </>
  );
}
