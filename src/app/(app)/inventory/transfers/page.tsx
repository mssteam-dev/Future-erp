import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select t.id, t.transfer_no, t.transfer_date, t.total_cost, t.status, t.notes,
            fb.name_ar as from_name, tb.name_ar as to_name,
            (select count(*) from stock_transfer_lines l where l.transfer_id = t.id) as line_count
       from stock_transfers t
       join branches fb on fb.id = t.from_branch_id
       join branches tb on tb.id = t.to_branch_id
      where t.transfer_date between $1::date and $2::date
      order by t.transfer_date desc, t.transfer_no desc`,
    [from, to],
  );

  return (
    <>
      <PageHeader
        title="تحويل البضائع بين الوحدات"
        subtitle="نقل مخزون وتكلفة — بلا إيراد ولا مصروف"
        action={<LinkButton href="/inventory/transfers/new">+ تحويل جديد</LinkButton>}
      />
      <Filters branches={branches} showBranch={false} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد تحويلات في هذه الفترة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>من</th>
                <th>إلى</th>
                <th className="cell-num">عدد الأصناف</th>
                <th className="cell-num">التكلفة المحوَّلة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/inventory/transfers/${r.id}`} className="num" style={{ color: "var(--brand)", fontWeight: 600 }}>
                      {r.transfer_no}
                    </Link>
                  </td>
                  <td className="num">{dateStr(r.transfer_date)}</td>
                  <td>{r.from_name}</td>
                  <td>{r.to_name}</td>
                  <td className="cell-num">{r.line_count}</td>
                  <td className="cell-num">{money(r.total_cost)}</td>
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
