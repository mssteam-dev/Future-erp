import { queryAs, requirePermission } from "@/lib/auth";
import { saveAccount } from "@/lib/actions/admin";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصاريف",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("settings.view");
  const { error } = await searchParams;

  const rows = await queryAs<Record<string, string>>(
    "select * from accounts order by code",
  );

  return (
    <>
      <PageHeader title="دليل الحسابات" subtitle="الأصول والالتزامات وحقوق الملكية والإيرادات والمصاريف" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>الكود</th>
              <th>اسم الحساب</th>
              <th>النوع</th>
              <th>الطبيعة</th>
              <th>يقبل الحركة</th>
              <th>حساب نظام</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="num" style={{ fontWeight: String(a.is_postable) === "true" ? 400 : 700 }}>
                  {a.code}
                </td>
                <td style={{ paddingInlineStart: `${(a.code.length - 1) * 12}px` }}>{a.name_ar}</td>
                <td>{TYPE_LABEL[a.type]}</td>
                <td>{a.nature === "debit" ? "مدين" : "دائن"}</td>
                <td>{String(a.is_postable) === "true" ? "نعم" : "—"}</td>
                <td style={{ color: "var(--muted)" }}>{a.system_key ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="إضافة حساب">
        <form action={saveAccount}>
          <FormRow cols={4}>
            <Field label="الكود"><input name="code" className="input input-num" required /></Field>
            <Field label="اسم الحساب"><input name="name_ar" className="input" required /></Field>
            <Field label="النوع">
              <select name="type" className="select">
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="الطبيعة">
              <select name="nature" className="select">
                <option value="debit">مدين</option>
                <option value="credit">دائن</option>
              </select>
            </Field>
          </FormRow>
          <button className="btn btn-primary">إضافة</button>
        </form>
      </Card>
    </>
  );
}
