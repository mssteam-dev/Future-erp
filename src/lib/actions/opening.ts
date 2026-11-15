"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit, nullable, num, run, str } from "./helpers";

const BACK = "/settings/opening";
const fail = (message: string): never =>
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);

/** رصيد افتتاحي لصندوق أو حساب بنكي لم يُرحَّل رصيده بعد */
export async function saveTreasuryOpening(formData: FormData): Promise<void> {
  const id = str(formData, "treasury_account_id");
  const amount = num(formData, "amount");
  if (!id) fail("اختر الصندوق أو الحساب البنكي");
  if (!(amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر");

  const { error } = await run("settings.edit", async (client, userId) => {
    const { rows } = await client.query(
      "select opening_posted, name_ar, branch_id from treasury_accounts where id = $1 for update",
      [id],
    );
    if (!rows[0]) throw new Error("الحساب غير موجود");
    if (rows[0].opening_posted) throw new Error("الرصيد الافتتاحي لهذا الحساب مرحّل مسبقًا");
    await client.query(
      "update treasury_accounts set opening_balance = $2, opening_date = $3 where id = $1",
      [id, amount, nullable(formData, "entry_date")],
    );
    await client.query("select post_treasury_opening($1, $2)", [id, userId]);
    await logAudit(client, userId, "insert", "treasury_accounts", id,
      `رصيد افتتاحي: ${rows[0].name_ar}`, rows[0].branch_id);
  });
  if (error) fail(error);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=1`);
}

/** رصيد افتتاحي لعميل أو مورد أو حساب آخر، مقابل حقوق الملكية — لا يُحتسب إيرادًا */
export async function saveOpeningEntry(formData: FormData): Promise<void> {
  const kind = str(formData, "kind");
  const branchId = str(formData, "branch_id");
  const amount = num(formData, "amount");
  const side = str(formData, "side");
  const date = str(formData, "entry_date");

  if (!["customer", "supplier", "other"].includes(kind)) fail("نوع الرصيد غير معروف");
  if (!branchId) fail("اختر الجهة");
  if (!date) fail("اختر تاريخ الرصيد الافتتاحي");
  if (!(amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر");
  if (!["debit", "credit"].includes(side)) fail("حدّد الرصيد مدينًا أو دائنًا");

  const customerId = kind === "customer" ? nullable(formData, "customer_id") : null;
  const supplierId = kind === "supplier" ? nullable(formData, "supplier_id") : null;
  const accountId = kind === "other" ? nullable(formData, "account_id") : null;
  if (kind === "customer" && !customerId) fail("اختر العميل");
  if (kind === "supplier" && !supplierId) fail("اختر المورد");
  if (kind === "other" && !accountId) fail("اختر الحساب");

  const { error } = await run("settings.edit", async (client, userId) => {
    // منع التكرار: رصيد افتتاحي واحد قائم لكل عميل/مورد في الجهة نفسها
    if (customerId || supplierId) {
      const { rows } = await client.query(
        `select 1 from opening_entries
          where status <> 'cancelled' and branch_id = $1 and kind = $2
            and coalesce(customer_id, supplier_id) = $3 limit 1`,
        [branchId, kind, customerId ?? supplierId],
      );
      if (rows.length > 0) {
        throw new Error("يوجد رصيد افتتاحي قائم لهذا الطرف في هذه الجهة — ألغِه أولًا إن أردت تعديله");
      }
    }
    const { rows } = await client.query(
      `insert into opening_entries (entry_no, entry_date, branch_id, kind, customer_id, supplier_id,
                                    account_id, side, amount, description, created_by)
       values (next_document_number('opening_balance', $1, $2::date), $2::date, $1, $3, $4, $5, $6,
               $7, $8, $9, $10)
       returning id`,
      [branchId, date, kind, customerId, supplierId, accountId, side, amount,
       nullable(formData, "description"), userId],
    );
    await client.query("select post_opening_entry($1, $2)", [rows[0].id, userId]);
    await logAudit(client, userId, "insert", "opening_entries", rows[0].id, "رصيد افتتاحي", branchId);
  });
  if (error) fail(error);
  revalidatePath(BACK);
  redirect(`${BACK}?saved=1`);
}

export async function cancelOpeningEntry(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("settings.edit", async (client, userId) => {
    await client.query("select cancel_opening_entry($1, $2, $3)", [
      id, str(formData, "reason") || "إلغاء من المستخدم", userId,
    ]);
    await logAudit(client, userId, "cancel", "opening_entries", id, "إلغاء رصيد افتتاحي");
  });
  if (error) fail(error);
  revalidatePath(BACK);
  redirect(BACK);
}

/** طريقة تقييم المخزون: FIFO (الافتراضي) أو المتوسط المرجح — يُعاد بناء الدفعات عند التبديل */
export async function saveValuationMethod(formData: FormData): Promise<void> {
  const method = str(formData, "method");
  if (!["fifo", "wavg"].includes(method)) {
    redirect(`/settings?error=${encodeURIComponent("طريقة التقييم غير معروفة")}`);
  }
  const { error } = await run("settings.edit", async (client, userId) => {
    await client.query("select set_valuation_method($1, $2)", [method, userId]);
    await logAudit(client, userId, "update", "settings", null,
      `طريقة تقييم المخزون: ${method === "fifo" ? "FIFO" : "المتوسط المرجح"}`);
  });
  if (error) redirect(`/settings?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings", "layout");
  redirect("/settings?saved=1");
}
