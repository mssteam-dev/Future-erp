import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getCustomers, getTreasuryAccounts } from "@/lib/data";
import { CollectionForm, type OpenInvoice } from "@/components/doc/TreasuryForms";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("treasury.create");
  const { error } = await searchParams;

  const [branches, customers, treasury] = await Promise.all([
    getBranches(),
    getCustomers(),
    getTreasuryAccounts(),
  ]);

  const openInvoices = await queryAs<OpenInvoice>(
    `select i.id, i.invoice_no, i.invoice_date::text as invoice_date,
            i.customer_id as party_id, sales_invoice_outstanding(i.id)::text as outstanding
       from sales_invoices i
      where i.status = 'posted' and i.customer_id is not null
        and sales_invoice_outstanding(i.id) > 0
      order by i.invoice_date`,
  );

  return (
    <>
      <PageHeader title="سند قبض جديد" />
      <CollectionForm
        branches={branches}
        customers={customers}
        treasury={treasury}
        openInvoices={openInvoices}
        error={error}
      />
    </>
  );
}
