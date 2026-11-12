import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import { cancelCollection } from "@/lib/actions/treasury";
import Filters from "@/components/Filters";
import { Card, Empty, Grid, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select c.*, b.name_ar as branch_name, cu.name as customer_name, t.name_ar as treasury_name
       from collections c
       join branches b on b.id = c.branch_id
       join customers cu on cu.id = c.customer_id
       join treasury_accounts t on t.id = c.treasury_account_id
      where c.collection_date between $1::date and $2::date
        and ($3::uuid is null or c.branch_id = $3::uuid)
      order by c.collection_date desc, c.collection_no desc`,
    [from, to, branch],
  );

  const total = rows.filter((r) => r.status === "posted").reduce((a, r) => a + Number(r.amount), 0);

  return (
    <>
      <PageHeader
        title="تحصيلات العملاء"
        subtitle="التحصيل يخفض الذمة ويزيد النقدية — وليس إيرادًا جديدًا"
        action={<LinkButton href="/treasury/collections/new">+ سند قبض</LinkButton>}
      />
      <Filters branches={branches} />
      <Grid cols={2}>
        <Stat label="إجمالي التحصيلات" value={money(total)} tone="brand" />
        <Stat label="عدد السندات" value={String(rows.length)} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد تحصيلات في هذه الفترة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>رقم السند</th>
                <th>التاريخ</th>
                <th>الفرع</th>
                <th>العميل</th>
                <th>الحساب</th>
                <th className="cell-num">المبلغ</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.collection_no}</td>
                  <td className="num">{dateStr(r.collection_date)}</td>
                  <td>{r.branch_name}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.treasury_name}</td>
                  <td className="cell-num">{money(r.amount)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    {r.status === "posted" ? (
                      <form action={cancelCollection}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="btn btn-danger btn-sm">إلغاء</button>
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
