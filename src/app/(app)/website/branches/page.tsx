import Link from "next/link";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { deleteSiteBranch, saveSiteBranch } from "@/lib/actions/website";
import { WEEKDAYS_AR, hoursSummary, type SiteDayHours } from "@/lib/website";
import { Card, Empty, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Branch = {
  id: string;
  name_ar: string;
  name_en: string;
  address_ar: string | null;
  address_en: string | null;
  phone: string | null;
  map_url: string | null;
  sort_order: number;
  is_visible: boolean;
};

type HoursRow = SiteDayHours & { branch_id: string };

export default async function SiteBranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; edit?: string }>;
}) {
  const user = await requirePermission("website.view");
  const canEdit = can(user, "website.edit");
  const { error, ok, edit } = await searchParams;

  const [branches, hours] = await Promise.all([
    queryAs<Branch>(
      `select id, name_ar, name_en, address_ar, address_en, phone, map_url, sort_order, is_visible
         from site_branches order by sort_order, created_at, id`,
    ),
    queryAs<HoursRow>(
      `select branch_id, weekday, is_closed,
              to_char(open_time, 'HH24:MI') as open_time,
              to_char(close_time, 'HH24:MI') as close_time
         from site_branch_hours order by weekday`,
    ),
  ]);

  const hoursOf = (branchId: string) => hours.filter((h) => h.branch_id === branchId);
  const editing = edit ? branches.find((b) => b.id === edit) : undefined;
  const editingHours = editing ? hoursOf(editing.id) : [];

  return (
    <>
      <PageHeader
        title="فروع الموقع وساعات العمل"
        subtitle="العناوين والهواتف وساعات العمل كما تظهر لزوار الموقع الإلكتروني"
      />

      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {ok ? (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          تم الحفظ. يظهر التعديل في الموقع خلال دقيقتين تقريبًا.
        </div>
      ) : null}

      <Card title="الفروع" padded={false}>
        {branches.length === 0 ? (
          <Empty message="لا توجد فروع بعد." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الفرع</th>
                <th>العنوان</th>
                <th>الهاتف</th>
                <th>ساعات العمل</th>
                <th>الحالة</th>
                {canEdit ? <th style={{ width: 90 }}></th> : null}
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{b.name_ar}</div>
                    <div dir="ltr" style={{ textAlign: "start", fontSize: 12.5, color: "var(--muted)" }}>
                      {b.name_en}
                    </div>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{b.address_ar}</td>
                  <td className="num" dir="ltr" style={{ textAlign: "start" }}>{b.phone}</td>
                  <td style={{ fontSize: 13 }}>{hoursSummary(hoursOf(b.id))}</td>
                  <td>
                    <span className={`badge badge-${b.is_visible ? "posted" : "cancelled"}`}>
                      {b.is_visible ? "ظاهر" : "مخفي"}
                    </span>
                  </td>
                  {canEdit ? (
                    <td>
                      <Link href={`/website/branches?edit=${b.id}`} className="btn btn-ghost btn-sm">
                        تعديل
                      </Link>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canEdit ? (
        <Card title={editing ? `تعديل الفرع: ${editing.name_ar}` : "إضافة فرع"}>
          <form action={saveSiteBranch}>
            <input type="hidden" name="id" value={editing?.id ?? ""} />

            <FormRow cols={4}>
              <Field label="اسم الفرع بالعربية">
                <input name="name_ar" className="input" defaultValue={editing?.name_ar ?? ""} required />
              </Field>
              <Field label="اسم الفرع بالإنجليزية">
                <input
                  name="name_en"
                  className="input"
                  dir="ltr"
                  defaultValue={editing?.name_en ?? ""}
                  required
                />
              </Field>
              <Field label="الهاتف">
                <input
                  name="phone"
                  className="input input-num"
                  dir="ltr"
                  inputMode="tel"
                  defaultValue={editing?.phone ?? ""}
                />
              </Field>
              <Field label="الترتيب" hint="الأصغر يظهر أولًا">
                <input
                  type="number"
                  name="sort_order"
                  className="input input-num"
                  defaultValue={editing?.sort_order ?? ""}
                />
              </Field>
            </FormRow>

            <FormRow cols={2}>
              <Field label="العنوان بالعربية">
                <input name="address_ar" className="input" defaultValue={editing?.address_ar ?? ""} />
              </Field>
              <Field label="العنوان بالإنجليزية">
                <input name="address_en" className="input" dir="ltr" defaultValue={editing?.address_en ?? ""} />
              </Field>
            </FormRow>

            <Field label="رابط الفرع على خرائط جوجل" hint="انسخه من زر «مشاركة» في خرائط جوجل">
              <input
                type="url"
                name="map_url"
                className="input"
                dir="ltr"
                defaultValue={editing?.map_url ?? ""}
              />
            </Field>

            <div style={{ margin: "16px 0 6px", fontSize: 13.5, fontWeight: 700 }}>ساعات العمل</div>
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--muted)" }}>
              اترك اليوم فارغًا إن لم تكن ساعاته معروفة فلا يُعرض. الإغلاق بعد منتصف الليل يُكتب كما
              هو، مثل 03:00.
            </p>
            <table className="table" style={{ maxWidth: 560 }}>
              <thead>
                <tr>
                  <th>اليوم</th>
                  <th>يفتح</th>
                  <th>يغلق</th>
                  <th>مغلق طوال اليوم</th>
                </tr>
              </thead>
              <tbody>
                {WEEKDAYS_AR.map((day, d) => {
                  const h = editingHours.find((x) => x.weekday === d);
                  return (
                    <tr key={day}>
                      <td style={{ fontWeight: 600 }}>{day}</td>
                      <td>
                        <input
                          type="time"
                          name={`open_${d}`}
                          className="input input-num"
                          defaultValue={h?.open_time ?? ""}
                          aria-label={`وقت الفتح يوم ${day}`}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          name={`close_${d}`}
                          className="input input-num"
                          defaultValue={h?.close_time ?? ""}
                          aria-label={`وقت الإغلاق يوم ${day}`}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          name={`closed_${d}`}
                          defaultChecked={h?.is_closed ?? false}
                          aria-label={`مغلق يوم ${day}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {editing ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, margin: "14px 0 0" }}>
                <input type="checkbox" name="is_visible" defaultChecked={editing.is_visible} />
                الفرع ظاهر في الموقع
              </label>
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary">{editing ? "حفظ التعديلات" : "إضافة الفرع"}</button>
              {editing ? (
                <Link href="/website/branches" className="btn btn-ghost">
                  إلغاء
                </Link>
              ) : null}
            </div>
          </form>

          {editing ? (
            <form
              action={deleteSiteBranch}
              style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}
            >
              <input type="hidden" name="id" value={editing.id} />
              <button className="btn btn-danger btn-sm">حذف الفرع نهائيًا</button>
              <span style={{ fontSize: 12.5, color: "var(--muted)", marginInlineStart: 10 }}>
                لإيقافه مؤقتًا أخفِه بدل حذفه.
              </span>
            </form>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
