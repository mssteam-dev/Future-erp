import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const columns: ReportCol[] = [
  { key: "branch_name", label: "الجهة" },
  { key: "external_sales", label: "مبيعات خارجية (صافي)", kind: "money", total: true },
  { key: "other_revenue", label: "إيرادات أخرى", kind: "money", total: true },
  { key: "cogs", label: "تكلفة المبيعات", kind: "money", total: true },
  { key: "gross_profit", label: "مجمل الربح", kind: "money", total: true },
  { key: "operating_expenses", label: "المصاريف", kind: "money", total: true },
  { key: "net_profit", label: "صافي الربح", kind: "money", total: true },
  { key: "transfers_out", label: "تحويلات صادرة", kind: "money", total: true },
  { key: "transfers_in", label: "تحويلات واردة", kind: "money", total: true },
];

export default async function ConsolidatedReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const { from, to } = periodFrom(await searchParams);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_consolidated($1::date, $2::date)",
    [from, to],
  );
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const profit = sum("net_profit");

  return (
    <ReportView
      title="التقرير المجمّع للشركة"
      subtitle="الإيراد الخارجي منفصل عن التحويلات الداخلية، والمصاريف الإدارية تُحسب مرة واحدة"
      exportKey="consolidated"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      showBranch={false}
      periodLabel={`${from} — ${to}`}
      note="التحويلات الداخلية تُعرض بتكلفتها الأصلية للمطابقة فقط، ولا تدخل في الإيراد ولا الربح، ويتساوى مجموع الصادر والوارد منها."
      stats={[
        { label: "المبيعات الخارجية", value: money(sum("external_sales")) },
        { label: "إيرادات أخرى", value: money(sum("other_revenue")) },
        { label: "صافي ربح المجموعة", value: money(profit), tone: profit >= 0 ? "good" : "bad" },
        { label: "التحويلات الداخلية", value: money(sum("transfers_out")) },
      ]}
    />
  );
}
