/**
 * اختبار دورة عمل كاملة من الواجهة نفسها، والتحقق من الأثر في قاعدة البيانات.
 *   npx tsx scripts/e2e.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { Pool } from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/erp_dev",
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
function near(a: number, b: number, tol = 0.005) {
  return Math.abs(a - b) <= tol;
}
async function one<T = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}


/** اختيار منتج من منتقي المنتجات (حل محل القائمة المنسدلة) */
async function pickProduct(page: Page, code: string) {
  await page.locator("tbody button.input").first().click();
  await page.getByPlaceholder("ابحث بالاسم أو الكود…").fill(code);
  await page.waitForTimeout(350);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', "admin");
  await page.fill('input[name="password"]', "admin123");
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type="submit"]')]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar" })
    .then((c) => c.newPage());

  await login(page);
  check("تسجيل الدخول من الواجهة", page.url() === `${BASE}/`);

  // ---------------- حالة ما قبل العملية ----------------
  const product = await one(
    `select p.id, p.code, p.name_ar, s.quantity, s.avg_cost, b.id as branch_id, b.name_ar as branch_name
       from product_branch_stock s
       join products p on p.id = s.product_id
       join branches b on b.id = s.branch_id
      where b.code = 'B1' and s.quantity > 50
      order by p.code limit 1`,
  );
  const beforeQty = Number(product.quantity);
  const beforeCash = Number(
    (await one("select treasury_balance(id) as b from treasury_accounts where code='CASH-B1'")).b,
  );

  // ---------------- 1) فاتورة مبيعات نقدية من الواجهة ----------------
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });

  await page.selectOption('select[name="branch_id"]', { label: product.branch_name });
  await pickProduct(page, product.code);
  const qtyInput = page.locator("tbody input[type=number]").first();
  await qtyInput.fill("5");
  await page.locator('input[type="number"]').nth(0); // تأكيد التحميل

  // سعر البيع يُملأ تلقائيًا من بطاقة المنتج
  const unitPrice = Number(await page.locator("tbody input[type=number]").nth(1).inputValue());
  check("سعر البيع يُملأ تلقائيًا من المنتج", unitPrice > 0, `السعر ${unitPrice}`);

  await page.getByRole("button", { name: "تحصيل كامل نقدًا" }).click();
  await Promise.all([
    page.waitForURL(/\/sales\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "حفظ وترحيل" }).click(),
  ]);

  const invoiceId = page.url().split("/").pop()!;
  const invoice = await one("select * from sales_invoices where id = $1", [invoiceId]);
  check("الفاتورة رُحِّلت", invoice.status === "posted", invoice.invoice_no);
  check(
    "إجمالي الفاتورة = الكمية × السعر",
    near(Number(invoice.total), 5 * unitPrice),
    `${invoice.total} مقابل ${(5 * unitPrice).toFixed(3)}`,
  );
  check("لا ذمة على فاتورة محصَّلة بالكامل", near(Number(invoice.remaining), 0));

  // أثر الفاتورة على المخزون والصندوق
  const afterStock = await one(
    "select quantity from product_branch_stock where product_id=$1 and branch_id=$2",
    [product.id, product.branch_id],
  );
  check(
    "المخزون انخفض بالكمية المباعة",
    near(Number(afterStock.quantity), beforeQty - 5),
    `${beforeQty} ← ${afterStock.quantity}`,
  );

  const afterCash = Number(
    (await one("select treasury_balance(id) as b from treasury_accounts where code='CASH-B1'")).b,
  );
  check(
    "الصندوق ارتفع بقيمة الفاتورة",
    near(afterCash - beforeCash, Number(invoice.total)),
    `${(afterCash - beforeCash).toFixed(3)}`,
  );

  const cogs = await one(
    `select sum(total_cost) as c from stock_movements
      where doc_type='sales_invoice' and doc_id=$1 and direction='out'`,
    [invoiceId],
  );
  check(
    "تكلفة البضاعة المباعة سُجِّلت بالمتوسط المرجح",
    near(Number(invoice.cogs_total), Number(cogs.c)),
    String(invoice.cogs_total),
  );

  // صفحة الفاتورة تعرض القيد المحاسبي
  const bodyText = (await page.textContent("body")) ?? "";
  check("صفحة الفاتورة تعرض القيد المحاسبي", bodyText.includes("القيد المحاسبي"));
  check("الفاتورة تظهر بحالة مرحّلة", bodyText.includes("مرحّلة"));

  // ---------------- 2) فاتورة آجلة لعميل ----------------
  const customer = await one("select id, name from customers order by code limit 1");
  const beforeDue = Number(
    (await one("select customer_balance($1) as b", [customer.id])).b,
  );

  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="branch_id"]', { label: product.branch_name });
  await page.selectOption('select[name="customer_id"]', { label: customer.name });
  await pickProduct(page, product.code);
  await page.locator("tbody input[type=number]").first().fill("3");
  await Promise.all([
    page.waitForURL(/\/sales\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "حفظ وترحيل" }).click(),
  ]);

  const creditInvoice = await one("select * from sales_invoices where id = $1", [
    page.url().split("/").pop(),
  ]);
  const afterDue = Number((await one("select customer_balance($1) as b", [customer.id])).b);
  check(
    "الفاتورة الآجلة فتحت ذمة على العميل",
    near(afterDue - beforeDue, Number(creditInvoice.total)),
    `${(afterDue - beforeDue).toFixed(3)}`,
  );
  check("الفاتورة الآجلة لم تدخل الصندوق", near(Number(creditInvoice.paid_total), 0));

  // ---------------- 3) تحصيل من العميل ----------------
  await page.goto(`${BASE}/treasury/collections/new`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="customer_id"]', { label: customer.name });
  await page.fill('input[name="amount"]', "10");
  await page.getByRole("button", { name: "توزيع تلقائي على الأقدم" }).click();
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/treasury/collections"),
    page.getByRole("button", { name: "حفظ وترحيل السند" }).click(),
  ]);

  const afterCollect = Number((await one("select customer_balance($1) as b", [customer.id])).b);
  check(
    "التحصيل خفّض ذمة العميل 10",
    near(afterDue - afterCollect, 10),
    `${(afterDue - afterCollect).toFixed(3)}`,
  );

  const revenueFromCollection = await one(
    `select coalesce(sum(jl.credit),0) as c
       from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
      where je.doc_type='collection' and a.type='revenue'`,
  );
  check("التحصيل لم يُسجَّل إيرادًا", Number(revenueFromCollection.c) === 0);

  // ---------------- 4) مصروف تشغيلي ----------------
  await page.goto(`${BASE}/expenses/new`, { waitUntil: "networkidle" });
  await page.fill('input[name="amount"]', "25");
  await page.selectOption('select[name="treasury_account_id"]', { index: 1 });
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/expenses"),
    page.getByRole("button", { name: "حفظ وترحيل" }).click(),
  ]);
  const expense = await one(
    "select amount, status from expenses order by created_at desc limit 1",
  );
  check("المصروف رُحِّل", expense.status === "posted" && near(Number(expense.amount), 25));

  // ---------------- 5) سلامة البيانات بعد كل العمليات ----------------
  const { rows: checks } = await pool.query("select * from system_integrity_check()");
  const failed = checks.filter((c) => !c.is_ok);
  check(
    `فحوص السلامة بعد عمليات الواجهة (${checks.length})`,
    failed.length === 0,
    failed.map((f) => f.check_name).join("، "),
  );

  // ---------------- 6) التقارير تعكس العمليات ----------------
  await page.goto(`${BASE}/reports/branches`, { waitUntil: "networkidle" });
  const reportText = (await page.textContent("body")) ?? "";
  check("التقرير المالي يعرض بنود الملف كاملة",
    reportText.includes("هامش الربح قبل المصاريف") &&
      reportText.includes("نصيب الفرع من المصاريف الإدارية") &&
      reportText.includes("صافي الربح بعد المصاريف"));

  await page.goto(`${BASE}/reports/top-products`, { waitUntil: "networkidle" });
  const topText = (await page.textContent("body")) ?? "";
  check("تقريرا أعلى المنتجات يظهران",
    topText.includes("منتجات مبيعًا") && topText.includes("منتجات ربحًا"));

  await browser.close();
  await pool.end();

  console.log(failures === 0 ? "\nدورة العمل الكاملة ناجحة" : `\n${failures} تحقق فاشل`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
