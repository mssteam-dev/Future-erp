import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings } from "@/lib/data";
import { money, qty } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const columns: ReportCol[] = [
  { key: "branch_name", label: "الجهة" },
  { key: "product_code", label: "الكود" },
  { key: "product_name", label: "المنتج" },
  { key: "received_date", label: "تاريخ الاستلام", kind: "date" },
  { key: "doc_no", label: "المستند / الشحنة" },
  { key: "original_qty", label: "الكمية الأصلية", kind: "qty", total: true },
  { key: "remaining_qty", label: "المتبقي", kind: "qty", total: true },
  { key: "unit_cost", label: "تكلفة القطعة", kind: "money" },
  { key: "remaining_value", label: "قيمة المتبقي", kind: "money", total: true },
];

export default async function StockLayersReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const branch = sp.branch || null;
  const openOnly = sp.open !== "all";
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_stock_layers($1::uuid, null, $2)",
    [branch, openOnly],
  );
  const remaining = rows.reduce((a, r) => a + Number(r.remaining_value ?? 0), 0);
  const pieces = rows.reduce((a, r) => a + Number(r.remaining_qty ?? 0), 0);

  return (
    <ReportView
      title="دفعات المخزون (FIFO)"
      subtitle="كل دفعة بتكلفتها الأصلية وتاريخ استلامها؛ المبيعات تستهلك الأقدم أولًا"
      exportKey="stock-layers"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      showPeriod={false}
      extraFilters={[
        {
          name: "open",
          label: "الدفعات",
          options: [
            { value: "", label: "المفتوحة فقط" },
            { value: "all", label: "كل الدفعات" },
          ],
        },
      ]}
      stats={[
        { label: "عدد الدفعات", value: String(rows.length) },
        { label: "القطع المتبقية", value: qty(pieces) },
        { label: "قيمة المتبقي", value: money(remaining), tone: "brand" },
      ]}
    />
  );
}
