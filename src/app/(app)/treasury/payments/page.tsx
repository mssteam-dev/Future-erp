import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, Grid, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select p.*, b.name_ar as branch_name, s.name as supplier_name, t.name_ar as treasury_name
       from supplier_payments p
       join branches b on b.id = p.branch_id
       join suppliers s on s.id = p.supplier_id
       join treasury_accounts t on t.id = p.treasury_account_id
      where p.payment_date between $1::date and $2::date
        and ($3::uuid is null or p.branch_id = $3::uuid)
      order by p.payment_date desc, p.payment_no desc`,
    [from, to, branch],
  );

  const total = rows.filter((r) => r.status === "posted").reduce((a, r) => a + Number(r.amount), 0);

  return (
    <>
      <PageHeader
        title="مدفوعات الموردين"
        action={<LinkButton href="/treasury/payments/new">+ سند صرف</LinkButton>}
      />
      <Filters branches={branches} />
      <Grid cols={2}>
        <Stat label="إجمالي المدفوعات" value={money(total)} tone="brand" />
        <Stat label="عدد السندات" value={String(rows.length)} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد مدفوعات في هذه الفترة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>التاريخ</th>
                <th>الفرع</th>
                <th>المورد</th>
                <th>الحساب</th>
                <th className="cell-num">المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.payment_no}</td>
                  <td className="num">{dateStr(r.payment_date)}</td>
                  <td>{r.branch_name}</td>
                  <td>{r.supplier_name}</td>
                  <td>{r.treasury_name}</td>
                  <td className="cell-num">{money(r.amount)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
