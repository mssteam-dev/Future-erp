import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { posted: "مرحّل", cancelled: "ملغى", draft: "مسودة" };

const columns: ReportCol[] = [
  { key: "transfer_no", label: "رقم التحويل" },
  { key: "transfer_date", label: "التاريخ", kind: "date" },
  { key: "from_branch", label: "من" },
  { key: "to_branch", label: "إلى" },
  { key: "lines_count", label: "الأصناف", kind: "qty" },
  { key: "total_qty", label: "الكمية", kind: "qty", total: true },
  { key: "total_cost", label: "التكلفة الأصلية", kind: "money", total: true },
  { key: "status", label: "الحالة", format: (v) => STATUS[String(v)] ?? String(v ?? "") },
];

export default async function TransfersReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const { from, to } = periodFrom(await searchParams);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_transfers($1::date, $2::date)",
    [from, to],
  );
  const posted = rows.filter((r) => r.status === "posted");
  const cost = posted.reduce((a, r) => a + Number(r.total_cost ?? 0), 0);

  return (
    <ReportView
      title="التحويلات بين الجهات"
      subtitle="تُنقل البضاعة بتكلفتها الأصلية دون إيراد أو ربح — لا أثر لها على نتيجة أي جهة"
      exportKey="transfers"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      showBranch={false}
      periodLabel={`${from} — ${to}`}
      stats={[
        { label: "تحويلات مرحّلة", value: String(posted.length) },
        { label: "إجمالي التكلفة المحوّلة", value: money(cost), tone: "brand" },
      ]}
    />
  );
}
