import { queryAs, requirePermission } from "@/lib/auth";
import { saveTreasuryTransfer } from "@/lib/actions/treasury";
import { money } from "@/lib/format";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewTreasuryTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("treasury.create");
  const { error } = await searchParams;

  const accounts = await queryAs<Record<string, string>>(
    `select t.id, t.name_ar, t.kind, b.name_ar as branch_name, treasury_balance(t.id) as balance
       from treasury_accounts t join branches b on b.id = t.branch_id
      where t.is_active order by b.sort_order, t.kind`,
  );

  return (
    <>
      <PageHeader title="تحويل بين الحسابات" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card>
        <form action={saveTreasuryTransfer}>
          <FormRow cols={3}>
            <Field label="التاريخ">
              <input type="date" name="transfer_date" className="input input-num"
                defaultValue={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label="من حساب">
              <select name="from_account_id" className="select" required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name_ar} ({a.branch_name}) — {money(a.balance)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="إلى حساب">
              <select name="to_account_id" className="select" required>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name_ar} ({a.branch_name}) — {money(a.balance)}
                  </option>
                ))}
              </select>
            </Field>
          </FormRow>
          <FormRow cols={3}>
            <Field label="المبلغ">
              <input type="number" step="0.001" min="0.001" name="amount" className="input input-num" required />
            </Field>
            <Field label="رسوم بنكية" hint="تُسجَّل مصروفًا مستقلًا إن وُجدت">
              <input type="number" step="0.001" min="0" name="fees" className="input input-num" defaultValue={0} />
            </Field>
            <Field label="المرجع"><input name="reference" className="input" /></Field>
          </FormRow>
          <button className="btn btn-primary">حفظ وترحيل</button>
        </form>
      </Card>
    </>
  );
}
