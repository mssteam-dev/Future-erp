import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const MODE: Record<string, string> = { credit: "خصم من الذمة", cash: "رد نقدي", bank: "رد بنكي" };

export default async function SalesReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select r.*, b.name_ar as branch_name, coalesce(c.name, 'عميل نقدي') as customer_name,
            i.invoice_no
       from sales_returns r
       join branches b on b.id = r.branch_id
       left join customers c on c.id = r.customer_id
       left join sales_invoices i on i.id = r.invoice_id
      where r.return_date between $1::date and $2::date
        and ($3::uuid is null or r.branch_id = $3::uuid)
      order by r.return_date desc, r.return_no desc`,
    [from, to, branch],
  );

  return (
    <>
      <PageHeader
        title="مرتجعات المبيعات"
        action={<LinkButton href="/sales/returns/new">+ مرتجع جديد</LinkButton>}
      />
      <Filters branches={branches} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد مرتجعات في هذه الفترة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>الفرع</th>
                <th>العميل</th>
                <th>الفاتورة الأصلية</th>
                <th>المعالجة</th>
                <th className="cell-num">القيمة</th>
                <th className="cell-num">التكلفة المعادة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/sales/returns/${r.id}`} className="num" style={{ color: "var(--brand)", fontWeight: 600 }}>
                      {r.return_no}
                    </Link>
                  </td>
                  <td className="num">{dateStr(r.return_date)}</td>
                  <td>{r.branch_name}</td>
                  <td>{r.customer_name}</td>
                  <td className="num">{r.invoice_no ?? "—"}</td>
                  <td>{MODE[r.refund_mode]}</td>
                  <td className="cell-num">{money(r.total)}</td>
                  <td className="cell-num">{money(r.cogs_total)}</td>
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
