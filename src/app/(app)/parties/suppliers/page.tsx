import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { money } from "@/lib/format";
import { saveSupplier } from "@/lib/actions/purchases";
import { Card, Empty, Field, FormRow, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const rows = await queryAs<Record<string, string>>(
    "select s.*, supplier_balance(s.id) as balance from suppliers s order by s.name",
  );
  const total = rows.reduce((a, r) => a + Number(r.balance), 0);

  return (
    <>
      <PageHeader title="الموردون" subtitle="أرصدة الذمم الدائنة" />

      <Grid cols={2}>
        <Stat label="عدد الموردين" value={String(rows.length)} />
        <Stat label="إجمالي الذمم الدائنة" value={money(total)} tone="brand" />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا يوجد موردون" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                <th className="cell-num">الرصيد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.code}</td>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td className="num">{r.phone}</td>
                  <td style={{ color: "var(--muted)" }}>{r.address}</td>
                  <td className="cell-num"><Money value={r.balance} /></td>
                  <td>
                    <Link href={`/reports/statements?type=supplier&party=${r.id}`} className="btn btn-ghost btn-sm">
                      كشف حساب
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>الإجمالي</td>
                <td className="cell-num">{money(total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      <Card title="إضافة مورد">
        <form action={saveSupplier}>
          <FormRow cols={4}>
            <Field label="الكود"><input name="code" className="input" placeholder="تلقائي" /></Field>
            <Field label="الاسم"><input name="name" className="input" required /></Field>
            <Field label="الهاتف"><input name="phone" className="input input-num" /></Field>
            <Field label="العنوان"><input name="address" className="input" /></Field>
          </FormRow>
          <FormRow cols={3}>
            <Field label="الرصيد الافتتاحي">
              <input type="number" step="0.001" name="opening_balance" className="input input-num" defaultValue={0} />
            </Field>
            <Field label="تاريخ الرصيد الافتتاحي">
              <input type="date" name="opening_date" className="input input-num" />
            </Field>
            <Field label="ملاحظات"><input name="notes" className="input" /></Field>
          </FormRow>
          <button className="btn btn-primary">إضافة</button>
        </form>
      </Card>
    </>
  );
}
