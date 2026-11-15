import { requirePermission } from "@/lib/auth";
import { getBranches, getProducts } from "@/lib/data";
import { getStockByBranch } from "@/lib/stock";
import { AdjustmentForm } from "@/components/doc/InventoryForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewAdjustmentPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  await requirePermission("inventory.create");
  const { kind } = await searchParams;
  const initialKind = kind === "opening" || kind === "adjustment" ? kind : "count";
  const [branches, products, stock] = await Promise.all([
    getBranches(),
    getProducts(),
    getStockByBranch(),
  ]);

  return (
    <>
      <PageHeader
        title={initialKind === "opening" ? "مخزون أول المدة" : "تسوية مخزنية / جرد"}
        subtitle={
          initialKind === "opening"
            ? "أدخل كمية كل منتج وتكلفته أول المدة — يُسجَّل رصيدًا افتتاحيًا لا إيرادًا"
            : "أدخل الجرد الفعلي ويحتسب النظام الفرق عن الرصيد الدفتري"
        }
      />
      <AdjustmentForm
        branches={branches}
        products={products}
        stockByBranch={stock}
        initialKind={initialKind}
      />
    </>
  );
}
