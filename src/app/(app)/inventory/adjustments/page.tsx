import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  adjustment: "تسوية مخزنية",
  count: "جرد فعلي",
  opening: "رصيد أول المدة",
};

export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select a.*, b.name_ar as branch_name
       from stock_adjustments a join branches b on b.id = a.branch_id
      where a.adjustment_date between $1::date and $2::date
        and ($3::uuid is null or a.branch_id = $3::uuid)
      order by a.adjustment_date desc, a.adjustment_no desc`,
    [from, to, branch],
  );

  return (
    <>
      <PageHeader
        title="التسويات المخزنية والجرد"
        action={<LinkButton href="/inventory/adjustments/new">+ تسوية جديدة</LinkButton>}
      />
      <Filters branches={branches} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد تسويات في هذه الفترة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>الوحدة</th>
                <th>النوع</th>
                <th>السبب</th>
                <th className="cell-num">قيمة الزيادة</th>
                <th className="cell-num">قيمة العجز</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/inventory/adjustments/${r.id}`} className="num" style={{ color: "var(--brand)", fontWeight: 600 }}>
                      {r.adjustment_no}
                    </Link>
                  </td>
                  <td className="num">{dateStr(r.adjustment_date)}</td>
                  <td>{r.branch_name}</td>
                  <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td style={{ color: "var(--muted)" }}>{r.reason}</td>
                  <td className="cell-num">{money(r.total_in_cost)}</td>
                  <td className="cell-num">{money(r.total_out_cost)}</td>
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
