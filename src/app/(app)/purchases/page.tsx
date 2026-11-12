import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, Grid, LinkButton, Money, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select i.id, i.invoice_no, i.invoice_date, i.supplier_ref_no, s.name as supplier,
            b.name_ar as branch_name, i.is_central, i.total, i.paid_total, i.remaining, i.status
       from purchase_invoices i
       join suppliers s on s.id = i.supplier_id
       join branches b on b.id = i.branch_id
      where i.invoice_date between $1::date and $2::date
        and ($3::uuid is null or i.branch_id = $3::uuid)
      order by i.invoice_date desc, i.invoice_no desc
      limit 500`,
    [from, to, branch],
  );

  const posted = rows.filter((r) => r.status === "posted");
  const sum = (k: string) => posted.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  return (
    <>
      <PageHeader
        title="فواتير المشتريات"
        subtitle="الشراء المركزي للشركة الأم أو الشراء المباشر للفروع"
        action={<LinkButton href="/purchases/new">+ فاتورة شراء</LinkButton>}
      />
      <Filters branches={branches} />

      <Grid cols={3}>
        <Stat label="إجمالي المشتريات" value={money(sum("total"))} tone="brand" />
        <Stat label="المدفوع" value={money(sum("paid_total"))} />
        <Stat label="المتبقي للموردين" value={money(sum("remaining"))} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد فواتير مشتريات في هذه الفترة" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>المورد</th>
                  <th>الجهة المستفيدة</th>
                  <th>النوع</th>
                  <th className="cell-num">الإجمالي</th>
                  <th className="cell-num">المدفوع</th>
                  <th className="cell-num">المتبقي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/purchases/${r.id}`} className="num" style={{ color: "var(--brand)", fontWeight: 600 }}>
                        {r.invoice_no}
                      </Link>
                    </td>
                    <td className="num">{dateStr(r.invoice_date)}</td>
                    <td>{r.supplier}</td>
                    <td>{r.branch_name}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12.5 }}>
                      {String(r.is_central) === "true" ? "مركزي" : "مباشر"}
                    </td>
                    <td className="cell-num"><Money value={r.total} /></td>
                    <td className="cell-num"><Money value={r.paid_total} /></td>
                    <td className="cell-num"><Money value={r.remaining} /></td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
