"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, logAudit, nullable, num, parseLines, run, str } from "./helpers";

type TransferLine = { product_id: string; quantity: number };
type AdjustLine = {
  product_id: string;
  system_qty: number;
  counted: number;
  rate: number;
};

// ============================== تحويل بضاعة ================================
export async function saveStockTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const lines = parseLines<TransferLine>(formData);
  if (lines.length === 0) return { error: "أضف صنفًا واحدًا على الأقل" };

  const fromBranch = str(formData, "from_branch_id");
  const toBranch = str(formData, "to_branch_id");
  if (fromBranch === toBranch) return { error: "لا يمكن التحويل من وحدة إلى نفسها" };

  const { data, error } = await run("inventory.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into stock_transfers (transfer_no, transfer_date, from_branch_id, to_branch_id,
                                    notes, created_by)
       values (next_document_number('stock_transfer', $1, $2::date), $2, $1, $3, $4, $5)
       returning id`,
      [fromBranch, str(formData, "transfer_date"), toBranch, nullable(formData, "notes"), userId],
    );
    const transferId = rows[0].id;

    for (const [i, l] of lines.entries()) {
      await client.query(
        `insert into stock_transfer_lines (transfer_id, line_no, product_id, quantity)
         values ($1, $2, $3, $4)`,
        [transferId, i + 1, l.product_id, l.quantity],
      );
    }

    if (str(formData, "intent") === "post") {
      await client.query("select post_stock_transfer($1, $2)", [transferId, userId]);
    }
    await logAudit(client, userId, "insert", "stock_transfers", transferId, "تحويل بضاعة", fromBranch);
    return transferId as string;
  });

  if (error) return { error };
  revalidatePath("/inventory/transfers");
  redirect(`/inventory/transfers/${data}`);
}

export async function postStockTransfer(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("inventory.post", async (client, userId) => {
    await client.query("select post_stock_transfer($1, $2)", [id, userId]);
    await logAudit(client, userId, "post", "stock_transfers", id, "ترحيل تحويل بضاعة");
  });
  if (error) redirect(`/inventory/transfers/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/inventory/transfers/${id}`);
  redirect(`/inventory/transfers/${id}`);
}

// ======================= تسوية مخزنية / جرد / افتتاحي =======================
export async function saveStockAdjustment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const lines = parseLines<AdjustLine>(formData);
  if (lines.length === 0) return { error: "أضف صنفًا واحدًا على الأقل" };

  const branchId = str(formData, "branch_id");
  const kind = str(formData, "kind") || "adjustment";

  const { data, error } = await run("inventory.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into stock_adjustments (adjustment_no, adjustment_date, branch_id, kind, reason, created_by)
       values (next_document_number('stock_adjustment', $1, $2::date), $2, $1, $3, $4, $5)
       returning id`,
      [branchId, str(formData, "adjustment_date"), kind, nullable(formData, "reason"), userId],
    );
    const adjustmentId = rows[0].id;

    for (const [i, l] of lines.entries()) {
      const difference = Number(l.counted ?? 0) - Number(l.system_qty ?? 0);
      await client.query(
        `insert into stock_adjustment_lines (adjustment_id, line_no, product_id, system_qty,
                                             counted_qty, difference_qty, unit_cost)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [adjustmentId, i + 1, l.product_id, l.system_qty ?? 0, l.counted ?? 0, difference, l.rate ?? 0],
      );
    }

    if (str(formData, "intent") === "post") {
      await client.query("select post_stock_adjustment($1, $2)", [adjustmentId, userId]);
    }
    await logAudit(client, userId, "insert", "stock_adjustments", adjustmentId,
      "تسوية مخزنية", branchId);
    return adjustmentId as string;
  });

  if (error) return { error };
  revalidatePath("/inventory/adjustments");
  redirect(`/inventory/adjustments/${data}`);
}

export async function postStockAdjustment(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("inventory.post", async (client, userId) => {
    await client.query("select post_stock_adjustment($1, $2)", [id, userId]);
    await logAudit(client, userId, "post", "stock_adjustments", id, "ترحيل تسوية مخزنية");
  });
  if (error) redirect(`/inventory/adjustments/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/inventory/adjustments/${id}`);
  redirect(`/inventory/adjustments/${id}`);
}

// ================================ المنتجات =================================
export async function saveProduct(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const name = str(formData, "name_ar");
  if (!name) return;

  const { error } = await run("products.create", async (client, userId) => {
    let targetId = id;
    if (id) {
      await client.query(
        `update products
            set code = $2, name_ar = $3, category_id = $4, uom_id = $5,
                default_sale_price = $6, default_unit_cost = $7, reorder_level = $8,
                tax_rate = $9, barcode = $10, notes = $11, is_active = $12
          where id = $1`,
        [id, str(formData, "code"), name, nullable(formData, "category_id"),
         nullable(formData, "uom_id"), num(formData, "default_sale_price"),
         num(formData, "default_unit_cost"), num(formData, "reorder_level"),
         formData.get("tax_rate") === "" ? null : num(formData, "tax_rate"),
         nullable(formData, "barcode"), nullable(formData, "notes"),
         str(formData, "is_active") === "on"],
      );
    } else {
      const { rows } = await client.query(
        `insert into products (code, name_ar, category_id, uom_id, default_sale_price,
                               default_unit_cost, reorder_level, tax_rate, barcode, notes)
         values (coalesce(nullif($1,''), lpad((select count(*)+1 from products)::text, 4, '0')),
                 $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [str(formData, "code"), name, nullable(formData, "category_id"),
         nullable(formData, "uom_id"), num(formData, "default_sale_price"),
         num(formData, "default_unit_cost"), num(formData, "reorder_level"),
         formData.get("tax_rate") === "" ? null : num(formData, "tax_rate"),
         nullable(formData, "barcode"), nullable(formData, "notes")],
      );
      targetId = rows[0].id;
    }

    // صورة المنتج: تُرسل من المتصفح بعد تصغيرها
    if (str(formData, "image_remove") === "on") {
      await client.query(
        `update products set image = null, image_mime = null, image_updated_at = null
          where id = $1`,
        [targetId],
      );
    } else {
      const data = str(formData, "image_data");
      if (data.startsWith("data:image/")) {
        const comma = data.indexOf(",");
        const mime = data.slice(5, data.indexOf(";"));
        const bytes = Buffer.from(data.slice(comma + 1), "base64");
        if (bytes.length > 2_000_000) throw new Error("حجم الصورة كبير جدًا");
        await client.query(
          `update products set image = $2, image_mime = $3, image_updated_at = now()
            where id = $1`,
          [targetId, bytes, mime],
        );
      }
    }

    await logAudit(client, userId, id ? "update" : "insert", "products", targetId, `منتج: ${name}`);
  });

  if (error) redirect(`/products?error=${encodeURIComponent(error)}`);
  revalidatePath("/products");
  redirect("/products");
}

export async function saveCategory(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const name = str(formData, "name_ar");
  if (!name) return;

  const { error } = await run("products.edit", async (client, userId) => {
    if (id) {
      await client.query(
        `update product_categories
            set code = coalesce(nullif($2,''), code), name_ar = $3, parent_id = $4,
                sort_order = $5, notes = $6, is_active = $7
          where id = $1`,
        [id, str(formData, "code"), name, nullable(formData, "parent_id"),
         num(formData, "sort_order"), nullable(formData, "notes"),
         str(formData, "is_active") === "on"],
      );
    } else {
      await client.query(
        `insert into product_categories (code, name_ar, parent_id, sort_order, notes)
         values (coalesce(nullif($1,''), 'CAT' || lpad((select count(*)+1 from product_categories)::text, 3, '0')),
                 $2, $3, $4, $5)`,
        [str(formData, "code"), name, nullable(formData, "parent_id"),
         num(formData, "sort_order"), nullable(formData, "notes")],
      );
    }
    await logAudit(client, userId, id ? "update" : "insert", "product_categories", id,
      `تصنيف: ${name}`);
  });

  if (error) redirect(`/products/categories?error=${encodeURIComponent(error)}`);
  revalidatePath("/products/categories");
  revalidatePath("/products");
  redirect("/products/categories");
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("products.edit", async (client, userId) => {
    const { rows } = await client.query(
      `select (select count(*) from products p where p.category_id = $1) as products,
              (select count(*) from product_categories c where c.parent_id = $1) as children`,
      [id],
    );
    if (Number(rows[0].products) > 0) {
      throw new Error("لا يمكن حذف تصنيف مرتبط بمنتجات — انقل المنتجات أولًا أو أوقف التصنيف");
    }
    if (Number(rows[0].children) > 0) {
      throw new Error("لا يمكن حذف تصنيف له تصنيفات فرعية");
    }
    await client.query("delete from product_categories where id = $1", [id]);
    await logAudit(client, userId, "delete", "product_categories", id, "حذف تصنيف");
  });

  if (error) redirect(`/products/categories?error=${encodeURIComponent(error)}`);
  revalidatePath("/products/categories");
  redirect("/products/categories");
}

export async function saveUom(formData: FormData): Promise<void> {
  const name = str(formData, "name_ar");
  if (!name) return;
  await run("products.edit", async (client) => {
    await client.query(
      `insert into units_of_measure (code, name_ar)
       values (coalesce(nullif($1,''), 'U' || (select count(*)+1 from units_of_measure)), $2)`,
      [str(formData, "code"), name],
    );
  });
  revalidatePath("/products");
}
