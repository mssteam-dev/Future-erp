import { notFound } from "next/navigation";
import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSuppliers } from "@/lib/data";
import { money, qty } from "@/lib/format";
import ProductForm, { type ProductInitial } from "@/components/ProductForm";
import { Card, LinkButton, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("products.edit");
  const { id } = await params;

  const [product] = await queryAs<ProductInitial>(
    `select id, branch_id, supplier_id, code, name_ar, category_id, uom_id, default_sale_price, default_unit_cost,
            reorder_level, tax_rate, barcode, notes, is_active, (image is not null) as has_image
       from products where id = $1`,
    [id],
  );
  if (!product) notFound();

  const [categories, uoms, stock, layers, branches, suppliers] = await Promise.all([
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
    queryAs<Record<string, string>>(
      `select received_date, doc_no, original_qty, remaining_qty, unit_cost, remaining_value
         from report_stock_layers($1::uuid, $2::uuid, false)
        order by received_date, doc_no`,
      [product.branch_id, id],
    ),
    getBranches(),
    getSuppliers(),
  ]);

  return (
    <>
      <PageHeader
        title={product.name_ar}
        subtitle={`كود ${product.code}`}
        action={<LinkButton href="/products" variant="ghost">رجوع للمنتجات</LinkButton>}
      />

      <ProductForm
        categories={categories}
        uoms={uoms}
        branches={branches}
        suppliers={suppliers}
        initial={product}
      />

      {stock.length > 0 ? (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
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

      {layers.length > 0 ? (
        <Card title="دفعات المخزون (كل دفعة بتكلفتها الأصلية)" padded={false}>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>تاريخ الاستلام</th>
                  <th>المستند / الشحنة</th>
                  <th className="cell-num">الكمية الأصلية</th>
                  <th className="cell-num">المتبقي</th>
                  <th className="cell-num">تكلفة القطعة</th>
                  <th className="cell-num">قيمة المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((l, i) => (
                  <tr key={i}>
                    <td className="num">{String(l.received_date).slice(0, 10)}</td>
                    <td>{l.doc_no ?? "—"}</td>
                    <td className="cell-num">{qty(l.original_qty)}</td>
                    <td className="cell-num">{qty(l.remaining_qty)}</td>
                    <td className="cell-num">{money(l.unit_cost)}</td>
                    <td className="cell-num">{money(l.remaining_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
