import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings } from "@/lib/data";
import { money } from "@/lib/format";
import ReportView, { type ReportCol } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const columns: ReportCol[] = [
  { key: "branch_name", label: "الجهة" },
  { key: "product_code", label: "الكود" },
  { key: "product_name", label: "المنتج" },
  { key: "supplier_name", label: "المورد" },
  { key: "base_price", label: "السعر الأساسي", kind: "money" },
  { key: "loaded_expense", label: "مصاريف محمّلة", kind: "money" },
  { key: "final_cost", label: "التكلفة النهائية", kind: "money" },
  { key: "sale_price", label: "سعر البيع", kind: "money" },
  { key: "unit_weight_kg", label: "وزن القطعة", kind: "qty" },
  { key: "qty_available", label: "المتاح", kind: "qty", total: true },
  { key: "qty_sold", label: "المباع", kind: "qty", total: true },
  { key: "qty_returned", label: "المرتجع", kind: "qty", total: true },
  { key: "stock_value", label: "قيمة المخزون", kind: "money", total: true },
];

export default async function ProductCostsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const branch = sp.branch || null;
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);
  const rows = await queryAs<Record<string, unknown>>(
    "select * from report_product_costs($1::uuid)",
    [branch],
  );
  const value = rows.reduce((a, r) => a + Number(r.stock_value ?? 0), 0);

  return (
    <ReportView
      title="بطاقات تكلفة المنتجات"
      subtitle="التكلفة المعروضة من آخر شحنة؛ التكلفة الفعلية للبيع تُحسب من الدفعات"
      exportKey="product-costs"
      branches={branches}
      settings={settings}
      columns={columns}
      rows={rows}
      showPeriod={false}
      stats={[
        { label: "عدد البطاقات", value: String(rows.length) },
        { label: "قيمة المخزون", value: money(value), tone: "brand" },
      ]}
    />
  );
}
