import { notFound } from "next/navigation";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { money, qty } from "@/lib/format";
import { cancelSalesReturn, postSalesReturn } from "@/lib/actions/sales";
import PrintHeader from "@/components/doc/PrintHeader";
import JournalView from "@/components/doc/JournalView";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SalesReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const { error } = await searchParams;

  const [ret] = await queryAs<Record<string, string>>(
    `select r.*, b.name_ar as branch_name, coalesce(c.name, 'عميل نقدي') as customer_name
       from sales_returns r join branches b on b.id = r.branch_id
       left join customers c on c.id = r.customer_id where r.id = $1`,
    [id],
  );
  if (!ret) notFound();

  const lines = await queryAs<Record<string, string>>(
    `select l.*, p.code as product_code, p.name_ar as product_name
       from sales_return_lines l join products p on p.id = l.product_id
      where l.return_id = $1 order by l.line_no`,
    [id],
  );
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title={`مرتجع مبيعات ${ret.return_no}`}
        subtitle={`${ret.branch_name} — ${ret.customer_name}`}
        action={
          <>
            <StatusBadge status={ret.status} />
            {ret.status === "draft" && can(user, "sales.post") ? (
              <form action={postSalesReturn}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-primary btn-sm">ترحيل</button>
              </form>
            ) : null}
            {ret.status === "posted" && can(user, "sales.cancel") ? (
              <form action={cancelSalesReturn}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-danger btn-sm">إلغاء</button>
              </form>
            ) : null}
          </>
        }
      />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="سند مرتجع مبيعات"
          docNo={ret.return_no}
          date={ret.return_date}
          branch={ret.branch_name}
          extra={[{ label: "العميل", value: ret.customer_name }]}
        />
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>كود</th>
              <th>الصنف</th>
              <th className="cell-num">الكمية</th>
              <th className="cell-num">السعر</th>
              <th className="cell-num">الإجمالي</th>
              <th className="cell-num">التكلفة المعادة</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="num">{l.line_no}</td>
                <td className="num">{l.product_code}</td>
                <td>{l.product_name}</td>
                <td className="cell-num">{qty(l.quantity)}</td>
                <td className="cell-num">{money(l.unit_price)}</td>
                <td className="cell-num">{money(l.line_total)}</td>
                <td className="cell-num" style={{ color: "var(--muted)" }}>{money(l.cogs_amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>الإجمالي</td>
              <td className="cell-num">{money(ret.total)}</td>
              <td className="cell-num">{money(ret.cogs_total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {ret.status === "posted" ? (
        <Card title="القيد المحاسبي" padded={false}>
          <JournalView docType="sales_return" docId={id} />
        </Card>
      ) : null}
    </>
  );
}
