import Link from "next/link";
import { can, queryAs, requirePermission } from "@/lib/auth";
import { deleteSiteCategory, saveSiteCategory } from "@/lib/actions/website";
import { Card, Empty, Field, FormRow, Grid, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type Category = {
  id: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
  is_visible: boolean;
  items: string;
  hidden_items: string;
};

export default async function SiteMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; edit?: string }>;
}) {
  const user = await requirePermission("website.view");
  const canEdit = can(user, "website.edit");
  const { error, ok, edit } = await searchParams;

  const categories = await queryAs<Category>(
    `select c.id, c.name_ar, c.name_en, c.sort_order, c.is_visible,
            (select count(*) from site_menu_items i where i.category_id = c.id) as items,
            (select count(*) from site_menu_items i
              where i.category_id = c.id and not i.is_visible) as hidden_items
       from site_menu_categories c
      order by c.sort_order, c.created_at, c.id`,
  );
  const editing = edit ? categories.find((c) => c.id === edit) : undefined;

  const totalItems = categories.reduce((n, c) => n + Number(c.items), 0);
  const hiddenItems = categories.reduce(
    (n, c) => n + (c.is_visible ? Number(c.hidden_items) : Number(c.items)),
    0,
  );

  const form = canEdit ? (
    <Card title={editing ? `تعديل القسم: ${editing.name_ar}` : "إضافة قسم"}>
      <form action={saveSiteCategory}>
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <FormRow cols={3}>
          <Field label="اسم القسم بالعربية">
            <input name="name_ar" className="input" defaultValue={editing?.name_ar ?? ""} required />
          </Field>
          <Field label="اسم القسم بالإنجليزية">
            <input
              name="name_en"
              className="input"
              dir="ltr"
              defaultValue={editing?.name_en ?? ""}
              required
            />
          </Field>
          <Field label="الترتيب" hint="الأصغر يظهر أولًا. اتركه فارغًا ليُضاف في الآخر">
            <input
              type="number"
              name="sort_order"
              className="input input-num"
              defaultValue={editing?.sort_order ?? ""}
            />
          </Field>
        </FormRow>

        {editing ? (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 12 }}>
            <input type="checkbox" name="is_visible" defaultChecked={editing.is_visible} />
            القسم ظاهر في الموقع
          </label>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary">{editing ? "حفظ التعديلات" : "إضافة القسم"}</button>
          {editing ? (
            <Link href="/website/menu" className="btn btn-ghost">
              إلغاء
            </Link>
          ) : null}
        </div>
      </form>
    </Card>
  ) : null;

  const list = (
    <Card title="الأقسام" padded={false}>
      {categories.length === 0 ? (
        <Empty message="لا توجد أقسام بعد. أضف أول قسم ثم أضف أصنافه." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>القسم</th>
              <th>بالإنجليزية</th>
              <th className="cell-num">الأصناف</th>
              <th className="cell-num">الترتيب</th>
              <th>الحالة</th>
              <th style={{ width: 260 }}></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>
                  <Link href={`/website/menu/${c.id}`}>{c.name_ar}</Link>
                </td>
                <td dir="ltr" style={{ textAlign: "start", color: "var(--muted)" }}>{c.name_en}</td>
                <td className="cell-num">
                  {Number(c.items)}
                  {Number(c.hidden_items) > 0 ? (
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                      {" "}
                      (منها {Number(c.hidden_items)} مخفية)
                    </span>
                  ) : null}
                </td>
                <td className="cell-num">{c.sort_order}</td>
                <td>
                  <span className={`badge badge-${c.is_visible ? "posted" : "cancelled"}`}>
                    {c.is_visible ? "ظاهر" : "مخفي"}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Link href={`/website/menu/${c.id}`} className="btn btn-ghost btn-sm">
                      الأصناف والأسعار
                    </Link>
                    {canEdit ? (
                      <Link href={`/website/menu?edit=${c.id}`} className="btn btn-ghost btn-sm">
                        تعديل
                      </Link>
                    ) : null}
                    {canEdit && Number(c.items) === 0 ? (
                      <form action={deleteSiteCategory}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn btn-danger btn-sm">حذف</button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader
        title="منيو الموقع"
        subtitle="الأقسام والأصناف والأسعار كما تظهر لزوار الموقع الإلكتروني"
      />

      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {ok ? (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          تم الحفظ. يظهر التعديل في الموقع خلال دقيقتين تقريبًا.
        </div>
      ) : null}

      <Grid cols={3}>
        <Stat label="الأقسام" value={String(categories.length)} />
        <Stat label="الأصناف" value={String(totalItems)} />
        <Stat
          label="أصناف لا تظهر في الموقع"
          value={String(hiddenItems)}
          hint="المخفية، أو التي قسمها مخفي"
        />
      </Grid>

      {editing ? form : null}
      {list}
      {editing ? null : form}
    </>
  );
}
