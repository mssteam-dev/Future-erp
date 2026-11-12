import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { getBranches } from "@/lib/data";
import { money } from "@/lib/format";
import { saveCustomer } from "@/lib/actions/admin";
import { Card, Empty, Field, FormRow, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const branches = await getBranches();

  const rows = await queryAs<Record<string, string>>(
    `select c.*, b.name_ar as branch_name, customer_balance(c.id) as balance
       from customers c left join branches b on b.id = c.branch_id
      order by c.name`,
  );

  const totalDue = rows.reduce((a, r) => a + Number(r.balance), 0);
  const overLimit = rows.filter(
    (r) => Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit),
  ).length;

  return (
    <>
      <PageHeader title="العملاء" subtitle="أرصدة الذمم محسوبة من دفتر الأستاذ" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Grid cols={3}>
        <Stat label="عدد العملاء" value={String(rows.length)} />
        <Stat label="إجمالي الذمم المدينة" value={money(totalDue)} tone="brand" />
        <Stat label="تجاوزوا الحد الائتماني" value={String(overLimit)} tone={overLimit ? "bad" : "default"} />
      </Grid>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا يوجد عملاء" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الكود</th>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>الفرع</th>
                <th className="cell-num">الحد الائتماني</th>
                <th className="cell-num">الرصيد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const over = Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit);
                return (
                  <tr key={r.id}>
                    <td className="num">{r.code}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num">{r.phone}</td>
                    <td>{r.branch_name}</td>
                    <td className="cell-num">{money(r.credit_limit)}</td>
                    <td className="cell-num" style={over ? { color: "var(--danger)", fontWeight: 700 } : undefined}>
                      <Money value={r.balance} />
                    </td>
                    <td>
                      <Link href={`/reports/statements?type=customer&party=${r.id}`} className="btn btn-ghost btn-sm">
                        كشف حساب
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>الإجمالي</td>
                <td className="cell-num">{money(totalDue)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      <Card title="إضافة عميل">
        <form action={saveCustomer}>
          <FormRow cols={4}>
            <Field label="الكود"><input name="code" className="input" placeholder="تلقائي" /></Field>
            <Field label="الاسم"><input name="name" className="input" required /></Field>
            <Field label="الهاتف"><input name="phone" className="input input-num" /></Field>
            <Field label="الفرع">
              <select name="branch_id" className="select">
                <option value="">—</option>
                {branches.map((b) => (<option key={b.id} value={b.id}>{b.name_ar}</option>))}
              </select>
            </Field>
          </FormRow>
          <FormRow cols={4}>
            <Field label="العنوان"><input name="address" className="input" /></Field>
            <Field label="الحد الائتماني">
              <input type="number" step="0.001" min="0" name="credit_limit" className="input input-num" defaultValue={0} />
            </Field>
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
