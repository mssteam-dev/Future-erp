import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money, pct } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Money, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = Record<string, string>;

const LINES: { label: string; key: string; kind?: "pct" | "head" }[] = [
  { label: "1. إجمالي المبيعات", key: "gross_sales" },
  { label: "2. مرتجعات المبيعات", key: "sales_returns" },
  { label: "   الخصومات الممنوحة", key: "sales_discounts" },
  { label: "3. صافي المبيعات", key: "net_sales", kind: "head" },
  { label: "4. تكلفة البضاعة المباعة", key: "cogs" },
  { label: "5. مجمل الربح", key: "gross_profit", kind: "head" },
  { label: "6. هامش الربح قبل المصاريف", key: "margin_before", kind: "pct" },
  { label: "7. المصاريف التشغيلية المباشرة", key: "direct_expenses" },
  { label: "8. نصيب الفرع من المصاريف الإدارية", key: "admin_share" },
  { label: "9. إجمالي المصاريف المحملة على الفرع", key: "total_expenses" },
  { label: "10. صافي الربح بعد المصاريف", key: "net_profit", kind: "head" },
  { label: "11. هامش الربح بعد المصاريف", key: "margin_after", kind: "pct" },
  { label: "12. إجمالي التحصيلات", key: "collections" },
  { label: "13. رصيد العملاء والذمم المدينة", key: "receivables" },
  { label: "14. قيمة المخزون", key: "inventory_value" },
  { label: "15. رصيد الصندوق", key: "cash_balance" },
  { label: "16. رصيد البنك", key: "bank_balance" },
];

export default async function BranchReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const rows = await queryAs<Row>(
    "select * from report_branch_financial($1::date, $2::date, $3::uuid)",
    [from, to, branch],
  );
  const shown = rows.filter((r) => (branch ? true : r.branch_kind === "branch"));
  const total = (key: string) => shown.reduce((a, r) => a + Number(r[key] ?? 0), 0);

  return (
    <>
      <PageHeader title="التقرير المالي للفروع" subtitle="كل بنود التقرير للفترة المحددة" />
      <Filters exportReport="branches" branches={branches} />

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="التقرير المالي للفروع"
          extra={[{ label: "الفترة", value: `${from} — ${to}` }]}
        />

        {shown.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 260 }}>البند</th>
                  {shown.map((r) => (
                    <th key={r.branch_id} className="cell-num">{r.branch_name}</th>
                  ))}
                  {shown.length > 1 ? <th className="cell-num">الإجمالي الموحَّد</th> : null}
                </tr>
              </thead>
              <tbody>
                {LINES.map((line) => (
                  <tr
                    key={line.key + line.label}
                    style={line.kind === "head" ? { background: "#f7f9fd", fontWeight: 700 } : undefined}
                  >
                    <td>{line.label}</td>
                    {shown.map((r) => (
                      <td key={r.branch_id} className="cell-num">
                        {line.kind === "pct" ? pct(r[line.key]) : <Money value={r[line.key]} tone={line.key === "net_profit"} />}
                      </td>
                    ))}
                    {shown.length > 1 ? (
                      <td className="cell-num" style={{ fontWeight: 700 }}>
                        {line.kind === "pct"
                          ? pct(
                              total("net_sales") === 0
                                ? 0
                                : ((line.key === "margin_before" ? total("gross_profit") : total("net_profit")) /
                                    total("net_sales")) *
                                    100,
                            )
                          : money(total(line.key))}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
