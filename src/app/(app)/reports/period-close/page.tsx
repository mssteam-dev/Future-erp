import Link from "next/link";
import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings } from "@/lib/data";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const columns: ReportCol[] = [
  { key: "branch_name", label: "الجهة" },
  { key: "net_sales", label: "صافي المبيعات", kind: "money", total: true },
  { key: "purchases", label: "المشتريات", kind: "money", total: true },
  { key: "cogs", label: "تكلفة المبيعات", kind: "money", total: true },
  { key: "gross_profit", label: "مجمل الربح", kind: "money", total: true },
  { key: "total_expenses", label: "المصاريف", kind: "money", total: true },
  { key: "net_profit", label: "صافي الربح", kind: "money", total: true },
  { key: "inventory_value", label: "المخزون", kind: "money", total: true },
  { key: "cash_balance", label: "الصندوق", kind: "money", total: true },
  { key: "bank_balance", label: "البنك", kind: "money", total: true },
  { key: "receivables", label: "الذمم المدينة", kind: "money", total: true },
  { key: "payables", label: "الذمم الدائنة", kind: "money", total: true },
  { key: "prepaid_balance", label: "مدفوع مقدمًا", kind: "money", total: true },
];

export default async function PeriodCloseReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const [period] = await queryAs<{ status: string }>(
    "select status from fiscal_periods where year = $1 and month = $2",
    [year, month],
  );
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_period_close($1, $2)",
    [year, month],
  );

  return (
    <ReportView
      title={`تقرير إقفال شهر ${MONTHS[month - 1]} ${year}`}
      subtitle={
        period?.status === "closed"
          ? "أرقام مثبّتة وقت الإقفال لا تتغير"
          : "الشهر غير مقفل — الأرقام حيّة وتتغير مع كل عملية"
      }
      exportKey="period-close"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      showPeriod={false}
      showBranch={false}
      extraFilters={[
        {
          name: "month",
          label: "الشهر",
          options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
          defaultValue: String(month),
        },
        {
          name: "year",
          label: "السنة",
          options: [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => ({
            value: String(y),
            label: String(y),
          })),
          defaultValue: String(year),
        },
      ]}
      note={
        <>
          الإقفال وإعادة الفتح من <Link href="/settings/periods">شاشة الفترات والإقفال</Link>.
        </>
      }
    />
  );
}
