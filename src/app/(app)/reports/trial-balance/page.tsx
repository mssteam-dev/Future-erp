import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Money, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصاريف",
};

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const rows = await queryAs<Record<string, string>>(
    "select * from report_trial_balance($1::date, $2::date, $3::uuid)",
    [from, to, branch],
  );

  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const balanced = Math.abs(sum("period_debit") - sum("period_credit")) < 0.001;

  return (
    <>
      <PageHeader title="ميزان المراجعة" subtitle="أرصدة الحسابات من دفتر الأستاذ" />
      <Filters exportReport="trial-balance" branches={branches} />

      {!balanced ? (
        <div className="alert alert-error" style={{ marginBottom: 14 }}>
          تنبيه: مجموع المدين لا يساوي مجموع الدائن — راجع القيود.
        </div>
      ) : null}

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="ميزان المراجعة"
          extra={[{ label: "الفترة", value: `${from} — ${to}` }]}
        />
        {rows.length === 0 ? (
          <Empty message="لا توجد حركات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>اسم الحساب</th>
                <th>النوع</th>
                <th className="cell-num">رصيد أول المدة</th>
                <th className="cell-num">حركة مدينة</th>
                <th className="cell-num">حركة دائنة</th>
                <th className="cell-num">الرصيد الختامي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account_id}>
                  <td className="num">{r.account_code}</td>
                  <td>{r.account_name}</td>
                  <td style={{ color: "var(--muted)" }}>{TYPE_LABEL[r.account_type]}</td>
                  <td className="cell-num"><Money value={r.opening_balance} /></td>
                  <td className="cell-num">{money(r.period_debit)}</td>
                  <td className="cell-num">{money(r.period_credit)}</td>
                  <td className="cell-num" style={{ fontWeight: 600 }}><Money value={r.closing_balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>الإجمالي</td>
                <td className="cell-num">{money(sum("period_debit"))}</td>
                <td className="cell-num">{money(sum("period_credit"))}</td>
                <td className="cell-num">{money(sum("closing_balance"))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
