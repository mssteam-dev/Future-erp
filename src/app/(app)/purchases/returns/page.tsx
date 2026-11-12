import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import { postPurchaseReturn } from "@/lib/actions/purchases";
import Filters from "@/components/Filters";
import { Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const MODE: Record<string, string> = { credit: "خصم من الذمة", cash: "استرداد نقدي", bank: "استرداد بنكي" };

export default async function PurchaseReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select r.*, b.name_ar as branch_name, s.name as supplier_name
       from purchase_returns r
       join branches b on b.id = r.branch_id
       join suppliers s on s.id = r.supplier_id
      where r.return_date between $1::date and $2::date
        and ($3::uuid is null or r.branch_id = $3::uuid)
      order by r.return_date desc, r.return_no desc`,
    [from, to, branch],
  );

  return (
    <>
      <PageHeader
        title="مرتجعات المشتريات"
        action={<LinkButton href="/purchases/returns/new">+ مرتجع جديد</LinkButton>}
      />
      <Filters branches={branches} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد مرتجعات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>المورد</th>
                <th>الوحدة</th>
                <th>المعالجة</th>
                <th className="cell-num">الإجمالي</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.return_no}</td>
                  <td className="num">{dateStr(r.return_date)}</td>
                  <td>{r.supplier_name}</td>
                  <td>{r.branch_name}</td>
                  <td>{MODE[r.settle_mode]}</td>
                  <td className="cell-num">{money(r.total)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    {r.status === "draft" ? (
                      <form action={postPurchaseReturn}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-primary btn-sm">ترحيل</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
