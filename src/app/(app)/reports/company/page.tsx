import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Card, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CompanyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const [s] = await queryAs<Record<string, string>>(
    "select * from report_company_summary($1::date, $2::date)",
    [from, to],
  );
  const branchRows = await queryAs<Record<string, string>>(
    "select * from report_branch_financial($1::date, $2::date, null)",
    [from, to],
  );

  const lines: [string, string, boolean?][] = [
    ["صافي مبيعات الفروع", s?.branches_net_sales],
    ["تكلفة البضاعة المباعة", s?.branches_cogs],
    ["مجمل ربح الفروع", s?.branches_gross_profit, true],
    ["المصاريف التشغيلية المباشرة للفروع", s?.branches_direct_expenses],
    ["المصاريف الإدارية الكلية للشركة الأم", s?.admin_expenses_total],
    ["منها: الموزَّع على الفروع", s?.admin_allocated_to_branches],
    ["صافي أرباح الفروع بعد تحميل نصيبها الإداري", s?.branches_net_profit, true],
    ["مصاريف الشركة الأم غير الموزَّعة", s?.parent_unallocated_expenses],
    ["الربح قبل إضافة إيراد الشركة الأم", s?.profit_before_parent_revenue, true],
    ["إيراد نشاط الشركة الأم", s?.parent_revenue],
    ["الربح بعد إضافة إيراد الشركة الأم", s?.profit_after_parent_revenue, true],
  ];

  return (
    <>
      <PageHeader
        title="ملخص الشركة"
        subtitle="إيراد الشركة الأم منفصل عن إيرادات الفروع، مع الربح قبل إضافته وبعده"
      />
      <Filters exportReport="company" branches={branches} showBranch={false} />

      <Grid cols={4}>
        <Stat label="صافي مبيعات الفروع" value={money(s?.branches_net_sales)} />
        <Stat label="إيراد الشركة الأم" value={money(s?.parent_revenue)} />
        <Stat
          label="الربح قبل إضافة إيراد الشركة الأم"
          value={money(s?.profit_before_parent_revenue)}
          tone={Number(s?.profit_before_parent_revenue ?? 0) >= 0 ? "good" : "bad"}
        />
        <Stat
          label="الربح بعد إضافته"
          value={money(s?.profit_after_parent_revenue)}
          tone={Number(s?.profit_after_parent_revenue ?? 0) >= 0 ? "good" : "bad"}
        />
      </Grid>

      <div className="card print-full" style={{ padding: 20, marginBottom: 16 }}>
        <PrintHeader
          company={settings}
          title="الملخص المالي الموحَّد"
          extra={[{ label: "الفترة", value: `${from} — ${to}` }]}
        />
        <table className="table">
          <tbody>
            {lines.map(([label, value, strong]) => (
              <tr key={label} style={strong ? { background: "#f7f9fd", fontWeight: 700 } : undefined}>
                <td>{label}</td>
                <td className="cell-num" style={{ width: 200 }}>
                  <Money value={value} tone={Boolean(strong)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card title="تفصيل الوحدات" padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>الوحدة</th>
              <th className="cell-num">صافي المبيعات</th>
              <th className="cell-num">مجمل الربح</th>
              <th className="cell-num">المصاريف المباشرة</th>
              <th className="cell-num">النصيب الإداري</th>
              <th className="cell-num">صافي الربح</th>
            </tr>
          </thead>
          <tbody>
            {branchRows.map((r) => (
              <tr key={r.branch_id}>
                <td style={{ fontWeight: 600 }}>
                  {r.branch_name}
                  {r.branch_kind === "parent" ? (
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}> (الشركة الأم)</span>
                  ) : null}
                </td>
                <td className="cell-num">{money(r.net_sales)}</td>
                <td className="cell-num">{money(r.gross_profit)}</td>
                <td className="cell-num">{money(r.direct_expenses)}</td>
                <td className="cell-num">{money(r.admin_share)}</td>
                <td className="cell-num"><Money value={r.net_profit} tone /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
