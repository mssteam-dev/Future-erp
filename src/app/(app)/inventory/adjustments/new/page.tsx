import { requirePermission } from "@/lib/auth";
import { getBranches, getProducts } from "@/lib/data";
import { getStockByBranch } from "@/lib/stock";
import { AdjustmentForm } from "@/components/doc/InventoryForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewAdjustmentPage() {
  await requirePermission("inventory.create");
  const [branches, products, stock] = await Promise.all([
    getBranches(),
    getProducts(),
    getStockByBranch(),
  ]);

  return (
    <>
      <PageHeader
        title="تسوية مخزنية / جرد"
        subtitle="أدخل الجرد الفعلي ويحتسب النظام الفرق عن الرصيد الدفتري"
      />
      <AdjustmentForm branches={branches} products={products} stockByBranch={stock} />
    </>
  );
}
