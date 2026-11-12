import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Grid, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CollectionsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const rows = await queryAs<Record<string, string>>(
    "select * from report_collections($1::date, $2::date, $3::uuid)",
    [from, to, branch],
  );
  const aging = await queryAs<Record<string, string>>(
    "select * from report_receivables_aging($1::date)",
    [to],
  );

  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const cash = rows.filter((r) => r.method === "cash").reduce((a, r) => a + Number(r.amount), 0);
  const totalDue = aging.reduce((a, r) => a + Number(r.balance), 0);

  return (
    <>
      <PageHeader title="تقرير التحصيلات والذمم" />
      <Filters exportReport="collections" branches={branches} />

      <Grid cols={4}>
        <Stat label="إجمالي التحصيلات" value={money(total)} tone="brand" />
        <Stat label="تحصيل نقدي" value={money(cash)} />
        <Stat label="تحصيل بنكي" value={money(total - cash)} />
        <Stat label="الذمم المتبقية" value={money(totalDue)} tone={totalDue ? "bad" : "default"} />
      </Grid>

      <div className="card print-full" style={{ padding: 20, marginBottom: 16 }}>
        <PrintHeader
          company={settings}
          title="تقرير التحصيلات"
          extra={[{ label: "الفترة", value: `${from} — ${to}` }]}
        />
        {rows.length === 0 ? (
          <Empty message="لا توجد تحصيلات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>رقم السند</th>
                <th>الفرع</th>
                <th>العميل</th>
                <th>طريقة التحصيل</th>
                <th>الحساب</th>
                <th className="cell-num">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="num">{dateStr(r.collection_date)}</td>
                  <td className="num">{r.collection_no}</td>
                  <td>{r.branch_name}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.method === "cash" ? "نقدًا" : "بنك"}</td>
                  <td>{r.treasury_name}</td>
                  <td className="cell-num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>الإجمالي</td>
                <td className="cell-num">{money(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginTop: 0 }}>أرصدة الذمم المدينة</h2>
        {aging.length === 0 ? (
          <Empty message="لا توجد ذمم" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>العميل</th>
                <th className="cell-num">الرصيد</th>
                <th className="cell-num">الحد الائتماني</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((r) => (
                <tr key={r.customer_id}>
                  <td className="num">{r.customer_code}</td>
                  <td>{r.customer_name}</td>
                  <td className="cell-num">{money(r.balance)}</td>
                  <td className="cell-num">{money(r.credit_limit)}</td>
                  <td>
                    {String(r.over_limit) === "true" ? (
                      <span className="badge badge-cancelled">تجاوز الحد</span>
                    ) : (
                      <span className="badge badge-posted">ضمن الحد</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>الإجمالي</td>
                <td className="cell-num">{money(totalDue)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
