"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAudit, nullable, num, parseLines, run, str } from "./helpers";

type Allocation = { invoice_id: string; amount: number };

// ============================= تحصيل من عميل ================================
export async function saveCollection(formData: FormData): Promise<void> {
  const amount = num(formData, "amount");
  const customerId = str(formData, "customer_id");
  const allocations = parseLines<Allocation>(formData, "allocations");

  const { data, error } = await run("treasury.create", async (client, userId) => {
    const treasury = str(formData, "treasury_account_id");
    const { rows: tr } = await client.query("select kind from treasury_accounts where id = $1", [treasury]);

    const { rows } = await client.query(
      `insert into collections (collection_no, collection_date, branch_id, customer_id, method,
                                treasury_account_id, amount, reference, notes, created_by)
       values (next_document_number('collection', $1, $2::date), $2, $1, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [str(formData, "branch_id"), str(formData, "collection_date"), customerId,
       tr[0]?.kind ?? "cash", treasury, amount, nullable(formData, "reference"),
       nullable(formData, "notes"), userId],
    );
    const collectionId = rows[0].id;

    for (const a of allocations) {
      if (!(a.amount > 0)) continue;
      await client.query(
        `insert into collection_allocations (collection_id, invoice_id, amount) values ($1, $2, $3)`,
        [collectionId, a.invoice_id, a.amount],
      );
    }

    await client.query("select post_collection($1, $2)", [collectionId, userId]);
    await logAudit(client, userId, "post", "collections", collectionId, "سند قبض من عميل");
    return collectionId as string;
  });

  if (error) redirect(`/treasury/collections/new?error=${encodeURIComponent(error)}`);
  revalidatePath("/treasury/collections");
  redirect(`/treasury/collections?highlight=${data}`);
}

export async function cancelCollection(formData: FormData): Promise<void> {
  const id = str(formData, "id");
  const { error } = await run("treasury.cancel", async (client, userId) => {
    await client.query(
      "select cancel_simple_document('collections', $1, 'collection', 'collection_date', $2, $3)",
      [id, str(formData, "reason") || "إلغاء سند قبض", userId],
    );
    await logAudit(client, userId, "cancel", "collections", id, "إلغاء سند قبض");
  });
  if (error) redirect(`/treasury/collections?error=${encodeURIComponent(error)}`);
  revalidatePath("/treasury/collections");
  redirect("/treasury/collections");
}

// ============================ دفعة إلى مورد =================================
export async function saveSupplierPayment(formData: FormData): Promise<void> {
  const allocations = parseLines<Allocation>(formData, "allocations");

  const { error } = await run("treasury.create", async (client, userId) => {
    const treasury = str(formData, "treasury_account_id");
    const { rows: tr } = await client.query("select kind from treasury_accounts where id = $1", [treasury]);

    const { rows } = await client.query(
      `insert into supplier_payments (payment_no, payment_date, branch_id, supplier_id, method,
                                      treasury_account_id, amount, reference, notes, created_by)
       values (next_document_number('supplier_payment', $1, $2::date), $2, $1, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [str(formData, "branch_id"), str(formData, "payment_date"), str(formData, "supplier_id"),
       tr[0]?.kind ?? "cash", treasury, num(formData, "amount"), nullable(formData, "reference"),
       nullable(formData, "notes"), userId],
    );
    const paymentId = rows[0].id;

    for (const a of allocations) {
      if (!(a.amount > 0)) continue;
      await client.query(
        `insert into supplier_payment_allocations (payment_id, invoice_id, amount)
         values ($1, $2, $3)`,
        [paymentId, a.invoice_id, a.amount],
      );
    }

    await client.query("select post_supplier_payment($1, $2)", [paymentId, userId]);
    await logAudit(client, userId, "post", "supplier_payments", paymentId, "سند صرف لمورد");
    return paymentId as string;
  });

  if (error) redirect(`/treasury/payments/new?error=${encodeURIComponent(error)}`);
  revalidatePath("/treasury/payments");
  redirect("/treasury/payments");
}

// ======================= تحويل بين الصندوق والبنك ===========================
export async function saveTreasuryTransfer(formData: FormData): Promise<void> {
  const from = str(formData, "from_account_id");
  const to = str(formData, "to_account_id");
  if (from === to) redirect("/treasury/transfers/new?error=" + encodeURIComponent("لا يمكن التحويل إلى الحساب نفسه"));

  const { error } = await run("treasury.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into treasury_transfers (transfer_no, transfer_date, from_account_id, to_account_id,
                                       amount, fees, reference, notes, created_by)
       values (next_document_number('treasury_transfer', null, $1::date), $1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [str(formData, "transfer_date"), from, to, num(formData, "amount"), num(formData, "fees"),
       nullable(formData, "reference"), nullable(formData, "notes"), userId],
    );
    await client.query("select post_treasury_transfer($1, $2)", [rows[0].id, userId]);
    await logAudit(client, userId, "post", "treasury_transfers", rows[0].id, "تحويل بين الحسابات");
  });

  if (error) redirect(`/treasury/transfers/new?error=${encodeURIComponent(error)}`);
  revalidatePath("/treasury/transfers");
  redirect("/treasury/transfers");
}

// =========================== سند قبض / صرف عام ==============================
export async function saveVoucher(formData: FormData): Promise<void> {
  const kind = str(formData, "kind") === "payment" ? "payment" : "receipt";

  const { error } = await run("treasury.create", async (client, userId) => {
    const { rows } = await client.query(
      `insert into vouchers (voucher_no, voucher_date, kind, branch_id, treasury_account_id,
                             counter_account_id, amount, payee, description, reference, created_by)
       values (next_document_number($1::doc_type, $2, $3::date), $3, $4, $2, $5, $6, $7, $8, $9, $10, $11)
       returning id`,
      [kind === "receipt" ? "receipt_voucher" : "payment_voucher", str(formData, "branch_id"),
       str(formData, "voucher_date"), kind, str(formData, "treasury_account_id"),
       str(formData, "counter_account_id"), num(formData, "amount"), nullable(formData, "payee"),
       nullable(formData, "description"), nullable(formData, "reference"), userId],
    );
    await client.query("select post_voucher($1, $2)", [rows[0].id, userId]);
    await logAudit(client, userId, "post", "vouchers", rows[0].id,
      kind === "receipt" ? "سند قبض" : "سند صرف");
  });

  if (error) redirect(`/treasury/vouchers/new?error=${encodeURIComponent(error)}`);
  revalidatePath("/treasury/vouchers");
  redirect("/treasury/vouchers");
}

// ============================ حساب صندوق/بنك ================================
export async function saveTreasuryAccount(formData: FormData): Promise<void> {
  const id = nullable(formData, "id");
  const name = str(formData, "name_ar");
  if (!name) return;

  const { error } = await run("settings.edit", async (client, userId) => {
    if (id) {
      await client.query(
        `update treasury_accounts set name_ar = $2, bank_name = $3, account_number = $4,
                iban = $5, is_active = $6 where id = $1`,
        [id, name, nullable(formData, "bank_name"), nullable(formData, "account_number"),
         nullable(formData, "iban"), str(formData, "is_active") === "on"],
      );
    } else {
      const { rows } = await client.query(
        `insert into treasury_accounts (code, name_ar, kind, branch_id, bank_name, account_number,
                                        iban, opening_balance, opening_date)
         values (coalesce(nullif($1,''), 'ACC' || (select count(*)+1 from treasury_accounts)),
                 $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [str(formData, "code"), name, str(formData, "kind"), str(formData, "branch_id"),
         nullable(formData, "bank_name"), nullable(formData, "account_number"),
         nullable(formData, "iban"), num(formData, "opening_balance"),
         nullable(formData, "opening_date")],
      );
      if (num(formData, "opening_balance") !== 0) {
        await client.query("select post_treasury_opening($1, $2)", [rows[0].id, userId]);
      }
    }
    await logAudit(client, userId, id ? "update" : "insert", "treasury_accounts", id, `حساب: ${name}`);
  });

  if (error) redirect(`/treasury?error=${encodeURIComponent(error)}`);
  revalidatePath("/treasury");
  redirect("/treasury");
}

export async function saveBankReconciliation(formData: FormData): Promise<void> {
  const accountId = str(formData, "treasury_account_id");
  const statementDate = str(formData, "statement_date");
  const statementBalance = num(formData, "statement_balance");

  await run("treasury.create", async (client, userId) => {
    const { rows } = await client.query("select treasury_balance($1, $2::date) as book", [
      accountId, statementDate,
    ]);
    const book = Number(rows[0].book ?? 0);
    await client.query(
      `insert into bank_reconciliations (treasury_account_id, statement_date, statement_balance,
                                         book_balance, difference, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (treasury_account_id, statement_date) do update
         set statement_balance = excluded.statement_balance,
             book_balance = excluded.book_balance,
             difference = excluded.difference`,
      [accountId, statementDate, statementBalance, book,
       Math.round((statementBalance - book) * 10000) / 10000,
       nullable(formData, "notes"), userId],
    );
  });

  revalidatePath("/treasury");
  redirect(`/treasury/${accountId}`);
}
