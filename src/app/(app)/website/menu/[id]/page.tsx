import Link from "next/link";
import { notFound } from "next/navigation";
import { can, queryAs, requirePermission } from "@/lib/auth";
import {
  deleteSiteItem,
  saveSiteItem,
  setSiteItemPrice,
  toggleSiteItem,
} from "@/lib/actions/website";
import { ITEMS_COUNT, countLabel } from "@/lib/website";
import { Card, Empty, Field, FormRow, LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Category = { id: string; name_ar: string; is_visible: boolean };

type Item = {
  id: string;
  name_ar: string;
  name_en: string;
  price: string;
  note_ar: string | null;
  note_en: string | null;
  sort_order: number;
  is_visible: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SiteMenuItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; edit?: string }>;
}) {
  const user = await requirePermission("website.view");
  const canEdit = can(user, "website.edit");
  const { id } = await params;
  const { error, ok, edit } = await searchParams;
  if (!UUID.test(id)) notFound();

  const categories = await queryAs<Category>(
    "select id, name_ar, is_visible from site_menu_categories order by sort_order, created_at, id",
  );
  const category = categories.find((c) => c.id === id);
  if (!category) notFound();

  const items = await queryAs<Item>(
    `select id, name_ar, name_en, price, note_ar, note_en, sort_order, is_visible
       from site_menu_items
      where category_id = $1
      order by sort_order, created_at, id`,
    [id],
  );
  const editing = edit ? items.find((i) => i.id === edit) : undefined;

  const form = canEdit ? (
    <Card title={editing ? `تعديل الصنف: ${editing.name_ar}` : "إضافة صنف"}>
      <form action={saveSiteItem}>
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <input type="hidden" name="list_id" value={category.id} />
        {editing ? null : <input type="hidden" name="category_id" value={category.id} />}

        <FormRow cols={4}>
          <Field label="اسم الصنف بالعربية">
            <input name="name_ar" className="input" defaultValue={editing?.name_ar ?? ""} required />
          </Field>
          <Field label="اسم الصنف بالإنجليزية">
            <input
              name="name_en"
              className="input"
              dir="ltr"
              defaultValue={editing?.name_en ?? ""}
              required
            />
          </Field>
          <Field label="السعر">
            <input
              type="number"
              name="price"
              className="input input-num"
              step="0.001"
              min="0"
              defaultValue={editing ? Number(editing.price) : ""}
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

        <FormRow cols={2}>
          <Field label="ملاحظة بالعربية (اختيارية)" hint="سطر صغير تحت اسم الصنف، كالنكهات المتاحة">
            <input name="note_ar" className="input" defaultValue={editing?.note_ar ?? ""} />
          </Field>
          <Field label="ملاحظة بالإنجليزية (اختيارية)">
            <input name="note_en" className="input" dir="ltr" defaultValue={editing?.note_en ?? ""} />
          </Field>
        </FormRow>

        {editing ? (
          <FormRow cols={2}>
            <Field label="القسم" hint="غيّره لنقل الصنف إلى قسم آخر">
              <select name="category_id" className="select" defaultValue={category.id}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" name="is_visible" defaultChecked={editing.is_visible} />
              الصنف ظاهر في الموقع
            </label>
          </FormRow>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary">{editing ? "حفظ التعديلات" : "إضافة الصنف"}</button>
          {editing ? (
            <Link href={`/website/menu/${category.id}`} className="btn btn-ghost">
              إلغاء
            </Link>
          ) : null}
        </div>
      </form>

      {editing ? (
        <form
          action={deleteSiteItem}
          style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}
        >
          <input type="hidden" name="id" value={editing.id} />
          <input type="hidden" name="list_id" value={category.id} />
          <button className="btn btn-danger btn-sm">حذف الصنف نهائيًا</button>
          <span style={{ fontSize: 12.5, color: "var(--muted)", marginInlineStart: 10 }}>
            لإيقافه مؤقتًا أخفِه بدل حذفه.
          </span>
        </form>
      ) : null}
    </Card>
  ) : null;

  const list = (
    <Card title="الأصناف" padded={false}>
      {items.length === 0 ? (
        <Empty message="لا توجد أصناف في هذا القسم بعد." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>الصنف</th>
              <th>بالإنجليزية</th>
              <th style={{ width: 230 }}>السعر</th>
              <th className="cell-num">الترتيب</th>
              <th>الحالة</th>
              {canEdit ? <th style={{ width: 170 }}></th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{i.name_ar}</div>
                  {i.note_ar ? (
                    <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{i.note_ar}</div>
                  ) : null}
                </td>
                <td dir="ltr" style={{ textAlign: "start", color: "var(--muted)" }}>
                  {i.name_en}
                </td>
                <td>
                  {canEdit ? (
                    <form action={setSiteItemPrice} style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="list_id" value={category.id} />
                      <input
                        type="number"
                        name="price"
                        className="input input-num"
                        step="0.001"
                        min="0"
                        defaultValue={Number(i.price)}
                        aria-label={`سعر ${i.name_ar}`}
                        style={{ width: 110 }}
                        required
                      />
                      <button className="btn btn-ghost btn-sm">حفظ السعر</button>
                    </form>
                  ) : (
                    <span className="num">{Number(i.price)}</span>
                  )}
                </td>
                <td className="cell-num">{i.sort_order}</td>
                <td>
                  <span className={`badge badge-${i.is_visible ? "posted" : "cancelled"}`}>
                    {i.is_visible ? "ظاهر" : "مخفي"}
                  </span>
                </td>
                {canEdit ? (
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <form action={toggleSiteItem}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="list_id" value={category.id} />
                        <button className="btn btn-ghost btn-sm">
                          {i.is_visible ? "إخفاء" : "إظهار"}
                        </button>
                      </form>
                      <Link
                        href={`/website/menu/${category.id}?edit=${i.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        تعديل
                      </Link>
                    </div>
                  </td>
                ) : null}
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
        title={`أصناف قسم ${category.name_ar}`}
        subtitle={
          category.is_visible
            ? countLabel(items.length, ITEMS_COUNT)
            : "القسم مخفي، فلا يظهر أي من أصنافه في الموقع"
        }
        action={<LinkButton href="/website/menu" variant="ghost">كل الأقسام</LinkButton>}
      />

      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {ok ? (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          تم الحفظ. يظهر التعديل في الموقع خلال دقيقتين تقريبًا.
        </div>
      ) : null}

      {editing ? form : null}
      {list}
      {editing ? null : form}
    </>
  );
}
