import { requirePermission } from "@/lib/auth";
import { getBranches, getProducts, getSettings, getSuppliers, getTreasuryAccounts } from "@/lib/data";
import PurchaseInvoiceForm from "@/components/doc/PurchaseInvoiceForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage() {
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
      <PageHeader
        title="فاتورة مشتريات جديدة"
        subtitle="تُضاف الكميات إلى مخزون الجهة المستفيدة ويُعاد حساب متوسط التكلفة"
      />
      <PurchaseInvoiceForm
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
