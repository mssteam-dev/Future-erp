import { requirePermission } from "@/lib/auth";
import { getBranches, getProducts, getSettings, getSuppliers, getTreasuryAccounts } from "@/lib/data";
import { PurchaseReturnForm } from "@/components/doc/ReturnForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPurchaseReturnPage() {
  await requirePermission("purchases.create");
  const [branches, products, suppliers, treasury, settings] = await Promise.all([
    getBranches(),
    getProducts(),
    getSuppliers(),
    getTreasuryAccounts(),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader title="مرتجع مشتريات" />
      <PurchaseReturnForm
        branches={branches}
        products={products}
        suppliers={suppliers}
        treasury={treasury}
        taxEnabled={Boolean(settings.tax_enabled)}
        defaultTaxRate={Number(settings.default_tax_rate ?? 0)}
      />
    </>
  );
}
