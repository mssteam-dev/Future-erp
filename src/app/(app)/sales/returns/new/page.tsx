import { requirePermission } from "@/lib/auth";
import { getBranches, getCustomers, getProducts, getSettings, getTreasuryAccounts } from "@/lib/data";
import { SalesReturnForm } from "@/components/doc/ReturnForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewSalesReturnPage() {
  await requirePermission("sales.create");
  const [branches, products, customers, treasury, settings] = await Promise.all([
    getBranches(),
    getProducts(),
    getCustomers(),
    getTreasuryAccounts(),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="مرتجع مبيعات"
        subtitle="يعكس أثر البيع على المبيعات والمخزون والتكلفة والأرباح"
      />
      <SalesReturnForm
        branches={branches}
        products={products}
        customers={customers}
        treasury={treasury}
        taxEnabled={Boolean(settings.tax_enabled)}
        defaultTaxRate={Number(settings.default_tax_rate ?? 0)}
      />
    </>
  );
}
