import { queryAs, requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { saveAllocationShares, saveBranch } from "@/lib/actions/admin";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BranchesSettingsPage() {
  await requirePermission("settings.view");
  const settings = await getSettings();

  const branches = await queryAs<Record<string, string>>(
    `select b.*, coalesce(s.share_pct, 0) as share_pct
       from branches b left join admin_allocation_shares s on s.branch_id = b.id
      order by b.sort_order`,
  );
  const manual = settings.admin_allocation_method === "manual";

  return (
    <>
      <PageHeader title="الشركة الأم والفروع" />

      <Card padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>الكود</th>
              <th>الاسم</th>
              <th>النوع</th>
              <th>الهاتف</th>
              <th>العنوان</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="num">{b.code}</td>
                <td style={{ fontWeight: 600 }}>{b.name_ar}</td>
                <td>{b.kind === "parent" ? "الشركة الأم" : "فرع"}</td>
                <td className="num">{b.phone}</td>
                <td style={{ color: "var(--muted)" }}>{b.address}</td>
                <td>
                  <span className={`badge badge-${String(b.is_active) === "true" ? "posted" : "cancelled"}`}>
                    {String(b.is_active) === "true" ? "فعال" : "موقوف"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="إضافة فرع">
        <form action={saveBranch}>
          <FormRow cols={4}>
            <Field label="الكود"><input name="code" className="input" required /></Field>
            <Field label="الاسم"><input name="name_ar" className="input" required /></Field>
            <Field label="الهاتف"><input name="phone" className="input input-num" /></Field>
            <Field label="الترتيب"><input type="number" name="sort_order" className="input input-num" defaultValue={0} /></Field>
          </FormRow>
          <Field label="العنوان"><input name="address" className="input" /></Field>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary">إضافة فرع</button>
          </div>
        </form>
      </Card>

      <Card title="نسب توزيع المصاريف الإدارية">
        {manual ? (
          <form action={saveAllocationShares}>
            <FormRow cols={3}>
              {branches
                .filter((b) => b.kind === "branch")
                .map((b) => (
                  <Field key={b.id} label={`نسبة ${b.name_ar} %`}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name={`share_${b.id}`}
                      className="input input-num"
                      defaultValue={Number(b.share_pct)}
                    />
                  </Field>
                ))}
            </FormRow>
            <button className="btn btn-primary">حفظ النسب</button>
          </form>
        ) : (
          <div className="alert alert-warning" style={{ fontSize: 13.5 }}>
            التوزيع الحالي بالتساوي على الفروع الفعالة. لتعديل النسب يدويًا غيّر طريقة التوزيع من
            إعدادات الشركة.
          </div>
        )}
      </Card>
    </>
  );
}
