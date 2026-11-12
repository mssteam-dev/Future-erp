import Link from "next/link";
import { queryAs, requirePermission } from "@/lib/auth";
import { deleteCategory, saveCategory } from "@/lib/actions/inventory";
import { Card, Empty, Field, FormRow, Grid, LinkButton, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const MAX_DEPTH = 5;

type Node = {
  id: string;
  code: string;
  name_ar: string;
  parent_id: string | null;
  depth: string;
  path: string;
  is_active: boolean;
  product_count: string;
  child_count: string;
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; edit?: string; parent?: string }>;
}) {
  await requirePermission("products.view");
  const { error, edit, parent } = await searchParams;

  const tree = await queryAs<Node>("select * from category_tree()");
  const editing = edit ? tree.find((c) => c.id === edit) : undefined;

  // التصنيفات التي يمكن أن تكون أبًا: أقل من الحد الأقصى، وليست التصنيف نفسه أو أحد أبنائه
  const descendants = new Set<string>();
  if (editing) {
    const collect = (id: string) => {
      descendants.add(id);
      for (const c of tree) if (c.parent_id === id) collect(c.id);
    };
    collect(editing.id);
  }
  const parentOptions = tree.filter(
    (c) => Number(c.depth) < MAX_DEPTH && !descendants.has(c.id),
  );

  const roots = tree.filter((c) => !c.parent_id).length;
  const deepest = tree.reduce((m, c) => Math.max(m, Number(c.depth)), 0);

  return (
    <>
      <PageHeader
        title="تصنيفات المنتجات"
        subtitle={`شجرة تصنيفات حتى ${MAX_DEPTH} مستويات`}
        action={<LinkButton href="/products" variant="ghost">المنتجات</LinkButton>}
      />

      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Grid cols={3}>
        <Stat label="عدد التصنيفات" value={String(tree.length)} />
        <Stat label="التصنيفات الرئيسية" value={String(roots)} />
        <Stat label="أعمق مستوى مستخدم" value={`${deepest} من ${MAX_DEPTH}`} />
      </Grid>

      <Card title={editing ? `تعديل: ${editing.name_ar}` : "إضافة تصنيف"}>
        <form action={saveCategory}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <FormRow cols={4}>
            <Field label="الاسم">
              <input name="name_ar" className="input" defaultValue={editing?.name_ar ?? ""} required />
            </Field>
            <Field label="الكود">
              <input
                name="code"
                className="input input-num"
                defaultValue={editing?.code ?? ""}
                placeholder="تلقائي"
              />
            </Field>
            <Field label="التصنيف الأب" hint={`الحد الأقصى ${MAX_DEPTH} مستويات`}>
              <select
                name="parent_id"
                className="select"
                defaultValue={editing?.parent_id ?? parent ?? ""}
              >
                <option value="">— تصنيف رئيسي —</option>
                {parentOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {"— ".repeat(Number(c.depth) - 1)}
                    {c.name_ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الترتيب">
              <input
                type="number"
                name="sort_order"
                className="input input-num"
                defaultValue={0}
              />
            </Field>
          </FormRow>

          {editing ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 12 }}>
              <input type="checkbox" name="is_active" defaultChecked={editing.is_active} />
              التصنيف فعّال
            </label>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn btn-primary">{editing ? "حفظ التعديلات" : "إضافة"}</button>
            {editing ? (
              <Link href="/products/categories" className="btn btn-ghost">
                إلغاء
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      <Card title="الشجرة" padded={false}>
        {tree.length === 0 ? (
          <Empty message="لا توجد تصنيفات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>التصنيف</th>
                <th>الكود</th>
                <th className="cell-num">المستوى</th>
                <th className="cell-num">تصنيفات فرعية</th>
                <th className="cell-num">منتجات</th>
                <th>الحالة</th>
                <th style={{ width: 190 }}></th>
              </tr>
            </thead>
            <tbody>
              {tree.map((c) => {
                const level = Number(c.depth);
                return (
                  <tr key={c.id}>
                    <td style={{ paddingInlineStart: 12 + (level - 1) * 22 }}>
                      <span style={{ color: "var(--muted)", marginInlineEnd: 6 }}>
                        {level === 1 ? "●" : "└"}
                      </span>
                      <span style={{ fontWeight: level === 1 ? 700 : 500 }}>{c.name_ar}</span>
                    </td>
                    <td className="num" style={{ color: "var(--muted)" }}>{c.code}</td>
                    <td className="cell-num">{level}</td>
                    <td className="cell-num">{Number(c.child_count) || ""}</td>
                    <td className="cell-num">{Number(c.product_count) || ""}</td>
                    <td>
                      <span className={`badge badge-${c.is_active ? "posted" : "cancelled"}`}>
                        {c.is_active ? "فعّال" : "موقوف"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {level < MAX_DEPTH ? (
                          <Link
                            href={`/products/categories?parent=${c.id}`}
                            className="btn btn-ghost btn-sm"
                          >
                            + فرعي
                          </Link>
                        ) : null}
                        <Link
                          href={`/products/categories?edit=${c.id}`}
                          className="btn btn-ghost btn-sm"
                        >
                          تعديل
                        </Link>
                        {Number(c.child_count) === 0 && Number(c.product_count) === 0 ? (
                          <form action={deleteCategory}>
                            <input type="hidden" name="id" value={c.id} />
                            <button className="btn btn-danger btn-sm">حذف</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
