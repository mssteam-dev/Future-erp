import { notFound } from "next/navigation";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { money, qty } from "@/lib/format";
import { postStockTransfer } from "@/lib/actions/inventory";
import PrintHeader from "@/components/doc/PrintHeader";
import JournalView from "@/components/doc/JournalView";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const { error } = await searchParams;

  const [transfer] = await queryAs<Record<string, string>>(
    `select t.*, fb.name_ar as from_name, tb.name_ar as to_name
       from stock_transfers t
       join branches fb on fb.id = t.from_branch_id
       join branches tb on tb.id = t.to_branch_id
      where t.id = $1`,
    [id],
  );
  if (!transfer) notFound();

  const lines = await queryAs<Record<string, string>>(
    `select l.*, p.code as product_code, p.name_ar as product_name
       from stock_transfer_lines l join products p on p.id = l.product_id
      where l.transfer_id = $1 order by l.line_no`,
    [id],
  );
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title={`تحويل بضاعة ${transfer.transfer_no}`}
        subtitle={`${transfer.from_name} ← ${transfer.to_name}`}
        action={
          <>
            <StatusBadge status={transfer.status} />
            {transfer.status === "draft" && can(user, "inventory.post") ? (
              <form action={postStockTransfer}>
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
          title="سند تحويل بضاعة"
          docNo={transfer.transfer_no}
          date={transfer.transfer_date}
          extra={[
            { label: "من", value: transfer.from_name },
            { label: "إلى", value: transfer.to_name },
          ]}
        />
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>كود</th>
              <th>الصنف</th>
              <th className="cell-num">الكمية</th>
              <th className="cell-num">تكلفة الوحدة</th>
              <th className="cell-num">التكلفة الإجمالية</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="num">{l.line_no}</td>
                <td className="num">{l.product_code}</td>
                <td>{l.product_name}</td>
                <td className="cell-num">{qty(l.quantity)}</td>
                <td className="cell-num">{money(l.unit_cost)}</td>
                <td className="cell-num">{money(l.total_cost)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>إجمالي التكلفة المحوَّلة</td>
              <td className="cell-num">{money(transfer.total_cost)}</td>
            </tr>
          </tfoot>
        </table>
        {transfer.notes ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <strong>ملاحظات:</strong> {transfer.notes}
          </div>
        ) : null}
      </div>

      {transfer.status === "posted" ? (
        <Card title="القيد المحاسبي" padded={false}>
          <JournalView docType="stock_transfer" docId={id} />
        </Card>
      ) : null}
    </>
  );
}
