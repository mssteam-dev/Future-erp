import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function VouchersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select v.*, b.name_ar as branch_name, t.name_ar as treasury_name,
            a.code as account_code, a.name_ar as account_name
       from vouchers v
       join branches b on b.id = v.branch_id
       join treasury_accounts t on t.id = v.treasury_account_id
       join accounts a on a.id = v.counter_account_id
      where v.voucher_date between $1::date and $2::date
        and ($3::uuid is null or v.branch_id = $3::uuid)
      order by v.voucher_date desc, v.voucher_no desc`,
    [from, to, branch],
  );

  return (
    <>
      <PageHeader
        title="سندات القبض والصرف"
        subtitle="للمقبوضات والمدفوعات التي لا تمر بالعملاء أو الموردين"
        action={<LinkButton href="/treasury/vouchers/new">+ سند جديد</LinkButton>}
      />
      <Filters branches={branches} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد سندات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>الفرع</th>
                <th>الحساب المقابل</th>
                <th>الجهة</th>
                <th className="cell-num">المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.voucher_no}</td>
                  <td className="num">{dateStr(r.voucher_date)}</td>
                  <td>{r.kind === "receipt" ? "سند قبض" : "سند صرف"}</td>
                  <td>{r.branch_name}</td>
                  <td>
                    <span className="num" style={{ color: "var(--muted)" }}>{r.account_code}</span> {r.account_name}
                  </td>
                  <td>{r.payee}</td>
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
