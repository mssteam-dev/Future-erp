import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings } from "@/lib/data";
import { money } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { posted: "قائم", cancelled: "ملغى", draft: "مسودة", finished: "منتهٍ" };

const columns: ReportCol[] = [
  { key: "prepaid_no", label: "الرقم" },
  { key: "name", label: "البيان" },
  { key: "branch_name", label: "الجهة" },
  { key: "expense_type", label: "نوع المصروف" },
  { key: "pay_date", label: "تاريخ الدفع", kind: "date" },
  { key: "start_date", label: "من", kind: "date" },
  { key: "end_date", label: "إلى", kind: "date" },
  { key: "months", label: "الأشهر", kind: "qty" },
  { key: "total_amount", label: "المبلغ المدفوع", kind: "money", total: true },
  { key: "monthly_amount", label: "القسط الشهري", kind: "money" },
  { key: "months_charged", label: "أشهر محمّلة", kind: "qty" },
  { key: "amortized_amount", label: "المحمّل", kind: "money", total: true },
  { key: "remaining_amount", label: "المتبقي", kind: "money", total: true },
  { key: "status", label: "الحالة", format: (v) => STATUS[String(v)] ?? String(v ?? "") },
];

export default async function PrepaidReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_prepaid($1::uuid)",
    [sp.branch || null],
  );
  const live = rows.filter((r) => r.status === "posted");
  const remaining = live.reduce((a, r) => a + Number(r.remaining_amount ?? 0), 0);

  return (
    <ReportView
      title="المصاريف المدفوعة مقدمًا"
      subtitle="تُحمَّل أقساطها على مصروف كل شهر تلقائيًا عند الإقفال"
      exportKey="prepaid"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      showPeriod={false}
      stats={[
        { label: "مصاريف قائمة", value: String(live.length) },
        { label: "رصيد المدفوع مقدمًا", value: money(remaining), tone: "brand" },
      ]}
    />
  );
}
