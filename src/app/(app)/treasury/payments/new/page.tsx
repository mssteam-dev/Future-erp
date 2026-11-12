import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSuppliers, getTreasuryAccounts } from "@/lib/data";
import { SupplierPaymentForm, type OpenInvoice } from "@/components/doc/TreasuryForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("treasury.create");
  const { error } = await searchParams;

  const [branches, suppliers, treasury] = await Promise.all([
    getBranches(),
    getSuppliers(),
    getTreasuryAccounts(),
  ]);

  const openInvoices = await queryAs<OpenInvoice>(
    `select i.id, i.invoice_no, i.invoice_date::text as invoice_date,
            i.supplier_id as party_id, purchase_invoice_outstanding(i.id)::text as outstanding
       from purchase_invoices i
      where i.status = 'posted' and purchase_invoice_outstanding(i.id) > 0
      order by i.invoice_date`,
  );

  return (
    <>
      <PageHeader title="سند صرف لمورد" />
      <SupplierPaymentForm
        branches={branches}
        suppliers={suppliers}
        treasury={treasury}
        openInvoices={openInvoices}
        error={error}
      />
    </>
  );
}
