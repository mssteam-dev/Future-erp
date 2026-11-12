import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches } from "@/lib/data";
import { saveUser } from "@/lib/actions/admin";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("users.view");
  const { error } = await searchParams;

  const [users, roles, branches] = await Promise.all([
    queryAs<Record<string, string>>(
      `select u.*,
              coalesce((select string_agg(r.name_ar, '، ') from user_roles ur
                         join roles r on r.id = ur.role_id where ur.user_id = u.id), '') as role_names,
              coalesce((select string_agg(b.name_ar, '، ') from user_branches ub
                         join branches b on b.id = ub.branch_id where ub.user_id = u.id), '') as branch_names
         from app_users u order by u.full_name`,
    ),
    queryAs<Record<string, string>>("select id, code, name_ar from roles order by name_ar"),
    getBranches(),
  ]);

  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>اسم المستخدم</th>
              <th>البريد</th>
              <th>الأدوار</th>
              <th>الفروع</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>
                  {u.full_name}
                  {String(u.is_owner) === "true" ? (
                    <span className="badge badge-posted" style={{ marginInlineStart: 6 }}>مالك</span>
                  ) : null}
                </td>
                <td className="num">{u.username}</td>
                <td>{u.email}</td>
                <td style={{ color: "var(--muted)" }}>{u.role_names}</td>
                <td style={{ color: "var(--muted)" }}>{u.branch_names}</td>
                <td>
                  <span className={`badge badge-${String(u.is_active) === "true" ? "posted" : "cancelled"}`}>
                    {String(u.is_active) === "true" ? "فعال" : "موقوف"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="إضافة مستخدم">
        <form action={saveUser}>
          <FormRow cols={4}>
            <Field label="الاسم الكامل"><input name="full_name" className="input" required /></Field>
            <Field label="اسم المستخدم"><input name="username" className="input" required /></Field>
            <Field label="كلمة المرور"><input type="password" name="password" className="input" required /></Field>
            <Field label="البريد الإلكتروني"><input type="email" name="email" className="input" /></Field>
          </FormRow>
          <FormRow cols={2}>
            <Field label="الأدوار">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 0" }}>
                {roles.map((r) => (
                  <label key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
                    <input type="checkbox" name="roles" value={r.id} />
                    {r.name_ar}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="الفروع المسموح بها">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 0" }}>
                {branches.map((b) => (
                  <label key={b.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
                    <input type="checkbox" name="branches" value={b.id} defaultChecked />
                    {b.name_ar}
                  </label>
                ))}
              </div>
            </Field>
          </FormRow>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 12 }}>
            <input type="checkbox" name="is_owner" />
            مالك النظام (كل الصلاحيات)
          </label>
          <input type="hidden" name="is_active" value="on" />
          <button className="btn btn-primary">إضافة المستخدم</button>
        </form>
      </Card>
    </>
  );
}
