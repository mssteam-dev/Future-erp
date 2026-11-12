import { requirePermission } from "@/lib/auth";
import { getBranches, getProducts } from "@/lib/data";
import { getStockByBranch } from "@/lib/stock";
import { TransferForm } from "@/components/doc/InventoryForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewTransferPage() {
  await requirePermission("inventory.create");
  const [branches, products, stock] = await Promise.all([
    getBranches(),
    getProducts(),
    getStockByBranch(),
  ]);

  return (
    <>
      <PageHeader title="تحويل بضاعة جديد" />
      <TransferForm branches={branches} products={products} stockByBranch={stock} />
    </>
  );
}
