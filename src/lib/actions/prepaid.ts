"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit, nullable, num, run, str } from "./helpers";

/** تسجيل مصروف مدفوع مقدمًا: يُنشأ كمسودة ثم يُرحَّل ويُولَّد جدول أقساطه الشهرية */
export async function savePrepaidExpense(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  const branchId = str(formData, "branch_id");
  const months = Math.floor(num(formData, "months"));
  const amount = num(formData, "total_amount");
  const mode = str(formData, "payment_mode") || "cash";
  const treasury = nullable(formData, "treasury_account_id");

  const fail = (message: string) =>
    redirect(`/expenses/prepaid?error=${encodeURIComponent(message)}`);

  if (!name) fail("اكتب بيان المصروف");
  if (!branchId) fail("اختر الجهة المستفيدة");
  if (!(months >= 1 && months <= 120)) fail("عدد الأشهر يجب أن يكون بين 1 و120");
  if (!(amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر");
  if (mode !== "unpaid" && !treasury) fail("اختر الصندوق أو الحساب البنكي الذي دُفع منه");

  const payDate = str(formData, "pay_date");
  const startDate = str(formData, "start_date") || payDate;

  const { error } = await run("expenses.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into prepaid_expenses (prepaid_no, name, branch_id, expense_type_id, pay_date, start_date,
                                     end_date, months, total_amount, payment_mode, treasury_account_id,
                                     notes, created_by)
       values (next_document_number('prepaid_expense', $1, $2::date), $3, $1, $4, $2::date, $5::date,
               (date_trunc('month', $5::date) + make_interval(months => $6::int) - interval '1 day')::date,
               $6::int, $7, $8, $9, $10, $11)
       returning id`,
      [branchId, payDate, name, str(formData, "expense_type_id"), startDate, months, amount, mode,
       mode === "unpaid" ? null : treasury, nullable(formData, "notes"), userId],
    );
    const id = rows[0].id as string;
    await client.query("select post_prepaid_expense($1, $2)", [id, userId]);
    await logAudit(client, userId, "insert", "prepaid_expenses", id, `مصروف مدفوع مقدمًا: ${name}`, branchId);
  });

  if (error) fail(error);
  revalidatePath("/expenses/prepaid");
  redirect("/expenses/prepaid?saved=1");
}

export async function cancelPrepaidExpense(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("expenses.cancel", async (client, userId) => {
    await client.query("select cancel_prepaid_expense($1, $2, $3)", [
      id, str(formData, "reason") || "إلغاء من المستخدم", userId,
    ]);
    await logAudit(client, userId, "cancel", "prepaid_expenses", id, "إلغاء مصروف مدفوع مقدمًا");
  });
  if (error) redirect(`/expenses/prepaid?error=${encodeURIComponent(error)}`);
  revalidatePath("/expenses/prepaid");
  redirect("/expenses/prepaid");
}

/** تحميل أقساط الأشهر المستحقة حتى الشهر المختار (لا يُحمَّل الشهر نفسه مرتين) */
export async function amortizePrepaid(formData: FormData): Promise<void> {
  const year = num(formData, "year");
  const month = num(formData, "month");
  let count = 0;
  const { error } = await run("expenses.post", async (client, userId) => {
    const { rows } = await client.query("select post_prepaid_amortization($1, $2, $3) as n", [
      year, month, userId,
    ]);
    count = Number(rows[0].n);
    await logAudit(client, userId, "post", "prepaid_expenses", null,
      `تحميل أقساط المدفوع مقدمًا حتى ${month}/${year}: ${count} قسطًا`);
  });
  if (error) redirect(`/expenses/prepaid?error=${encodeURIComponent(error)}`);
  revalidatePath("/expenses/prepaid");
  redirect(`/expenses/prepaid?amortized=${count}`);
}
