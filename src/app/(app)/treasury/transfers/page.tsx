import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TreasuryTransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select t.*, fa.name_ar as from_name, ta.name_ar as to_name
       from treasury_transfers t
       join treasury_accounts fa on fa.id = t.from_account_id
       join treasury_accounts ta on ta.id = t.to_account_id
      where t.transfer_date between $1::date and $2::date
      order by t.transfer_date desc, t.transfer_no desc`,
    [from, to],
  );

  return (
    <>
      <PageHeader
        title="التحويل بين الصندوق والبنك"
        subtitle="حركة واحدة بطرفين — لا إيراد ولا مصروف ولا تغيّر في صافي النقدية"
        action={<LinkButton href="/treasury/transfers/new">+ تحويل</LinkButton>}
      />
      <Filters branches={branches} showBranch={false} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد تحويلات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>من حساب</th>
                <th>إلى حساب</th>
                <th className="cell-num">المبلغ</th>
                <th className="cell-num">الرسوم</th>
                <th>المرجع</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.transfer_no}</td>
                  <td className="num">{dateStr(r.transfer_date)}</td>
                  <td>{r.from_name}</td>
                  <td>{r.to_name}</td>
                  <td className="cell-num">{money(r.amount)}</td>
                  <td className="cell-num">{money(r.fees)}</td>
                  <td style={{ color: "var(--muted)" }}>{r.reference}</td>
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
