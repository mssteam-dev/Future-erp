import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getTreasuryAccounts } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import { amortizePrepaid, cancelPrepaidExpense } from "@/lib/actions/prepaid";
import PrepaidForm from "@/components/doc/PrepaidForm";
import { Card, Empty, Field, FormRow, Grid, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { posted: "قائم", cancelled: "ملغى", draft: "مسودة" };

export default async function PrepaidExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; amortized?: string }>;
}) {
  await requirePermission("expenses.view");
  const { error, saved, amortized } = await searchParams;

  const [branches, treasury, types, rows] = await Promise.all([
    getBranches(),
    getTreasuryAccounts(),
    queryAs<{ id: string; name_ar: string }>(
      "select id, name_ar from expense_types where is_active and not is_admin order by name_ar",
    ),
    queryAs<Record<string, string>>(
      "select * from report_prepaid(null) order by pay_date desc, prepaid_no desc",
    ),
  ]);

  const live = rows.filter((r) => r.status === "posted");
  const remaining = live.reduce((a, r) => a + Number(r.remaining_amount), 0);
  const monthlyLoad = live
    .filter((r) => Number(r.months_charged) < Number(r.months))
    .reduce((a, r) => a + Number(r.monthly_amount), 0);

  const now = new Date();

  return (
    <>
      <PageHeader
        title="المصاريف المدفوعة مقدمًا"
        subtitle="تُسجَّل أصلًا وتُحمَّل أقساطها على الأشهر تلقائيًا عند الإقفال دون تكرار"
      />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {saved ? (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          تم تسجيل المصروف وإنشاء جدول أقساطه
        </div>
      ) : null}
      {amortized !== undefined ? (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          {Number(amortized) > 0
            ? `تم تحميل ${amortized} قسطًا على المصاريف`
            : "لا توجد أقساط مستحقة للتحميل"}
        </div>
      ) : null}

      <Grid cols={3}>
        <Stat label="مصاريف قائمة" value={String(live.length)} />
        <Stat label="رصيد المدفوع مقدمًا" value={money(remaining)} tone="brand" />
        <Stat label="أقساط شهرية جارية" value={money(monthlyLoad)} />
      </Grid>

      <PrepaidForm branches={branches} types={types} treasury={treasury} />

      <Card title="تحميل الأقساط المستحقة">
        <form action={amortizePrepaid}>
          <FormRow cols={3}>
            <Field label="حتى شهر">
              <select name="month" className="select" defaultValue={String(now.getMonth() + 1)}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="السنة">
              <input
                type="number"
                name="year"
                className="input input-num"
                defaultValue={now.getFullYear()}
              />
            </Field>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn btn-ghost">تحميل الأقساط</button>
            </div>
          </FormRow>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            يحمّل كل قسط لم يُحمَّل بعد حتى الشهر المختار. الشهر الذي حُمِّل مسبقًا لا يتكرر. الإقفال
            الشهري ينفّذ ذلك تلقائيًا.
          </div>
        </form>
      </Card>

      <Card title="سجل المصاريف المدفوعة مقدمًا" padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد مصاريف مدفوعة مقدمًا" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>البيان</th>
                  <th>الجهة</th>
                  <th>النوع</th>
                  <th>تاريخ الدفع</th>
                  <th className="cell-num">الأشهر</th>
                  <th className="cell-num">المبلغ</th>
                  <th className="cell-num">القسط</th>
                  <th className="cell-num">المحمّل</th>
                  <th className="cell-num">المتبقي</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.prepaid_id}>
                    <td className="num">{r.prepaid_no}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.branch_name}</td>
                    <td>{r.expense_type}</td>
                    <td className="num">{dateStr(r.pay_date)}</td>
                    <td className="cell-num">
                      {r.months_charged} / {r.months}
                    </td>
                    <td className="cell-num">{money(r.total_amount)}</td>
                    <td className="cell-num">{money(r.monthly_amount)}</td>
                    <td className="cell-num">{money(r.amortized_amount)}</td>
                    <td className="cell-num">{money(r.remaining_amount)}</td>
                    <td>
                      <span className={`badge badge-${r.status}`}>{STATUS[r.status] ?? r.status}</span>
                    </td>
                    <td>
                      {r.status === "posted" && Number(r.months_charged) === 0 ? (
                        <form action={cancelPrepaidExpense}>
                          <input type="hidden" name="id" value={r.prepaid_id} />
                          <input type="hidden" name="reason" value="إلغاء من شاشة المدفوع مقدمًا" />
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
