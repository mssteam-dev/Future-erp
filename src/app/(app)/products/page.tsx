import Link from "next/link";
import { queryAs } from "@/lib/auth";
import { money, qty } from "@/lib/format";
import { saveCategory, saveUom } from "@/lib/actions/inventory";
import ProductForm from "@/components/ProductForm";
import { ProductThumb } from "@/components/doc/ProductPicker";
import { Card, Empty, Field, FormRow, Grid, LinkButton, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; category?: string }>;
}) {
  const { error, category } = await searchParams;

  const [products, categories, uoms] = await Promise.all([
    queryAs<Record<string, string>>(
      `select p.id, p.code, p.name_ar, p.default_sale_price, p.default_unit_cost,
              p.reorder_level, p.is_active, (p.image is not null) as has_image,
              c.name_ar as category_name, u.name_ar as uom_name,
              coalesce((select sum(s.quantity) from product_branch_stock s where s.product_id = p.id), 0) as total_qty,
              coalesce((select sum(s.stock_value) from product_branch_stock s where s.product_id = p.id), 0) as total_value
         from products p
         left join product_categories c on c.id = p.category_id
         left join units_of_measure u on u.id = p.uom_id
        where ($1::uuid is null or p.category_id in (select id from category_descendants($1::uuid)))
        order by p.code`,
      [category || null],
    ),
    queryAs<Record<string, string>>(
      "select id, code, name_ar, depth, path from category_tree()",
    ),
    queryAs<Record<string, string>>("select id, code, name_ar from units_of_measure order by name_ar"),
  ]);

  const totalValue = products.reduce((a, p) => a + Number(p.total_value), 0);

  return (
    <>
      <PageHeader
        title="المنتجات"
        subtitle="تعريف موحَّد للمنتج، والكميات والتكاليف مفصولة حسب الفرع"
      />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Grid cols={3}>
        <Stat label="عدد المنتجات" value={String(products.length)} />
        <Stat label="المنتجات الفعالة" value={String(products.filter((p) => String(p.is_active) === "true").length)} />
        <Stat label="قيمة المخزون الكلية" value={money(totalValue)} tone="brand" />
      </Grid>

      <ProductForm categories={categories as never} uoms={uoms as never} />

      <form method="get" className="card no-print"
            style={{ padding: 12, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div>
          <label className="label">التصنيف</label>
          <select name="category" className="select" defaultValue={category ?? ""} style={{ width: 280 }}>
            <option value="">كل التصنيفات</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {"— ".repeat(Math.max(0, Number(c.depth) - 1))}
                {c.name_ar}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-ghost btn-sm">تصفية</button>
        {category ? (
          <a href="/products" className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }}>
            إلغاء التصفية
          </a>
        ) : null}
      </form>

      <Card padded={false}>
        {products.length === 0 ? (
          <Empty message="لا توجد منتجات" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>الصورة</th>
                  <th>الكود</th>
                  <th>المنتج</th>
                  <th>التصنيف</th>
                  <th>الوحدة</th>
                  <th className="cell-num">سعر البيع</th>
                  <th className="cell-num">التكلفة الافتراضية</th>
                  <th className="cell-num">حد الطلب</th>
                  <th className="cell-num">الكمية الكلية</th>
                  <th className="cell-num">قيمة المخزون</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <ProductThumb
                        product={{ id: p.id, name_ar: p.name_ar, has_image: String(p.has_image) === "true" }}
                      />
                    </td>
                    <td className="num">{p.code}</td>
                    <td style={{ fontWeight: 600 }}>{p.name_ar}</td>
                    <td style={{ color: "var(--muted)" }}>{p.category_name}</td>
                    <td>{p.uom_name}</td>
                    <td className="cell-num">{money(p.default_sale_price)}</td>
                    <td className="cell-num">{money(p.default_unit_cost)}</td>
                    <td className="cell-num">{qty(p.reorder_level)}</td>
                    <td className="cell-num">{qty(p.total_qty)}</td>
                    <td className="cell-num">{money(p.total_value)}</td>
                    <td>
                      <span className={`badge badge-${String(p.is_active) === "true" ? "posted" : "cancelled"}`}>
                        {String(p.is_active) === "true" ? "فعال" : "موقوف"}
                      </span>
                    </td>
                    <td>
                      <Link href={`/products/${p.id}`} className="btn btn-ghost btn-sm">
                        تعديل
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16 }}>
        <Card title="التصنيفات">
          <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 0 }}>
            شجرة تصنيفات حتى خمسة مستويات: تصنيف رئيسي وتحته تصنيفات فرعية.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {categories.slice(0, 14).map((c) => (
              <span key={c.id} className="badge badge-draft" title={c.path}>
                {"· ".repeat(Math.max(0, Number(c.depth) - 1))}
                {c.name_ar}
              </span>
            ))}
          </div>
          <LinkButton href="/products/categories" variant="ghost" small>
            إدارة التصنيفات
          </LinkButton>
        </Card>

        <Card title="وحدات القياس">
          <form action={saveUom} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <Field label="وحدة جديدة"><input name="name_ar" className="input" required /></Field>
            </div>
            <button className="btn btn-ghost">إضافة</button>
          </form>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {uoms.map((u) => (
              <span key={u.id} className="badge badge-draft">{u.name_ar}</span>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
