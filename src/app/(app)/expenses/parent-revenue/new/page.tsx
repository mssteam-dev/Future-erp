import { requirePermission } from "@/lib/auth";
import { getCustomers, getRevenueTypes, getSettings, getTreasuryAccounts } from "@/lib/data";
import { saveParentRevenue } from "@/lib/actions/admin";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewParentRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("expenses.create");
  const { error } = await searchParams;

  const [types, treasury, customers, settings] = await Promise.all([
    getRevenueTypes(),
    getTreasuryAccounts(),
    getCustomers(),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader title="تسجيل إيراد للشركة الأم" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card>
        <form action={saveParentRevenue}>
          <FormRow cols={4}>
            <Field label="التاريخ">
              <input type="date" name="revenue_date" className="input input-num"
                defaultValue={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label="نوع الإيراد">
              <select name="revenue_type_id" className="select" required>
                {types.map((t) => (<option key={t.id} value={t.id}>{t.name_ar}</option>))}
              </select>
            </Field>
            <Field label="المبلغ">
              <input type="number" step="0.001" min="0.001" name="amount" className="input input-num" required />
            </Field>
            <Field label="نسبة الضريبة %">
              <input type="number" step="0.01" min="0" name="tax_rate" className="input input-num"
                defaultValue={Number(settings.default_tax_rate ?? 0)} />
            </Field>
          </FormRow>
          <FormRow cols={3}>
            <Field label="طريقة القبض">
              <select name="receipt_mode" className="select">
                <option value="cash">نقدًا</option>
                <option value="bank">بنك</option>
                <option value="receivable">آجل على عميل</option>
              </select>
            </Field>
            <Field label="الصندوق / البنك">
              <select name="treasury_account_id" className="select">
                <option value="">—</option>
                {treasury.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.kind === "cash" ? "صندوق" : "بنك"} — {t.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="العميل (للإيراد الآجل)">
              <select name="customer_id" className="select">
                <option value="">—</option>
                {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
          </FormRow>
          <FormRow cols={2}>
            <Field label="البيان"><input name="description" className="input" /></Field>
            <Field label="رقم المستند"><input name="document_no" className="input" /></Field>
          </FormRow>
          <button className="btn btn-primary">حفظ وترحيل</button>
        </form>
      </Card>
    </>
  );
}
