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
  source_line_id?: string | null;
};
type PaymentInput = { method: "cash" | "bank"; treasury_account_id: string; amount: number };

// ============================ فواتير المبيعات ===============================
export async function saveSalesInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = nullable(formData, "id");
  const post = str(formData, "intent") === "post";
  const lines = parseLines<LineInput>(formData);
  const payments = parseLines<PaymentInput>(formData, "payments");

  if (lines.length === 0) return { error: "أضف صنفًا واحدًا على الأقل" };
  if (lines.some((l) => !l.product_id)) return { error: "اختر المنتج في كل سطر" };
  if (lines.some((l) => !(l.quantity > 0))) return { error: "الكمية يجب أن تكون أكبر من صفر" };

  const branchId = str(formData, "branch_id");
  const customerId = nullable(formData, "customer_id");
  const date = str(formData, "invoice_date");

  const { data, error } = await run("sales.create", async (client, userId) => {
    let invoiceId = id;

    if (invoiceId) {
      const { rows } = await client.query(
        "select status from sales_invoices where id = $1",
        [invoiceId],
      );
      if (!rows[0]) throw new Error("الفاتورة غير موجودة");
      if (rows[0].status !== "draft") throw new Error("لا يمكن تعديل فاتورة مرحّلة أو ملغاة");

      await client.query(
        `update sales_invoices
            set invoice_date = $2, branch_id = $3, customer_id = $4,
                customer_name = $5, notes = $6
          where id = $1`,
        [invoiceId, date, branchId, customerId, nullable(formData, "customer_name"),
         nullable(formData, "notes")],
      );
      await client.query("delete from sales_invoice_lines where invoice_id = $1", [invoiceId]);
      await client.query("delete from sales_invoice_payments where invoice_id = $1", [invoiceId]);
    } else {
      const { rows } = await client.query(
        `insert into sales_invoices (invoice_no, invoice_date, branch_id, customer_id,
                                     customer_name, notes, created_by)
         values (next_document_number('sales_invoice', $1, $2::date), $2, $1, $3, $4, $5, $6)
         returning id`,
        [branchId, date, customerId, nullable(formData, "customer_name"),
         nullable(formData, "notes"), userId],
      );
      invoiceId = rows[0].id;
    }

    for (const [i, l] of lines.entries()) {
      await client.query(
        `insert into sales_invoice_lines (invoice_id, line_no, product_id, quantity,
                                          unit_price, discount, tax_rate)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceId, i + 1, l.product_id, l.quantity, l.rate, l.discount ?? 0, l.tax_rate ?? 0],
      );
    }

    for (const p of payments) {
      if (!(p.amount > 0) || !p.treasury_account_id) continue;
      await client.query(
        `insert into sales_invoice_payments (invoice_id, method, treasury_account_id, amount)
         values ($1, $2, $3, $4)`,
        [invoiceId, p.method, p.treasury_account_id, p.amount],
      );
    }

    await client.query("select recalc_sales_invoice($1)", [invoiceId]);

    if (post) {
      await client.query("select post_sales_invoice($1, $2)", [invoiceId, userId]);
      await logAudit(client, userId, "post", "sales_invoices", invoiceId, "ترحيل فاتورة مبيعات", branchId);
    } else {
      await logAudit(client, userId, id ? "update" : "insert", "sales_invoices", invoiceId,
        "حفظ مسودة فاتورة مبيعات", branchId);
    }

    return invoiceId as string;
  });

  if (error) return { error };
  revalidatePath("/sales");
  redirect(`/sales/${data}`);
}

export async function postSalesInvoice(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("sales.post", async (client, userId) => {
    await client.query("select post_sales_invoice($1, $2)", [id, userId]);
    await logAudit(client, userId, "post", "sales_invoices", id, "ترحيل فاتورة مبيعات");
  });
  if (error) redirect(`/sales/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/sales/${id}`);
  redirect(`/sales/${id}`);
}

export async function cancelSalesInvoice(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = str(formData, "reason") || "إلغاء من المستخدم";
  const { error } = await run("sales.cancel", async (client, userId) => {
    await client.query("select cancel_sales_invoice($1, $2, $3)", [id, reason, userId]);
    await logAudit(client, userId, "cancel", "sales_invoices", id, `إلغاء فاتورة: ${reason}`);
  });
  if (error) redirect(`/sales/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/sales/${id}`);
  redirect(`/sales/${id}`);
}

export async function deleteSalesDraft(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  await run("sales.delete", async (client, userId) => {
    await client.query("delete from sales_invoices where id = $1 and status = 'draft'", [id]);
    await logAudit(client, userId, "delete", "sales_invoices", id, "حذف مسودة فاتورة");
  });
  revalidatePath("/sales");
  redirect("/sales");
}

// ============================ مرتجعات المبيعات ==============================
export async function saveSalesReturn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const lines = parseLines<LineInput>(formData);
  if (lines.length === 0) return { error: "أضف صنفًا واحدًا على الأقل" };

  const branchId = str(formData, "branch_id");
  const refundMode = str(formData, "refund_mode") || "credit";
  const treasury = nullable(formData, "treasury_account_id");
  const customerId = nullable(formData, "customer_id");

  if (refundMode === "credit" && !customerId) {
    return { error: "الخصم من الذمة يتطلب اختيار عميل مسجل" };
  }
  if (refundMode !== "credit" && !treasury) {
    return { error: "اختر الصندوق أو الحساب البنكي الذي سيُرد منه المبلغ" };
  }

  const { data, error } = await run("sales.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into sales_returns (return_no, return_date, branch_id, customer_id, invoice_id,
                                  refund_mode, treasury_account_id, notes, created_by)
       values (next_document_number('sales_return', $1, $2::date), $2, $1, $3, $4, $5, $6, $7, $8)
       returning id`,
      [branchId, str(formData, "return_date"), customerId, nullable(formData, "invoice_id"),
       refundMode, treasury, nullable(formData, "notes"), userId],
    );
    const returnId = rows[0].id;

    for (const [i, l] of lines.entries()) {
      await client.query(
        `insert into sales_return_lines (return_id, line_no, product_id, source_line_id,
                                         quantity, unit_price, tax_rate)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [returnId, i + 1, l.product_id, l.source_line_id ?? null, l.quantity, l.rate,
         l.tax_rate ?? 0],
      );
    }

    if (str(formData, "intent") === "post") {
      await client.query("select post_sales_return($1, $2)", [returnId, userId]);
    }
    await logAudit(client, userId, "insert", "sales_returns", returnId, "مرتجع مبيعات", branchId);
    return returnId as string;
  });

  if (error) return { error };
  revalidatePath("/sales/returns");
  redirect(`/sales/returns/${data}`);
}

export async function postSalesReturn(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("sales.post", async (client, userId) => {
    await client.query("select post_sales_return($1, $2)", [id, userId]);
    await logAudit(client, userId, "post", "sales_returns", id, "ترحيل مرتجع مبيعات");
  });
  if (error) redirect(`/sales/returns/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/sales/returns/${id}`);
  redirect(`/sales/returns/${id}`);
}

export async function cancelSalesReturn(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const reason = str(formData, "reason") || "إلغاء من المستخدم";
  const { error } = await run("sales.cancel", async (client, userId) => {
    await client.query("select stock_reverse_document('sales_return', $1, (select return_date from sales_returns where id = $1), $2)", [id, userId]);
    await client.query("select cancel_simple_document('sales_returns', $1, 'sales_return', 'return_date', $2, $3)", [id, reason, userId]);
    await logAudit(client, userId, "cancel", "sales_returns", id, `إلغاء مرتجع: ${reason}`);
  });
  if (error) redirect(`/sales/returns/${id}?error=${encodeURIComponent(error)}`);
  revalidatePath(`/sales/returns/${id}`);
  redirect(`/sales/returns/${id}`);
}

export async function saveQuickCustomer(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  if (!name) return;
  await run("parties.create", async (client, userId) => {
    await client.query(
      `insert into customers (code, name, phone, branch_id, credit_limit, opening_balance, opening_date)
       values (coalesce(nullif($1,''), 'C' || lpad((select count(*)+1 from customers)::text, 4, '0')),
               $2, $3, $4, $5, $6, $7)`,
      [str(formData, "code"), name, nullable(formData, "phone"), nullable(formData, "branch_id"),
       num(formData, "credit_limit"), num(formData, "opening_balance"),
       nullable(formData, "opening_date")],
    );
    await logAudit(client, userId, "insert", "customers", null, `إضافة عميل: ${name}`);
  });
  revalidatePath("/parties/customers");
}
