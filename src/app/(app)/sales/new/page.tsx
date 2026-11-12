import { requirePermission } from "@/lib/auth";
import { getBranches, getCustomers, getProducts, getSettings, getTreasuryAccounts } from "@/lib/data";
import { getStockByBranch } from "@/lib/stock";
import SalesInvoiceForm from "@/components/doc/SalesInvoiceForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewSalesInvoicePage() {
  await requirePermission("sales.create");

  const [branches, products, customers, treasury, settings, stock] = await Promise.all([
    getBranches(),
    getProducts(),
    getCustomers(),
    getTreasuryAccounts(),
    getSettings(),
    getStockByBranch(),
  ]);

  return (
    <>
      <PageHeader title="فاتورة مبيعات جديدة" subtitle="الفاتورة تُحدّث المخزون والصندوق والذمم تلقائيًا عند الترحيل" />
      <SalesInvoiceForm
        branches={branches}
        products={products}
        customers={customers}
        treasury={treasury}
        taxEnabled={Boolean(settings.tax_enabled)}
        defaultTaxRate={Number(settings.default_tax_rate ?? 0)}
        stockByBranch={stock}
      />
    </>
  );
}
