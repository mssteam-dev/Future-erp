import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, Money, PageHeader, StatusBadge, Stat, Grid } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SalesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const status = sp.status || "";
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select i.id, i.invoice_no, i.invoice_date, b.name_ar as branch_name,
            coalesce(c.name, i.customer_name, 'عميل نقدي') as customer,
            i.total, i.paid_total, i.remaining, i.cogs_total, i.status
       from sales_invoices i
       join branches b on b.id = i.branch_id
       left join customers c on c.id = i.customer_id
      where i.invoice_date between $1::date and $2::date
        and ($3::uuid is null or i.branch_id = $3::uuid)
        and ($4 = '' or i.status = $4::doc_status)
      order by i.invoice_date desc, i.invoice_no desc
      limit 500`,
    [from, to, branch, status],
  );

  const posted = rows.filter((r) => r.status === "posted");
  const sum = (key: string) => posted.reduce((a, r) => a + Number(r[key] ?? 0), 0);

  return (
    <>
      <PageHeader
        title="فواتير المبيعات"
        subtitle={`${rows.length} فاتورة في الفترة`}
        action={<LinkButton href="/sales/new">+ فاتورة جديدة</LinkButton>}
      />

      <Filters
        branches={branches}
        extra={[
          {
            name: "status",
            label: "الحالة",
            options: [
              { value: "", label: "الكل" },
              { value: "posted", label: "مرحّلة" },
              { value: "draft", label: "مسودة" },
              { value: "cancelled", label: "ملغاة" },
            ],
          },
        ]}
      />

      <Grid cols={4}>
        <Stat label="عدد الفواتير المرحّلة" value={String(posted.length)} />
        <Stat label="إجمالي المبيعات" value={money(sum("total"))} tone="brand" />
        <Stat label="المحصّل" value={money(sum("paid_total"))} />
        <Stat label="المتبقي على العملاء" value={money(sum("remaining"))} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد فواتير في هذه الفترة" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>رقم الفاتورة</th>
                  <th>التاريخ</th>
                  <th>الفرع</th>
                  <th>العميل</th>
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
                      <Link
                        href={`/sales/${r.id}`}
                        className="num"
                        style={{ color: "var(--brand)", fontWeight: 600 }}
                      >
                        {r.invoice_no}
                      </Link>
                    </td>
                    <td className="num">{dateStr(r.invoice_date)}</td>
                    <td>{r.branch_name}</td>
                    <td>{r.customer}</td>
                    <td className="cell-num">
                      <Money value={r.total} />
                    </td>
                    <td className="cell-num">
                      <Money value={r.paid_total} />
                    </td>
                    <td className="cell-num">
                      <Money value={r.remaining} />
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
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
