import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const columns: ReportCol[] = [
  { key: "branch_name", label: "الجهة" },
  { key: "account_code", label: "كود الحساب" },
  { key: "account_name", label: "المصروف" },
  { key: "is_admin", label: "النوع", format: (v) => (v === true || v === "true" ? "إداري" : "تشغيلي") },
  { key: "amount", label: "المبلغ", kind: "money", total: true },
];

export default async function OperatingExpensesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const { from, to, branch } = periodFrom(await searchParams);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_operating_expenses($1::date, $2::date, $3::uuid)",
    [from, to, branch],
  );
  const total = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);

  return (
    <ReportView
      title="المصاريف التشغيلية"
      subtitle="مصاريف التشغيل فقط — تكاليف الشحن والتخليص تدخل في تكلفة البضاعة ولا تظهر هنا"
      exportKey="operating-expenses"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      periodLabel={`${from} — ${to}`}
      stats={[{ label: "إجمالي المصاريف التشغيلية", value: money(total), tone: "brand" }]}
    />
  );
}
