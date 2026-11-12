import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches } from "@/lib/data";
import { money } from "@/lib/format";
import { saveTreasuryAccount } from "@/lib/actions/treasury";
import { Card, Empty, Field, FormRow, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TreasuryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select t.id, t.code, t.name_ar, t.kind, t.bank_name, t.account_number, t.is_active,
            b.name_ar as branch_name, treasury_balance(t.id) as balance
       from treasury_accounts t join branches b on b.id = t.branch_id
      order by b.sort_order, t.kind, t.name_ar`,
  );

  const cash = rows.filter((r) => r.kind === "cash").reduce((a, r) => a + Number(r.balance), 0);
  const bank = rows.filter((r) => r.kind === "bank").reduce((a, r) => a + Number(r.balance), 0);

  return (
    <>
      <PageHeader title="الصناديق والحسابات البنكية" subtitle="أرصدة محسوبة من دفتر الأستاذ مباشرة" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Grid cols={3}>
        <Stat label="إجمالي الصناديق" value={money(cash)} tone="brand" />
        <Stat label="إجمالي البنوك" value={money(bank)} />
        <Stat label="صافي النقدية" value={money(cash + bank)} tone="good" />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>النوع</th>
                <th>الوحدة</th>
                <th>البنك / رقم الحساب</th>
                <th className="cell-num">الرصيد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.code}</td>
                  <td style={{ fontWeight: 600 }}>{r.name_ar}</td>
                  <td>{r.kind === "cash" ? "صندوق" : "بنك"}</td>
                  <td>{r.branch_name}</td>
                  <td style={{ color: "var(--muted)" }}>
                    {r.bank_name ?? ""} {r.account_number ? <span className="num">{r.account_number}</span> : null}
                  </td>
                  <td className="cell-num"><Money value={r.balance} /></td>
                  <td>
                    <Link href={`/treasury/${r.id}`} className="btn btn-ghost btn-sm">كشف الحساب</Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>الإجمالي</td>
                <td className="cell-num">{money(cash + bank)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      <Card title="إضافة صندوق أو حساب بنكي">
        <form action={saveTreasuryAccount}>
          <FormRow cols={4}>
            <Field label="الكود"><input name="code" className="input" placeholder="تلقائي" /></Field>
            <Field label="الاسم"><input name="name_ar" className="input" required /></Field>
            <Field label="النوع">
              <select name="kind" className="select">
                <option value="cash">صندوق</option>
                <option value="bank">بنك</option>
              </select>
            </Field>
            <Field label="الوحدة">
              <select name="branch_id" className="select" required>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name_ar}</option>
                ))}
              </select>
            </Field>
          </FormRow>
          <FormRow cols={4}>
            <Field label="اسم البنك"><input name="bank_name" className="input" /></Field>
            <Field label="رقم الحساب"><input name="account_number" className="input input-num" /></Field>
            <Field label="الرصيد الافتتاحي">
              <input type="number" step="0.001" name="opening_balance" className="input input-num" defaultValue={0} />
            </Field>
            <Field label="تاريخ الرصيد الافتتاحي">
              <input type="date" name="opening_date" className="input input-num" />
            </Field>
          </FormRow>
          <button className="btn btn-primary">إضافة</button>
        </form>
      </Card>
    </>
  );
}
