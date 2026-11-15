import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { money, qty } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = { qty: "بالقطع", weight: "بالوزن", value: "بالقيمة" };

const columns: ReportCol[] = [
  { key: "invoice_no", label: "رقم الفاتورة" },
  { key: "shipment_no", label: "رقم الشحنة" },
  { key: "invoice_date", label: "التاريخ", kind: "date" },
  { key: "branch_name", label: "الجهة" },
  { key: "supplier_name", label: "المورد" },
  { key: "carrier", label: "جهة الشحن" },
  { key: "alloc_method", label: "التوزيع", format: (v) => METHOD[String(v)] ?? String(v ?? "") },
  { key: "pieces", label: "القطع", kind: "qty", total: true },
  { key: "total_weight_kg", label: "الوزن (كجم)", kind: "qty", total: true },
  { key: "goods_value", label: "قيمة البضاعة", kind: "money", total: true },
  { key: "freight", label: "الشحن", kind: "money", total: true },
  { key: "customs", label: "التخليص", kind: "money", total: true },
  { key: "transport", label: "النقل", kind: "money", total: true },
  { key: "insurance", label: "التأمين", kind: "money", total: true },
  { key: "other_expenses", label: "أخرى", kind: "money", total: true },
  { key: "total_expenses", label: "إجمالي المصاريف", kind: "money", total: true },
  { key: "landed_total", label: "الإجمالي بعد المصاريف", kind: "money", total: true },
  { key: "per_kg_cost", label: "مصاريف الكيلو", kind: "money" },
  { key: "per_piece_cost", label: "مصاريف القطعة", kind: "money" },
];

export default async function ShipmentsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const { from, to, branch } = periodFrom(await searchParams);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_shipments($1::date, $2::date, $3::uuid)",
    [from, to, branch],
  );
  const num = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);

  return (
    <ReportView
      title="تقرير الشحنات"
      subtitle="كل شحنة مستقلة بمصاريفها وتكلفتها وطريقة توزيعها"
      exportKey="shipments"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      periodLabel={`${from} — ${to}`}
      stats={[
        { label: "عدد الشحنات", value: String(rows.length) },
        { label: "إجمالي القطع", value: qty(num("pieces")) },
        { label: "إجمالي المصاريف", value: money(num("total_expenses")), tone: "brand" },
        { label: "الإجمالي بعد المصاريف", value: money(num("landed_total")) },
      ]}
    />
  );
}
