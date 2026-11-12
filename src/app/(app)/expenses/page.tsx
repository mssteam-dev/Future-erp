import { queryAs } from "@/lib/auth";
import { getBranches, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import { cancelExpense } from "@/lib/actions/admin";
import Filters from "@/components/Filters";
import { Card, Empty, Grid, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const MODE: Record<string, string> = { cash: "نقدًا", bank: "بنك", unpaid: "مستحق غير مدفوع" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select e.*, b.name_ar as branch_name, et.name_ar as type_name, t.name_ar as treasury_name,
            coalesce((select sum(s.amount) from expense_settlements s
                       where s.expense_id = e.id and s.status='posted'), 0) as settled
       from expenses e
       join branches b on b.id = e.branch_id
       join expense_types et on et.id = e.expense_type_id
       left join treasury_accounts t on t.id = e.treasury_account_id
      where e.expense_date between $1::date and $2::date
        and ($3::uuid is null or e.branch_id = $3::uuid)
      order by e.expense_date desc, e.expense_no desc`,
    [from, to, branch],
  );

  const posted = rows.filter((r) => r.status === "posted");
  const total = posted.reduce((a, r) => a + Number(r.amount), 0);
  const adminTotal = posted.filter((r) => String(r.is_admin) === "true").reduce((a, r) => a + Number(r.amount), 0);
  const unpaid = posted.filter((r) => r.payment_mode === "unpaid")
    .reduce((a, r) => a + Number(r.amount) - Number(r.settled), 0);

  const allocation = await queryAs<Record<string, string>>(
    "select * from admin_expense_allocation($1::date, $2::date)",
    [from, to],
  );

  return (
    <>
      <PageHeader
        title="المصاريف"
        subtitle="مصاريف الفروع التشغيلية والمصاريف الإدارية للشركة الأم"
        action={<LinkButton href="/expenses/new">+ تسجيل مصروف</LinkButton>}
      />
      <Filters branches={branches} />

      <Grid cols={4}>
        <Stat label="إجمالي المصاريف" value={money(total)} tone="brand" />
        <Stat label="المصاريف الإدارية" value={money(adminTotal)} />
        <Stat label="مستحقة غير مدفوعة" value={money(unpaid)} tone={unpaid ? "bad" : "default"} />
        <Stat label="عدد القيود" value={String(posted.length)} />
      </Grid>

      {allocation.length > 0 ? (
        <Card title="توزيع المصاريف الإدارية على الفروع" padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th className="cell-num">النسبة</th>
                <th className="cell-num">النصيب المحمّل</th>
              </tr>
            </thead>
            <tbody>
              {allocation.map((a) => (
                <tr key={a.branch_id}>
                  <td>{a.branch_name}</td>
                  <td className="cell-num">{Number(a.share_pct).toFixed(2)}%</td>
                  <td className="cell-num">{money(a.allocated_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>الإجمالي الموزَّع</td>
                <td></td>
                <td className="cell-num">
                  {money(allocation.reduce((a, r) => a + Number(r.allocated_amount), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      ) : null}

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد مصاريف في هذه الفترة" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>الوحدة</th>
                  <th>نوع المصروف</th>
                  <th>البيان</th>
                  <th>طريقة الدفع</th>
                  <th>قابل للتوزيع</th>
                  <th className="cell-num">المبلغ</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.expense_no}</td>
                    <td className="num">{dateStr(r.expense_date)}</td>
                    <td>{r.branch_name}</td>
                    <td>{r.type_name}</td>
                    <td style={{ color: "var(--muted)" }}>{r.description}</td>
                    <td>
                      {MODE[r.payment_mode]}
                      {r.treasury_name ? ` — ${r.treasury_name}` : ""}
                    </td>
                    <td>{String(r.is_allocatable) === "true" ? "نعم" : "—"}</td>
                    <td className="cell-num">{money(r.amount)}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>
                      {r.status === "posted" ? (
                        <form action={cancelExpense}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="btn btn-danger btn-sm">إلغاء</button>
                        </form>
                      ) : null}
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
