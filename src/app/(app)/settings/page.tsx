import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { monthName } from "@/lib/format";
import { saveSettings } from "@/lib/actions/admin";
import { Card, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requirePermission("settings.view");
  const { error, saved } = await searchParams;
  const s = await getSettings();

  return (
    <>
      <PageHeader title="إعدادات الشركة" subtitle="بيانات الشركة والعملة والسنة المالية وقواعد العمل" />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {saved ? <div className="alert alert-success" style={{ marginBottom: 14 }}>تم حفظ الإعدادات</div> : null}

      <form action={saveSettings}>
        <Card title="بيانات الشركة الأم">
          <FormRow cols={3}>
            <Field label="اسم الشركة بالعربية">
              <input name="company_name_ar" className="input" defaultValue={String(s.company_name_ar ?? "")} required />
            </Field>
            <Field label="اسم الشركة بالإنجليزية">
              <input name="company_name_en" className="input" defaultValue={String(s.company_name_en ?? "")} />
            </Field>
            <Field label="الرقم الضريبي">
              <input name="tax_number" className="input input-num" defaultValue={String(s.tax_number ?? "")} />
            </Field>
          </FormRow>
          <FormRow cols={3}>
            <Field label="الهاتف">
              <input name="company_phone" className="input input-num" defaultValue={String(s.company_phone ?? "")} />
            </Field>
            <Field label="العنوان">
              <input name="company_address" className="input" defaultValue={String(s.company_address ?? "")} />
            </Field>
            <Field label="لون الهوية">
              <input name="brand_color" type="color" className="input" defaultValue={String(s.brand_color ?? "#15399A")}
                style={{ padding: 4, height: 38 }} />
            </Field>
          </FormRow>
        </Card>

        <Card title="العملة والسنة المالية">
          <FormRow cols={4}>
            <Field label="رمز العملة">
              <input name="currency_code" className="input" defaultValue={String(s.currency_code ?? "JOD")} required />
            </Field>
            <Field label="اسم العملة">
              <input name="currency_name_ar" className="input" defaultValue={String(s.currency_name_ar ?? "")} />
            </Field>
            <Field label="عدد المنازل العشرية">
              <input type="number" min="0" max="4" name="decimals" className="input input-num"
                defaultValue={Number(s.decimals ?? 3)} />
            </Field>
            <Field label="بداية السنة المالية">
              <select name="fiscal_year_start_month" className="select"
                defaultValue={String(s.fiscal_year_start_month ?? 1)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
              </select>
            </Field>
          </FormRow>
          <FormRow cols={2}>
            <Field label="تاريخ بداية العمل بالنظام">
              <input type="date" name="system_start_date" className="input input-num"
                defaultValue={String(s.system_start_date ?? "").slice(0, 10)} />
            </Field>
            <Field label="طريقة تقييم المخزون">
              <input className="input" value="المتوسط المرجح المتحرك" disabled />
            </Field>
          </FormRow>
        </Card>

        <Card title="قواعد العمل">
          <FormRow cols={3}>
            <Field label="توزيع المصاريف الإدارية">
              <select name="admin_allocation_method" className="select"
                defaultValue={String(s.admin_allocation_method ?? "equal")}>
                <option value="equal">بالتساوي على الفروع</option>
                <option value="manual">نسب يدوية لكل فرع</option>
              </select>
            </Field>
            <Field label="نسبة الضريبة الافتراضية %">
              <input type="number" step="0.01" min="0" name="default_tax_rate" className="input input-num"
                defaultValue={Number(s.default_tax_rate ?? 0)} />
            </Field>
            <Field label="خيارات">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 6 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                  <input type="checkbox" name="tax_enabled" defaultChecked={Boolean(s.tax_enabled)} />
                  تفعيل الضريبة على الفواتير
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                  <input type="checkbox" name="allow_negative_stock" defaultChecked={Boolean(s.allow_negative_stock)} />
                  السماح بالمخزون السالب (بإذن إداري)
                </label>
              </div>
            </Field>
          </FormRow>
          <button className="btn btn-primary">حفظ الإعدادات</button>
        </Card>
      </form>
    </>
  );
}
