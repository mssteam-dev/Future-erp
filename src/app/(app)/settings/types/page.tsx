import { queryAs, requirePermission } from "@/lib/auth";
import { saveExpenseType, saveRevenueType } from "@/lib/actions/admin";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TypesPage() {
  await requirePermission("settings.view");

  const [expenseTypes, revenueTypes, accounts] = await Promise.all([
    queryAs<Record<string, string>>(
      `select t.*, a.code as account_code, a.name_ar as account_name
         from expense_types t left join accounts a on a.id = t.account_id order by t.is_admin, t.name_ar`,
    ),
    queryAs<Record<string, string>>(
      `select t.*, a.code as account_code, a.name_ar as account_name
         from revenue_types t left join accounts a on a.id = t.account_id order by t.name_ar`,
    ),
    queryAs<Record<string, string>>(
      "select id, code, name_ar, type from accounts where is_postable order by code",
    ),
  ]);

  const expenseAccounts = accounts.filter((a) => a.type === "expense");
  const revenueAccounts = accounts.filter((a) => a.type === "revenue");

  return (
    <>
      <PageHeader title="أنواع المصاريف والإيرادات" />

      <Card title="أنواع المصاريف" padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>الكود</th>
              <th>النوع</th>
              <th>الحساب</th>
              <th>إداري</th>
            </tr>
          </thead>
          <tbody>
            {expenseTypes.map((t) => (
              <tr key={t.id}>
                <td className="num">{t.code}</td>
                <td>{t.name_ar}</td>
                <td>
                  <span className="num" style={{ color: "var(--muted)" }}>{t.account_code}</span> {t.account_name}
                </td>
                <td>{String(t.is_admin) === "true" ? "نعم" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
          <form action={saveExpenseType}>
            <FormRow cols={4}>
              <Field label="الكود"><input name="code" className="input" placeholder="تلقائي" /></Field>
              <Field label="اسم النوع"><input name="name_ar" className="input" required /></Field>
              <Field label="الحساب">
                <select name="account_id" className="select" required>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>
                  ))}
                </select>
              </Field>
              <Field label="مصروف إداري">
                <label style={{ display: "flex", gap: 8, alignItems: "center", height: 38 }}>
                  <input type="checkbox" name="is_admin" />
                  <span style={{ fontSize: 13.5 }}>للشركة الأم</span>
                </label>
              </Field>
            </FormRow>
            <button className="btn btn-primary">إضافة نوع مصروف</button>
          </form>
        </div>
      </Card>

      <Card title="أنواع الإيرادات" padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>الكود</th>
              <th>النوع</th>
              <th>الحساب</th>
            </tr>
          </thead>
          <tbody>
            {revenueTypes.map((t) => (
              <tr key={t.id}>
                <td className="num">{t.code}</td>
                <td>{t.name_ar}</td>
                <td>
                  <span className="num" style={{ color: "var(--muted)" }}>{t.account_code}</span> {t.account_name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
          <form action={saveRevenueType}>
            <FormRow cols={3}>
              <Field label="الكود"><input name="code" className="input" placeholder="تلقائي" /></Field>
              <Field label="اسم النوع"><input name="name_ar" className="input" required /></Field>
              <Field label="الحساب">
                <select name="account_id" className="select" required>
                  {revenueAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>
                  ))}
                </select>
              </Field>
            </FormRow>
            <button className="btn btn-primary">إضافة نوع إيراد</button>
          </form>
        </div>
      </Card>
    </>
  );
}
