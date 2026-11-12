import { queryAs, requirePermission } from "@/lib/auth";
import { monthName } from "@/lib/format";
import { closeFiscalYear, closePeriod, reopenPeriod } from "@/lib/actions/admin";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; closed?: string; year_closed?: string }>;
}) {
  await requirePermission("settings.view");
  const { error, closed, year_closed } = await searchParams;

  const rows = await queryAs<Record<string, string>>(
    `select p.*, u.full_name as closed_by_name,
            (select count(*) from sales_invoices i
              where i.status = 'draft'
                and extract(year from i.invoice_date) = p.year
                and extract(month from i.invoice_date) = p.month) as draft_sales
       from fiscal_periods p
       left join app_users u on u.id = p.closed_by
      where p.year >= extract(year from current_date) - 1
      order by p.year desc, p.month desc`,
  );

  const years = [...new Set(rows.map((r) => r.year))];

  return (
    <>
      <PageHeader
        title="الفترات المالية والإقفال الشهري"
        subtitle="الأرصدة تُرحَّل تلقائيًا للشهر التالي — الإقفال يمنع أي حركة في الشهر المقفل"
      />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {closed ? <div className="alert alert-success" style={{ marginBottom: 14 }}>تم إقفال الشهر وفتح الشهر التالي</div> : null}
      {year_closed ? <div className="alert alert-success" style={{ marginBottom: 14 }}>تم إقفال السنة المالية وترحيل النتيجة للأرباح المدورة</div> : null}

      <Card padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>السنة</th>
              <th>الشهر</th>
              <th>الحالة</th>
              <th>تاريخ الإقفال</th>
              <th>أقفلها</th>
              <th className="cell-num">مسودات معلّقة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="num">{p.year}</td>
                <td>{monthName(Number(p.month))}</td>
                <td>
                  <span className={`badge badge-${p.status === "closed" ? "cancelled" : "posted"}`}>
                    {p.status === "closed" ? "مقفلة" : "مفتوحة"}
                  </span>
                </td>
                <td className="num">{p.closed_at ? String(p.closed_at).slice(0, 10) : ""}</td>
                <td>{p.closed_by_name ?? ""}</td>
                <td className="cell-num">{Number(p.draft_sales) || ""}</td>
                <td>
                  {p.status === "open" ? (
                    <form action={closePeriod}>
                      <input type="hidden" name="year" value={p.year} />
                      <input type="hidden" name="month" value={p.month} />
                      <button className="btn btn-ghost btn-sm">إقفال الشهر</button>
                    </form>
                  ) : (
                    <form action={reopenPeriod}>
                      <input type="hidden" name="year" value={p.year} />
                      <input type="hidden" name="month" value={p.month} />
                      <button className="btn btn-danger btn-sm">إعادة فتح</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="إقفال السنة المالية">
        <div className="alert alert-warning" style={{ fontSize: 13.5, marginBottom: 12 }}>
          إقفال السنة يرحّل أرصدة الإيرادات والمصاريف إلى الأرباح المدورة. نفّذه بعد إقفال كل أشهر السنة.
        </div>
        <form action={closeFiscalYear} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div>
            <label className="label">السنة</label>
            <select name="year" className="select" style={{ width: 150 }}>
              {years.map((y) => (<option key={y} value={y}>{y}</option>))}
            </select>
          </div>
          <button className="btn btn-primary">إقفال السنة</button>
        </form>
      </Card>
    </>
  );
}
