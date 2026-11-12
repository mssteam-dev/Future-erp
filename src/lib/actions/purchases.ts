"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, logAudit, nullable, num, parseLines, run, str } from "./helpers";

type LineInput = {
  product_id: string;
  quantity: number;
  rate: number;
  discount?: number;
  tax_rate?: number;
};
type PaymentInput = { method: "cash" | "bank"; treasury_account_id: string; amount: number };

export async function savePurchaseInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = nullable(formData, "id");
  const lines = parseLines<LineInput>(formData);
  const payments = parseLines<PaymentInput>(formData, "payments");

  if (lines.length === 0) return { error: "أضف صنفًا واحدًا على الأقل" };
  if (lines.some((l) => !l.product_id)) return { error: "اختر المنتج في كل سطر" };

  const branchId = str(formData, "branch_id");
  const supplierId = str(formData, "supplier_id");
  if (!supplierId) return { error: "اختر المورد" };

  const { data, error } = await run("purchases.create", async (client, userId) => {
    let invoiceId = id;
    const isCentral = str(formData, "is_central") === "on";

    if (invoiceId) {
      const { rows } = await client.query("select status from purchase_invoices where id = $1", [invoiceId]);
      if (rows[0]?.status !== "draft") throw new Error("لا يمكن تعديل فاتورة مرحّلة أو ملغاة");
      await client.query(
        `update purchase_invoices
            set invoice_date = $2, supplier_id = $3, branch_id = $4, is_central = $5,
                supplier_ref_no = $6, shipping_cost = $7, notes = $8
          where id = $1`,
        [invoiceId, str(formData, "invoice_date"), supplierId, branchId, isCentral,
         nullable(formData, "supplier_ref_no"), num(formData, "shipping_cost"),
         nullable(formData, "notes")],
      );
      await client.query("delete from purchase_invoice_lines where invoice_id = $1", [invoiceId]);
      await client.query("delete from purchase_invoice_payments where invoice_id = $1", [invoiceId]);
    } else {
      const { rows } = await client.query(
        `insert into purchase_invoices (invoice_no, invoice_date, supplier_id, branch_id, is_central,
                                        supplier_ref_no, shipping_cost, notes, created_by)
         values (next_document_number('purchase_invoice', $1, $2::date), $2, $3, $1, $4, $5, $6, $7, $8)
         returning id`,
        [branchId, str(formData, "invoice_date"), supplierId, isCentral,
         nullable(formData, "supplier_ref_no"), num(formData, "shipping_cost"),
         nullable(formData, "notes"), userId],
      );
      invoiceId = rows[0].id;
    }

    for (const [i, l] of lines.entries()) {
      await client.query(
        `insert into purchase_invoice_lines (invoice_id, line_no, product_id, quantity,
                                             unit_cost, discount, tax_rate)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, i + 1, l.product_id, l.quantity, l.rate, l.discount ?? 0, l.tax_rate ?? 0],
      );
    }
    for (const p of payments) {
      if (!(p.amount > 0) || !p.treasury_account_id) continue;
      await client.query(
        `insert into purchase_invoice_payments (invoice_id, method, treasury_account_id, amount)
         values ($1, $2, $3, $4)`,
        [invoiceId, p.method, p.treasury_account_id, p.amount],
      );
    }

    await client.query("select recalc_purchase_invoice($1)", [invoiceId]);

    if (str(formData, "intent") === "post") {
      await client.query("select post_purchase_invoice($1, $2)", [invoiceId, userId]);
    }
    await logAudit(client, userId, id ? "update" : "insert", "purchase_invoices", invoiceId,
      "فاتورة مشتريات", branchId);
    return invoiceId as string;
  });

  if (error) return { error };
  revalidatePath("/purchases");
  redirect(`/purchases/${data}`);
}

export async function postPurchaseInvoice(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("purchases.post", async (client, userId) => {
    await client.query("select post_purchase_invoice($1, $2)", [id, userId]);
    await logAudit(client, userId, "post", "purchase_invoices", id, "ترحيل فاتورة مشتريات");
  });
  if (error) redirect(`/purchases/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/purchases/${id}`);
  redirect(`/purchases/${id}`);
}

export async function cancelPurchaseInvoice(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = str(formData, "reason") || "إلغاء من المستخدم";
  const { error } = await run("purchases.cancel", async (client, userId) => {
    await client.query("select cancel_purchase_invoice($1, $2, $3)", [id, reason, userId]);
    await logAudit(client, userId, "cancel", "purchase_invoices", id, `إلغاء: ${reason}`);
  });
  if (error) redirect(`/purchases/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/purchases/${id}`);
  redirect(`/purchases/${id}`);
}

export async function deletePurchaseDraft(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  await run("purchases.delete", async (client, userId) => {
    await client.query("delete from purchase_invoices where id = $1 and status = 'draft'", [id]);
    await logAudit(client, userId, "delete", "purchase_invoices", id, "حذف مسودة");
  });
  revalidatePath("/purchases");
  redirect("/purchases");
}

// ============================ مرتجع المشتريات ===============================
export async function savePurchaseReturn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const lines = parseLines<LineInput>(formData);
  if (lines.length === 0) return { error: "أضف صنفًا واحدًا على الأقل" };

  const settleMode = str(formData, "settle_mode") || "credit";
  const treasury = nullable(formData, "treasury_account_id");
  if (settleMode !== "credit" && !treasury) {
    return { error: "اختر الصندوق أو الحساب البنكي الذي سيُستردّ إليه المبلغ" };
  }

  const { data, error } = await run("purchases.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into purchase_returns (return_no, return_date, supplier_id, branch_id, invoice_id,
                                     settle_mode, treasury_account_id, notes, created_by)
       values (next_document_number('purchase_return', $1, $2::date), $2, $3, $1, $4, $5, $6, $7, $8)
       returning id`,
      [str(formData, "branch_id"), str(formData, "return_date"), str(formData, "supplier_id"),
       nullable(formData, "invoice_id"), settleMode, treasury, nullable(formData, "notes"), userId],
    );
    const returnId = rows[0].id;

    for (const [i, l] of lines.entries()) {
      await client.query(
        `insert into purchase_return_lines (return_id, line_no, product_id, quantity, unit_cost, tax_rate)
         values ($1, $2, $3, $4, $5, $6)`,
        [returnId, i + 1, l.product_id, l.quantity, l.rate, l.tax_rate ?? 0],
      );
    }

    if (str(formData, "intent") === "post") {
      await client.query("select post_purchase_return($1, $2)", [returnId, userId]);
    }
    await logAudit(client, userId, "insert", "purchase_returns", returnId, "مرتجع مشتريات");
    return returnId as string;
  });

  if (error) return { error };
  revalidatePath("/purchases/returns");
  redirect(`/purchases/returns/${data}`);
}

export async function postPurchaseReturn(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("purchases.post", async (client, userId) => {
    await client.query("select post_purchase_return($1, $2)", [id, userId]);
    await logAudit(client, userId, "post", "purchase_returns", id, "ترحيل مرتجع مشتريات");
  });
  if (error) redirect(`/purchases/returns/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/purchases/returns/${id}`);
  redirect(`/purchases/returns/${id}`);
}

export async function saveSupplier(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  if (!name) return;
  const id = nullable(formData, "id");
  await run("parties.create", async (client, userId) => {
    if (id) {
      await client.query(
        `update suppliers set name = $2, phone = $3, address = $4, notes = $5 where id = $1`,
        [id, name, nullable(formData, "phone"), nullable(formData, "address"),
         nullable(formData, "notes")],
      );
    } else {
      const { rows } = await client.query(
        `insert into suppliers (code, name, phone, address, opening_balance, opening_date, notes)
         values (coalesce(nullif($1,''), 'S' || lpad((select count(*)+1 from suppliers)::text, 4, '0')),
                 $2, $3, $4, $5, $6, $7)
         returning id`,
        [str(formData, "code"), name, nullable(formData, "phone"), nullable(formData, "address"),
         num(formData, "opening_balance"), nullable(formData, "opening_date"),
         nullable(formData, "notes")],
      );
      if (num(formData, "opening_balance") !== 0) {
        await client.query("select post_supplier_opening($1, $2)", [rows[0].id, userId]);
      }
    }
    await logAudit(client, userId, id ? "update" : "insert", "suppliers", id, `مورد: ${name}`);
  });
  revalidatePath("/parties/suppliers");
}
