"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword } from "@/lib/auth";
import { logAudit, nullable, num, run, str } from "./helpers";

// ================================ المصاريف =================================
export async function saveExpense(formData: FormData): Promise<void> {
  const amount = num(formData, "amount");
  if (!(amount > 0)) redirect("/expenses/new?error=" + encodeURIComponent("أدخل مبلغًا صحيحًا"));

  const paymentMode = str(formData, "payment_mode") || "cash";
  const treasury = nullable(formData, "treasury_account_id");
  if (paymentMode !== "unpaid" && !treasury) {
    redirect("/expenses/new?error=" + encodeURIComponent("اختر الصندوق أو الحساب البنكي"));
  }

  const { error } = await run("expenses.create", async (client, userId) => {
    const branchId = str(formData, "branch_id");
    const { rows: t } = await client.query("select is_admin from expense_types where id = $1", [
      str(formData, "expense_type_id"),
    ]);
    const isAdmin = Boolean(t[0]?.is_admin);

    const { rows } = await client.query(
      `insert into expenses (expense_no, expense_date, branch_id, expense_type_id, description,
                             amount, payment_mode, treasury_account_id, is_admin, is_allocatable,
                             document_no, notes, created_by)
       values (next_document_number('expense', $1, $2::date), $2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [branchId, str(formData, "expense_date"), str(formData, "expense_type_id"),
       nullable(formData, "description"), amount, paymentMode, treasury, isAdmin,
       isAdmin && str(formData, "is_allocatable") === "on", nullable(formData, "document_no"),
       nullable(formData, "notes"), userId],
    );
    await client.query("select post_expense($1, $2)", [rows[0].id, userId]);
    await logAudit(client, userId, "post", "expenses", rows[0].id, "تسجيل مصروف", branchId);
  });

  if (error) redirect(`/expenses/new?error=${encodeURIComponent(error)}`);
  revalidatePath("/expenses");
  redirect("/expenses");
}

export async function settleExpense(formData: FormData): Promise<void> {
  const expenseId = str(formData, "expense_id");
  const { error } = await run("expenses.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into expense_settlements (settlement_no, settlement_date, expense_id,
                                        treasury_account_id, amount, created_by)
       values (next_document_number('payment_voucher', (select branch_id from expenses where id = $1),
                                    $2::date), $2, $1, $3, $4, $5)
       returning id`,
      [expenseId, str(formData, "settlement_date"), str(formData, "treasury_account_id"),
       num(formData, "amount"), userId],
    );
    await client.query("select post_expense_settlement($1, $2)", [rows[0].id, userId]);
    await logAudit(client, userId, "post", "expense_settlements", rows[0].id, "سداد مصروف مستحق");
  });

  if (error) redirect(`/expenses?error=${encodeURIComponent(error)}`);
  revalidatePath("/expenses");
  redirect("/expenses");
}

export async function cancelExpense(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("expenses.cancel", async (client, userId) => {
    await client.query(
      "select cancel_simple_document('expenses', $1, 'expense', 'expense_date', $2, $3)",
      [id, str(formData, "reason") || "إلغاء مصروف", userId],
    );
    await logAudit(client, userId, "cancel", "expenses", id, "إلغاء مصروف");
  });
  if (error) redirect(`/expenses?error=${encodeURIComponent(error)}`);
  revalidatePath("/expenses");
  redirect("/expenses");
}

// ========================== إيراد الشركة الأم ===============================
export async function saveParentRevenue(formData: FormData): Promise<void> {
  const { error } = await run("expenses.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into parent_revenues (revenue_no, revenue_date, revenue_type_id, description, amount,
                                    tax_rate, receipt_mode, treasury_account_id, customer_id,
                                    document_no, notes, created_by)
       values (next_document_number('parent_revenue', (select id from branches where kind='parent'), $1::date),
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [str(formData, "revenue_date"), str(formData, "revenue_type_id"),
       nullable(formData, "description"), num(formData, "amount"), num(formData, "tax_rate"),
       str(formData, "receipt_mode") || "cash", nullable(formData, "treasury_account_id"),
       nullable(formData, "customer_id"), nullable(formData, "document_no"),
       nullable(formData, "notes"), userId],
    );
    await client.query("select post_parent_revenue($1, $2)", [rows[0].id, userId]);
    await logAudit(client, userId, "post", "parent_revenues", rows[0].id, "إيراد الشركة الأم");
  });

  if (error) redirect(`/expenses/parent-revenue/new?error=${encodeURIComponent(error)}`);
  revalidatePath("/expenses/parent-revenue");
  redirect("/expenses/parent-revenue");
}

// ================================ العملاء ==================================
export async function saveCustomer(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  if (!name) return;
  const id = nullable(formData, "id");

  const { error } = await run("parties.create", async (client, userId) => {
    if (id) {
      await client.query(
        `update customers set name = $2, phone = $3, address = $4, branch_id = $5,
                credit_limit = $6, notes = $7, is_active = $8 where id = $1`,
        [id, name, nullable(formData, "phone"), nullable(formData, "address"),
         nullable(formData, "branch_id"), num(formData, "credit_limit"),
         nullable(formData, "notes"), str(formData, "is_active") === "on"],
      );
    } else {
      const { rows } = await client.query(
        `insert into customers (code, name, phone, address, branch_id, opening_balance,
                                opening_date, credit_limit, notes)
         values (coalesce(nullif($1,''), 'C' || lpad((select count(*)+1 from customers)::text, 4, '0')),
                 $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [str(formData, "code"), name, nullable(formData, "phone"), nullable(formData, "address"),
         nullable(formData, "branch_id"), num(formData, "opening_balance"),
         nullable(formData, "opening_date"), num(formData, "credit_limit"),
         nullable(formData, "notes")],
      );
      if (num(formData, "opening_balance") !== 0) {
        await client.query("select post_customer_opening($1, $2)", [rows[0].id, userId]);
      }
    }
    await logAudit(client, userId, id ? "update" : "insert", "customers", id, `عميل: ${name}`);
  });

  if (error) redirect(`/parties/customers?error=${encodeURIComponent(error)}`);
  revalidatePath("/parties/customers");
  redirect("/parties/customers");
}

// =============================== الإعدادات ==================================
export async function saveSettings(formData: FormData): Promise<void> {
  const { error } = await run("settings.edit", async (client, userId) => {
    await client.query(
      `update settings set
         company_name_ar = $1, company_name_en = $2, company_phone = $3, company_address = $4,
         tax_number = $5, currency_code = $6, currency_name_ar = $7, decimals = $8,
         fiscal_year_start_month = $9, system_start_date = $10, admin_allocation_method = $11,
         allow_negative_stock = $12, tax_enabled = $13, default_tax_rate = $14, brand_color = $15
       where id`,
      [str(formData, "company_name_ar"), nullable(formData, "company_name_en"),
       nullable(formData, "company_phone"), nullable(formData, "company_address"),
       nullable(formData, "tax_number"), str(formData, "currency_code"),
       str(formData, "currency_name_ar"), num(formData, "decimals", 3),
       num(formData, "fiscal_year_start_month", 1), str(formData, "system_start_date"),
       str(formData, "admin_allocation_method"), str(formData, "allow_negative_stock") === "on",
       str(formData, "tax_enabled") === "on", num(formData, "default_tax_rate"),
       str(formData, "brand_color") || "#15399A"],
    );
    await logAudit(client, userId, "update", "settings", null, "تعديل إعدادات الشركة");
  });

  if (error) redirect(`/settings?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings", "layout");
  redirect("/settings?saved=1");
}

export async function saveBranch(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const name = str(formData, "name_ar");
  if (!name) return;

  await run("settings.edit", async (client, userId) => {
    if (id) {
      await client.query(
        `update branches set name_ar = $2, name_en = $3, phone = $4, address = $5,
                sort_order = $6, is_active = $7 where id = $1`,
        [id, name, nullable(formData, "name_en"), nullable(formData, "phone"),
         nullable(formData, "address"), num(formData, "sort_order"),
         str(formData, "is_active") === "on"],
      );
    } else {
      await client.query(
        `insert into branches (code, name_ar, name_en, kind, phone, address, sort_order)
         values ($1, $2, $3, 'branch', $4, $5, $6)`,
        [str(formData, "code"), name, nullable(formData, "name_en"), nullable(formData, "phone"),
         nullable(formData, "address"), num(formData, "sort_order")],
      );
    }
    await logAudit(client, userId, id ? "update" : "insert", "branches", id, `فرع: ${name}`);
  });

  revalidatePath("/settings/branches");
  redirect("/settings/branches");
}

export async function saveAllocationShares(formData: FormData): Promise<void> {
  await run("settings.edit", async (client, userId) => {
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("share_")) continue;
      const branchId = key.slice(6);
      await client.query(
        `insert into admin_allocation_shares (branch_id, share_pct) values ($1, $2)
         on conflict (branch_id) do update set share_pct = excluded.share_pct`,
        [branchId, Number(value) || 0],
      );
    }
    await logAudit(client, userId, "update", "admin_allocation_shares", null,
      "تعديل نسب توزيع المصاريف الإدارية");
  });
  revalidatePath("/settings/branches");
  redirect("/settings/branches");
}

export async function saveExpenseType(formData: FormData): Promise<void> {
  const name = str(formData, "name_ar");
  if (!name) return;
  await run("settings.edit", async (client) => {
    await client.query(
      `insert into expense_types (code, name_ar, account_id, is_admin)
       values (coalesce(nullif($1,''), 'EXP' || (select count(*)+1 from expense_types)), $2, $3, $4)`,
      [str(formData, "code"), name, str(formData, "account_id"), str(formData, "is_admin") === "on"],
    );
  });
  revalidatePath("/settings/types");
  redirect("/settings/types");
}

export async function saveRevenueType(formData: FormData): Promise<void> {
  const name = str(formData, "name_ar");
  if (!name) return;
  await run("settings.edit", async (client) => {
    await client.query(
      `insert into revenue_types (code, name_ar, account_id)
       values (coalesce(nullif($1,''), 'REV' || (select count(*)+1 from revenue_types)), $2, $3)`,
      [str(formData, "code"), name, str(formData, "account_id")],
    );
  });
  revalidatePath("/settings/types");
  redirect("/settings/types");
}

export async function saveAccount(formData: FormData): Promise<void> {
  const name = str(formData, "name_ar");
  if (!name) return;
  const { error } = await run("settings.edit", async (client) => {
    await client.query(
      `insert into accounts (code, name_ar, type, nature, parent_id, is_postable)
       values ($1, $2, $3::account_type, $4::account_nature, $5, true)`,
      [str(formData, "code"), name, str(formData, "type"), str(formData, "nature"),
       nullable(formData, "parent_id")],
    );
  });
  if (error) redirect(`/settings/accounts?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings/accounts");
  redirect("/settings/accounts");
}

// ========================= الفترات والإقفال الشهري ==========================
export async function closePeriod(formData: FormData): Promise<void> {
  const year = num(formData, "year");
  const month = num(formData, "month");
  const { error } = await run("periods.close", async (client, userId) => {
    await client.query("select close_period($1, $2, $3)", [year, month, userId]);
  });
  if (error) redirect(`/settings/periods?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings/periods");
  redirect("/settings/periods?closed=1");
}

export async function reopenPeriod(formData: FormData): Promise<void> {
  const { error } = await run("periods.close", async (client, userId) => {
    await client.query("select reopen_period($1, $2, $3)", [
      num(formData, "year"), num(formData, "month"), userId,
    ]);
  });
  if (error) redirect(`/settings/periods?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings/periods");
  redirect("/settings/periods");
}

export async function closeFiscalYear(formData: FormData): Promise<void> {
  const { error } = await run("periods.close", async (client, userId) => {
    await client.query("select close_fiscal_year($1, $2)", [num(formData, "year"), userId]);
  });
  if (error) redirect(`/settings/periods?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings/periods");
  redirect("/settings/periods?year_closed=1");
}

// ============================== المستخدمون ==================================
export async function saveUser(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const fullName = str(formData, "full_name");
  const username = str(formData, "username");
  const password = str(formData, "password");
  if (!fullName || !username) return;

  const { error } = await run("users.manage", async (client, userId) => {
    let targetId = id;
    if (id) {
      await client.query(
        `update app_users set full_name = $2, username = $3, email = $4,
                phone = $5, is_owner = $6, is_active = $7 where id = $1`,
        [id, fullName, username, nullable(formData, "email"), nullable(formData, "phone"),
         str(formData, "is_owner") === "on", str(formData, "is_active") === "on"],
      );
      if (password) {
        await client.query("update app_users set password_hash = $2 where id = $1", [
          id, await hashPassword(password),
        ]);
      }
    } else {
      if (!password) throw new Error("كلمة المرور مطلوبة للمستخدم الجديد");
      const { rows } = await client.query(
        `insert into app_users (full_name, username, email, phone, is_owner, password_hash)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [fullName, username, nullable(formData, "email"), nullable(formData, "phone"),
         str(formData, "is_owner") === "on", await hashPassword(password)],
      );
      targetId = rows[0].id;
    }

    await client.query("delete from user_roles where user_id = $1", [targetId]);
    for (const roleId of formData.getAll("roles")) {
      await client.query("insert into user_roles (user_id, role_id) values ($1, $2)", [
        targetId, String(roleId),
      ]);
    }

    await client.query("delete from user_branches where user_id = $1", [targetId]);
    for (const branchId of formData.getAll("branches")) {
      await client.query("insert into user_branches (user_id, branch_id) values ($1, $2)", [
        targetId, String(branchId),
      ]);
    }

    await logAudit(client, userId, id ? "update" : "insert", "app_users", targetId,
      `مستخدم: ${fullName}`);
  });

  if (error) redirect(`/settings/users?error=${encodeURIComponent(error)}`);
  revalidatePath("/settings/users");
  redirect("/settings/users");
}

export async function recordBackup(formData: FormData): Promise<void> {
  await run("backup.run", async (client, userId) => {
    await client.query(
      `insert into backup_log (taken_by, kind, location, notes, status)
       values ($1, 'manual', $2, $3, 'ok')`,
      [userId, nullable(formData, "location"), nullable(formData, "notes")],
    );
  });
  revalidatePath("/settings/backup");
  redirect("/settings/backup");
}
