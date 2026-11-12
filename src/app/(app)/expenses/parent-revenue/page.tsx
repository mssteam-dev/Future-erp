import { queryAs } from "@/lib/auth";
import { periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, Grid, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const MODE: Record<string, string> = { cash: "نقدًا", bank: "بنك", receivable: "آجل" };

export default async function ParentRevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);

  const rows = await queryAs<Record<string, string>>(
    `select r.*, rt.name_ar as type_name, t.name_ar as treasury_name, c.name as customer_name
       from parent_revenues r
       join revenue_types rt on rt.id = r.revenue_type_id
       left join treasury_accounts t on t.id = r.treasury_account_id
       left join customers c on c.id = r.customer_id
      where r.revenue_date between $1::date and $2::date
      order by r.revenue_date desc, r.revenue_no desc`,
    [from, to],
  );

  const total = rows.filter((r) => r.status === "posted").reduce((a, r) => a + Number(r.amount), 0);

  return (
    <>
      <PageHeader
        title="إيرادات الشركة الأم"
        subtitle="إيراد نشاط الشركة الأم وحدها — مبيعات الفروع لا تُسجَّل هنا"
        action={<LinkButton href="/expenses/parent-revenue/new">+ تسجيل إيراد</LinkButton>}
      />
      <Filters branches={[]} showBranch={false} />

      <Grid cols={2}>
        <Stat label="إجمالي إيراد الشركة الأم" value={money(total)} tone="brand" />
        <Stat label="عدد القيود" value={String(rows.length)} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد إيرادات مسجلة في هذه الفترة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>نوع الإيراد</th>
                <th>البيان</th>
                <th>طريقة القبض</th>
                <th className="cell-num">المبلغ</th>
                <th className="cell-num">الضريبة</th>
                <th className="cell-num">الإجمالي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.revenue_no}</td>
                  <td className="num">{dateStr(r.revenue_date)}</td>
                  <td>{r.type_name}</td>
                  <td style={{ color: "var(--muted)" }}>{r.description}</td>
                  <td>{MODE[r.receipt_mode]} {r.treasury_name ?? r.customer_name ?? ""}</td>
                  <td className="cell-num">{money(r.amount)}</td>
                  <td className="cell-num">{money(r.tax_amount)}</td>
                  <td className="cell-num">{money(r.total)}</td>
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
