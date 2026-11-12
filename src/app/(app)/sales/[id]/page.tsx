import { notFound } from "next/navigation";
import Link from "next/link";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { dateStr, money, qty } from "@/lib/format";
import { cancelSalesInvoice, deleteSalesDraft, postSalesInvoice } from "@/lib/actions/sales";
import PrintHeader from "@/components/doc/PrintHeader";
import JournalView from "@/components/doc/JournalView";
import { Card, Money, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SalesInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission("sales.view");
  const { id } = await params;
  const { error } = await searchParams;

  const [invoice] = await queryAs<Record<string, string>>(
    `select i.*, b.name_ar as branch_name,
            coalesce(c.name, i.customer_name, 'عميل نقدي') as customer_label,
            c.phone as customer_phone, u.full_name as created_by_name
       from sales_invoices i
       join branches b on b.id = i.branch_id
       left join customers c on c.id = i.customer_id
       left join app_users u on u.id = i.created_by
      where i.id = $1`,
    [id],
  );
  if (!invoice) notFound();

  const lines = await queryAs<Record<string, string>>(
    `select l.*, p.code as product_code, p.name_ar as product_name, uom.name_ar as uom
       from sales_invoice_lines l
       join products p on p.id = l.product_id
       left join units_of_measure uom on uom.id = p.uom_id
      where l.invoice_id = $1 order by l.line_no`,
    [id],
  );
  const payments = await queryAs<Record<string, string>>(
    `select pay.*, t.name_ar as treasury_name
       from sales_invoice_payments pay
       join treasury_accounts t on t.id = pay.treasury_account_id
      where pay.invoice_id = $1`,
    [id],
  );
  const settings = await getSettings();
  const taxEnabled = Boolean(settings.tax_enabled);

  const isDraft = invoice.status === "draft";
  const isPosted = invoice.status === "posted";

  return (
    <>
      <PageHeader
        title={`فاتورة مبيعات ${invoice.invoice_no}`}
        subtitle={`${invoice.branch_name} — ${dateStr(invoice.invoice_date)}`}
        action={
          <>
            <StatusBadge status={invoice.status} />
            {isDraft && can(user, "sales.edit") ? (
              <Link href={`/sales/${id}/edit`} className="btn btn-ghost btn-sm">
                تعديل
              </Link>
            ) : null}
            {isDraft && can(user, "sales.post") ? (
              <form action={postSalesInvoice}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-primary btn-sm">ترحيل</button>
              </form>
            ) : null}
            {isDraft && can(user, "sales.delete") ? (
              <form action={deleteSalesDraft}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-danger btn-sm">حذف المسودة</button>
              </form>
            ) : null}
            {isPosted && can(user, "sales.cancel") ? (
              <form action={cancelSalesInvoice}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="reason" value="إلغاء من شاشة الفاتورة" />
                <button className="btn btn-danger btn-sm">إلغاء الفاتورة</button>
              </form>
            ) : null}
          </>
        }
      />

      {error ? (
        <div className="alert alert-error" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="فاتورة مبيعات"
          docNo={invoice.invoice_no}
          date={invoice.invoice_date}
          branch={invoice.branch_name}
          extra={[
            { label: "العميل", value: invoice.customer_label },
            ...(invoice.customer_phone ? [{ label: "الهاتف", value: invoice.customer_phone }] : []),
          ]}
        />

        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>كود</th>
              <th>الصنف</th>
              <th className="cell-num">الكمية</th>
              <th className="cell-num">السعر</th>
              <th className="cell-num">الخصم</th>
              {taxEnabled ? <th className="cell-num">الضريبة</th> : null}
              <th className="cell-num">الإجمالي</th>
              {isPosted ? <th className="cell-num">التكلفة</th> : null}
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
                <td className="cell-num">{money(l.discount)}</td>
                {taxEnabled ? <td className="cell-num">{money(l.tax_amount)}</td> : null}
                <td className="cell-num">{money(l.line_total)}</td>
                {isPosted ? (
                  <td className="cell-num" style={{ color: "var(--muted)" }}>
                    {money(l.cogs_amount)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 240, flex: 1 }}>
            {payments.length > 0 ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>المقبوضات</div>
                <table className="table" style={{ fontSize: 13 }}>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.method === "cash" ? "نقدًا" : "بنك"} — {p.treasury_name}</td>
                        <td className="cell-num">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>فاتورة آجلة بالكامل</div>
            )}
            {invoice.notes ? (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>ملاحظات:</strong> {invoice.notes}
              </div>
            ) : null}
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
              أنشأها: {invoice.created_by_name ?? "—"}
            </div>
          </div>

          <table style={{ minWidth: 280, fontSize: 13.5 }}>
            <tbody>
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>الإجمالي قبل الخصم</td>
                <td className="cell-num" style={{ padding: "5px 0" }}>{money(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>الخصم</td>
                <td className="cell-num" style={{ padding: "5px 0" }}>{money(invoice.discount_total)}</td>
              </tr>
              {taxEnabled ? (
                <tr>
                  <td style={{ padding: "5px 0", color: "var(--muted)" }}>الضريبة</td>
                  <td className="cell-num" style={{ padding: "5px 0" }}>{money(invoice.tax_total)}</td>
                </tr>
              ) : null}
              <tr style={{ fontWeight: 700, fontSize: 15 }}>
                <td style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                  إجمالي الفاتورة
                </td>
                <td className="cell-num" style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                  {money(invoice.total)}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>المدفوع</td>
                <td className="cell-num" style={{ padding: "5px 0" }}>{money(invoice.paid_total)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: "5px 0" }}>المتبقي</td>
                <td className="cell-num" style={{ padding: "5px 0" }}>
                  <Money value={invoice.remaining} />
                </td>
              </tr>
              {isPosted ? (
                <>
                  <tr>
                    <td style={{ padding: "5px 0", color: "var(--muted)" }}>تكلفة البضاعة المباعة</td>
                    <td className="cell-num" style={{ padding: "5px 0" }}>{money(invoice.cogs_total)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "5px 0", color: "var(--muted)" }}>مجمل الربح</td>
                    <td className="cell-num" style={{ padding: "5px 0" }}>
                      <Money
                        value={
                          Number(invoice.subtotal) -
                          Number(invoice.discount_total) -
                          Number(invoice.cogs_total)
                        }
                        tone
                      />
                    </td>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {isPosted ? (
        <Card title="القيد المحاسبي" padded={false}>
          <JournalView docType="sales_invoice" docId={id} />
        </Card>
      ) : null}
    </>
  );
}
