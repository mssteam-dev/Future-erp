import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getTreasuryAccounts } from "@/lib/data";
import { saveVoucher } from "@/lib/actions/treasury";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewVoucherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("treasury.create");
  const { error } = await searchParams;

  const [branches, treasury] = await Promise.all([getBranches(), getTreasuryAccounts()]);
  const accounts = await queryAs<Record<string, string>>(
    "select id, code, name_ar, type from accounts where is_postable and is_active order by code",
  );

  return (
    <>
      <PageHeader title="سند قبض / صرف" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card>
        <form action={saveVoucher}>
          <FormRow cols={4}>
            <Field label="النوع">
              <select name="kind" className="select">
                <option value="receipt">سند قبض</option>
                <option value="payment">سند صرف</option>
              </select>
            </Field>
            <Field label="التاريخ">
              <input type="date" name="voucher_date" className="input input-num"
                defaultValue={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label="الفرع">
              <select name="branch_id" className="select" required>
                {branches.map((b) => (<option key={b.id} value={b.id}>{b.name_ar}</option>))}
              </select>
            </Field>
            <Field label="المبلغ">
              <input type="number" step="0.001" min="0.001" name="amount" className="input input-num" required />
            </Field>
          </FormRow>
          <FormRow cols={4}>
            <Field label="الصندوق / البنك">
              <select name="treasury_account_id" className="select" required>
                {treasury.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.kind === "cash" ? "صندوق" : "بنك"} — {t.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الحساب المقابل">
              <select name="counter_account_id" className="select" required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>
                ))}
              </select>
            </Field>
            <Field label="الجهة"><input name="payee" className="input" /></Field>
            <Field label="المرجع"><input name="reference" className="input" /></Field>
          </FormRow>
          <Field label="البيان"><input name="description" className="input" /></Field>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary">حفظ وترحيل</button>
          </div>
        </form>
      </Card>
    </>
  );
}
