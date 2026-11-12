import { notFound } from "next/navigation";
import { queryAs, requirePermission } from "@/lib/auth";
import ProductForm, { type ProductInitial } from "@/components/ProductForm";
import { LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("products.edit");
  const { id } = await params;

  const [product] = await queryAs<ProductInitial>(
    `select id, code, name_ar, category_id, uom_id, default_sale_price, default_unit_cost,
            reorder_level, tax_rate, barcode, notes, is_active, (image is not null) as has_image
       from products where id = $1`,
    [id],
  );
  if (!product) notFound();

  const [categories, uoms, stock] = await Promise.all([
    queryAs<{ id: string; name_ar: string; depth: string; path: string }>(
      "select id, name_ar, depth, path from category_tree()",
    ),
    queryAs<{ id: string; name_ar: string }>(
      "select id, name_ar from units_of_measure order by name_ar",
    ),
    queryAs<Record<string, string>>(
      `select b.name_ar as branch_name, s.quantity, s.avg_cost, s.stock_value
         from product_branch_stock s join branches b on b.id = s.branch_id
        where s.product_id = $1 order by b.sort_order`,
      [id],
    ),
  ]);

  return (
    <>
      <PageHeader
        title={product.name_ar}
        subtitle={`كود ${product.code}`}
        action={<LinkButton href="/products" variant="ghost">رجوع للمنتجات</LinkButton>}
      />

      <ProductForm categories={categories} uoms={uoms} initial={product} />

      {stock.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>الوحدة</th>
                <th className="cell-num">الكمية</th>
                <th className="cell-num">متوسط التكلفة</th>
                <th className="cell-num">قيمة المخزون</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((r, i) => (
                <tr key={i}>
                  <td>{r.branch_name}</td>
                  <td className="cell-num num">{Number(r.quantity).toLocaleString("en-US")}</td>
                  <td className="cell-num num">{Number(r.avg_cost).toFixed(3)}</td>
                  <td className="cell-num num">{Number(r.stock_value).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
