import { notFound } from "next/navigation";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { dateStr, money, qty } from "@/lib/format";
import { cancelPurchaseInvoice, deletePurchaseDraft, postPurchaseInvoice } from "@/lib/actions/purchases";
import PrintHeader from "@/components/doc/PrintHeader";
import JournalView from "@/components/doc/JournalView";
import { Card, Money, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PurchaseInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission("purchases.view");
  const { id } = await params;
  const { error } = await searchParams;

  const [invoice] = await queryAs<Record<string, string>>(
    `select i.*, s.name as supplier_name, s.phone as supplier_phone, b.name_ar as branch_name
       from purchase_invoices i
       join suppliers s on s.id = i.supplier_id
       join branches b on b.id = i.branch_id
      where i.id = $1`,
    [id],
  );
  if (!invoice) notFound();

  const lines = await queryAs<Record<string, string>>(
    `select l.*, p.code as product_code, p.name_ar as product_name
       from purchase_invoice_lines l join products p on p.id = l.product_id
      where l.invoice_id = $1 order by l.line_no`,
    [id],
  );
  const expenses = await queryAs<Record<string, string>>(
    `select e.*, t.name_ar as treasury_name, s.name as payee_supplier
       from purchase_invoice_expenses e
       left join treasury_accounts t on t.id = e.treasury_account_id
       left join suppliers s on s.id = e.supplier_id
      where e.invoice_id = $1 order by e.seq`,
    [id],
  );
  const payments = await queryAs<Record<string, string>>(
    `select pay.*, t.name_ar as treasury_name from purchase_invoice_payments pay
       join treasury_accounts t on t.id = pay.treasury_account_id
      where pay.invoice_id = $1`,
    [id],
  );
  const settings = await getSettings();
  const taxEnabled = Boolean(settings.tax_enabled);
  const hasExpenses = expenses.length > 0;
  const owedExpenses = expenses
    .filter((e) => !e.treasury_account_id && !e.supplier_id)
    .reduce((a, e) => a + Number(e.amount), 0);
  const methodLabel: Record<string, string> = {
    qty: "بالتساوي على القطع",
    weight: "حسب الوزن",
    value: "حسب القيمة",
    default: "كما في الشحنة",
  };
  const kindLabel: Record<string, string> = {
    freight: "شحن",
    customs: "تخليص جمركي",
    transport: "نقل",
    insurance: "تأمين",
    other: "أخرى",
  };
  const isDraft = invoice.status === "draft";
  const isPosted = invoice.status === "posted";

  return (
    <>
      <PageHeader
        title={`فاتورة مشتريات ${invoice.invoice_no}`}
        subtitle={`${invoice.supplier_name} — ${invoice.branch_name}`}
        action={
          <>
            <StatusBadge status={invoice.status} />
            {isDraft && can(user, "purchases.post") ? (
              <form action={postPurchaseInvoice}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-primary btn-sm">ترحيل</button>
              </form>
            ) : null}
            {isDraft && can(user, "purchases.delete") ? (
              <form action={deletePurchaseDraft}>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-danger btn-sm">حذف المسودة</button>
              </form>
            ) : null}
            {isPosted && can(user, "purchases.cancel") ? (
              <form action={cancelPurchaseInvoice}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="reason" value="إلغاء من شاشة الفاتورة" />
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
          title="فاتورة مشتريات"
          docNo={invoice.invoice_no}
          date={invoice.invoice_date}
          branch={invoice.branch_name}
          extra={[
            { label: "المورد", value: invoice.supplier_name },
            ...(invoice.supplier_ref_no
              ? [{ label: "رقم فاتورة المورد", value: invoice.supplier_ref_no }]
              : []),
            ...(invoice.shipment_no ? [{ label: "رقم الشحنة", value: invoice.shipment_no }] : []),
            ...(invoice.carrier ? [{ label: "جهة الشحن", value: invoice.carrier }] : []),
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
              {hasExpenses ? <th className="cell-num">الوزن (كجم)</th> : null}
              <th className="cell-num">الخصم</th>
              {taxEnabled ? <th className="cell-num">الضريبة</th> : null}
              <th className="cell-num">الإجمالي</th>
              {hasExpenses ? <th className="cell-num">نصيب المصاريف</th> : null}
              <th className="cell-num">التكلفة النهائية للقطعة</th>
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
                {hasExpenses ? <td className="cell-num">{qty(l.weight_kg)}</td> : null}
                <td className="cell-num">{money(l.discount)}</td>
                {taxEnabled ? <td className="cell-num">{money(l.tax_amount)}</td> : null}
                <td className="cell-num">{money(l.line_total)}</td>
                {hasExpenses ? <td className="cell-num">{money(l.alloc_expense)}</td> : null}
                <td className="cell-num" style={{ fontWeight: 600 }}>{money(l.landed_unit_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {hasExpenses ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>
              مصاريف الشحنة — التوزيع {methodLabel[invoice.alloc_method] ?? ""}
            </div>
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>البيان</th>
                  <th>أساس التوزيع</th>
                  <th>الجهة الدائنة</th>
                  <th className="cell-num">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{kindLabel[e.kind] ?? e.kind}</td>
                    <td>{e.description ?? "—"}</td>
                    <td>{methodLabel[e.alloc_basis] ?? e.alloc_basis}</td>
                    <td>
                      {e.treasury_name
                        ? `مدفوع من ${e.treasury_name}`
                        : e.payee_supplier
                          ? `مستحق لـ ${e.payee_supplier}`
                          : "المورد الأساسي"}
                    </td>
                    <td className="cell-num">{money(e.amount)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={4}>إجمالي المصاريف الموزعة على الأصناف</td>
                  <td className="cell-num">{money(invoice.shipping_cost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: "min(100%, 240px)", flex: 1 }}>
            {payments.length > 0 ? (
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
            ) : (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>فاتورة آجلة بالكامل</div>
            )}
            {invoice.notes ? (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <strong>ملاحظات:</strong> {invoice.notes}
              </div>
            ) : null}
          </div>

          <table style={{ minWidth: "min(100%, 280px)", fontSize: 13.5 }}>
            <tbody>
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>الإجمالي</td>
                <td className="cell-num">{money(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>الخصم</td>
                <td className="cell-num">{money(invoice.discount_total)}</td>
              </tr>
              {taxEnabled ? (
                <tr>
                  <td style={{ padding: "5px 0", color: "var(--muted)" }}>الضريبة</td>
                  <td className="cell-num">{money(invoice.tax_total)}</td>
                </tr>
              ) : null}
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>مصاريف مستحقة للمورد الأساسي</td>
                <td className="cell-num">{money(owedExpenses)}</td>
              </tr>
              <tr style={{ fontWeight: 700, fontSize: 15 }}>
                <td style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>الإجمالي النهائي</td>
                <td className="cell-num" style={{ borderTop: "1px solid var(--border)" }}>{money(invoice.total)}</td>
              </tr>
              <tr>
                <td style={{ padding: "5px 0", color: "var(--muted)" }}>المدفوع</td>
                <td className="cell-num">{money(invoice.paid_total)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td style={{ padding: "5px 0" }}>المتبقي للمورد</td>
                <td className="cell-num"><Money value={invoice.remaining} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {isPosted ? (
        <Card title="القيد المحاسبي" padded={false}>
          <JournalView docType="purchase_invoice" docId={id} />
        </Card>
      ) : null}
    </>
  );
}
