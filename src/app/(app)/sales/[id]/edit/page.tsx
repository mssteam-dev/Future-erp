import { notFound } from "next/navigation";
import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getCustomers, getProducts, getSettings, getTreasuryAccounts } from "@/lib/data";
import { getStockByBranch } from "@/lib/stock";
import SalesInvoiceForm from "@/components/doc/SalesInvoiceForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditSalesInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("sales.edit");
  const { id } = await params;

  const [invoice] = await queryAs<Record<string, string>>(
    "select * from sales_invoices where id = $1",
    [id],
  );
  if (!invoice || invoice.status !== "draft") notFound();

  const [lines, payments, branches, products, customers, treasury, settings, stock] =
    await Promise.all([
      queryAs<Record<string, string>>(
        "select * from sales_invoice_lines where invoice_id = $1 order by line_no",
        [id],
      ),
      queryAs<Record<string, string>>(
        "select * from sales_invoice_payments where invoice_id = $1",
        [id],
      ),
      getBranches(),
      getProducts(),
      getCustomers(),
      getTreasuryAccounts(),
      getSettings(),
      getStockByBranch(),
    ]);

  return (
    <>
      <PageHeader title={`تعديل الفاتورة ${invoice.invoice_no}`} />
      <SalesInvoiceForm
        branches={branches}
        products={products}
        customers={customers}
        treasury={treasury}
        taxEnabled={Boolean(settings.tax_enabled)}
        defaultTaxRate={Number(settings.default_tax_rate ?? 0)}
        stockByBranch={stock}
        initial={{
          id,
          invoice_date: String(invoice.invoice_date).slice(0, 10),
          branch_id: invoice.branch_id,
          customer_id: invoice.customer_id,
          customer_name: invoice.customer_name,
          notes: invoice.notes,
          lines: lines.map((l) => ({
            key: l.id,
            product_id: l.product_id,
            quantity: Number(l.quantity),
            rate: Number(l.unit_price),
            discount: Number(l.discount),
            tax_rate: Number(l.tax_rate),
          })),
          payments: payments.map((p) => ({
            method: p.method as "cash" | "bank",
            treasury_account_id: p.treasury_account_id,
            amount: Number(p.amount),
          })),
        }}
      />
    </>
  );
}
