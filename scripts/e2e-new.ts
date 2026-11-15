/**
 * اختبار الواجهة للميزات الجديدة: منتجات لكل جهة، شحنة بمصاريف موزعة،
 * مدفوع مقدمًا، أرصدة افتتاحية، تصدير Excel، وفحوص السلامة.
 *   npx tsx scripts/e2e-new.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { Pool } from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/erp_dev",
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 0.0005) => Math.abs(a - b) <= tol;
async function one<T = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

/** اختيار منتج من منتقي المنتجات في السطر المطلوب */
async function pickProduct(page: Page, row: number, code: string) {
  await page.locator("table.line-table").first().locator("tbody tr").nth(row).locator("button.input").first().click();
  await page.getByPlaceholder("ابحث بالاسم أو الكود…").fill(code);
  await page.waitForTimeout(350);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
}

async function createProduct(page: Page, branchName: string, code: string, name: string, price: string) {
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  const form = page.locator("form:has(input[name=name_ar])").first();
  await form.locator('select[name="branch_id"]').selectOption({ label: branchName });
  await form.locator('input[name="code"]').fill(code);
  await form.locator('input[name="name_ar"]').fill(name);
  await form.locator('input[name="default_sale_price"]').fill(price);
  await Promise.all([
    page.waitForURL(`${BASE}/products`),
    form.getByRole("button", { name: "إضافة المنتج" }).click(),
  ]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar" });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', "admin");
  await page.fill('input[name="password"]', "admin123");
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type="submit"]')]);
  check("تسجيل الدخول", true);

  const hq = await one("select id, name_ar from branches where code='HQ'");
  const b1 = await one("select id, name_ar from branches where code='B1'");
  const supplier = await one("select id, name from suppliers order by code limit 1");

  // ============== 1) بطاقة منتج لكل جهة ==============
  const stamp = Date.now().toString().slice(-5);
  const codeA = `EA${stamp}`;
  const codeB = `EB${stamp}`;
  await createProduct(page, hq.name_ar, codeA, `منتج اختبار أ ${stamp}`, "9");
  await createProduct(page, hq.name_ar, codeB, `منتج اختبار ب ${stamp}`, "6");
  const pa = await one("select id, branch_id from products where code = $1", [codeA]);
  const pb = await one("select id from products where code = $1", [codeB]);
  check("بطاقة المنتج تتبع الجهة المختارة", pa?.branch_id === hq.id);

  // منع تكرار الكود داخل الجهة نفسها
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  const dup = page.locator("form:has(input[name=name_ar])").first();
  await dup.locator('select[name="branch_id"]').selectOption({ label: hq.name_ar });
  await dup.locator('input[name="code"]').fill(codeA);
  await dup.locator('input[name="name_ar"]').fill("مكرر");
  await dup.getByRole("button", { name: "إضافة المنتج" }).click();
  await page.waitForURL(/error=/);
  check("منع تكرار كود المنتج في الجهة", (await page.textContent("body"))?.includes("مستخدم") ?? false);

  // ============== 2) منتج الشركة الأم لا يظهر في فاتورة فرع ==============
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="branch_id"]', { label: b1.name_ar });
  await page.locator("tbody button.input").first().click();
  await page.getByPlaceholder("ابحث بالاسم أو الكود…").fill(codeA);
  await page.waitForTimeout(400);
  check(
    "منتج الشركة الأم لا يظهر عند البيع من فرع",
    (await page.textContent("body"))?.includes("لا يوجد منتج مطابق") ?? false,
  );

  // ============== 3) شحنة بمصاريف موزعة بالوزن والقطع ==============
  await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
  await page.selectOption('select[name="supplier_id"]', { label: supplier.name });
  await page.selectOption('select[name="branch_id"]', { label: hq.name_ar });
  await page.fill('input[name="shipment_no"]', `E2E-${stamp}`);
  await page.fill('input[name="carrier"]', "شركة الشحن التجريبية");
  await page.selectOption('select[name="alloc_method"]', "weight");

  const lineRows = page.locator("table.line-table").first().locator("tbody tr");
  await pickProduct(page, 0, codeA);
  await lineRows.nth(0).locator("input[type=number]").nth(0).fill("10"); // الكمية
  await lineRows.nth(0).locator("input[type=number]").nth(1).fill("5"); //  التكلفة
  await lineRows.nth(0).locator("input[type=number]").nth(2).fill("4"); //  الوزن
  await page.getByRole("button", { name: "+ إضافة سطر" }).click();
  await pickProduct(page, 1, codeB);
  await lineRows.nth(1).locator("input[type=number]").nth(0).fill("10");
  await lineRows.nth(1).locator("input[type=number]").nth(1).fill("3");
  await lineRows.nth(1).locator("input[type=number]").nth(2).fill("6");

  // مصروفان: شحن 20 بالوزن (الافتراضي)، وتخليص 10 بالقطع (أساس مستقل)
  await page.getByRole("button", { name: "+ شحن", exact: true }).click();
  await page.getByRole("button", { name: "+ تخليص جمركي" }).click();
  const expRows = page.locator("table.line-table").nth(1).locator("tbody tr");
  await expRows.nth(0).locator("input[type=number]").fill("20");
  await expRows.nth(1).locator("input[type=number]").fill("10");
  await expRows.nth(1).locator("select").nth(1).selectOption("qty");

  const preview = (await page.textContent("body")) ?? "";
  check("معاينة التكلفة النهائية تظهر قبل الحفظ", preview.includes("التكلفة النهائية بعد توزيع المصاريف"));

  await page.getByRole("button", { name: "شراء آجل بالكامل" }).click();
  await Promise.all([
    page.waitForURL(/\/purchases\/[0-9a-f-]{36}$/),
    page.getByRole("button", { name: "حفظ وترحيل" }).click(),
  ]);
  const shipId = page.url().split("/").pop()!;
  const ship = await one("select * from purchase_invoices where id = $1", [shipId]);
  check("الشحنة رُحِّلت", ship.status === "posted", ship.invoice_no);
  check("رقم الشحنة وجهة الشحن محفوظان", ship.shipment_no === `E2E-${stamp}` && ship.carrier === "شركة الشحن التجريبية");
  check("إجمالي مصاريف الشحنة 30", near(Number(ship.shipping_cost), 30));
  check("إجمالي وزن الشحنة 10", near(Number(ship.total_weight_kg), 10));

  const lines = await pool.query(
    `select l.product_id, l.alloc_expense, l.landed_unit_cost
       from purchase_invoice_lines l where l.invoice_id = $1 order by l.line_no`,
    [shipId],
  );
  //  أ: شحن 20×4/10 = 8 + تخليص 5 = 13 → (50+13)/10 = 6.3
  //  ب: شحن 20×6/10 = 12 + تخليص 5 = 17 → (30+17)/10 = 4.7
  check("نصيب المنتج الأول من المصاريف 13", near(Number(lines.rows[0].alloc_expense), 13));
  check("نصيب المنتج الثاني من المصاريف 17", near(Number(lines.rows[1].alloc_expense), 17));
  check("مجموع الموزع = المصاريف", near(Number(lines.rows[0].alloc_expense) + Number(lines.rows[1].alloc_expense), 30));
  check("التكلفة النهائية للأول 6.3", near(Number(lines.rows[0].landed_unit_cost), 6.3));
  check("التكلفة النهائية للثاني 4.7", near(Number(lines.rows[1].landed_unit_cost), 4.7));

  const layer = await one(
    "select unit_cost, remaining_qty from stock_layers where product_id = $1 and branch_id = $2",
    [pa.id, hq.id],
  );
  check("الدفعة محفوظة بتكلفتها النهائية", near(Number(layer.unit_cost), 6.3) && near(Number(layer.remaining_qty), 10));
  check("صفحة الشحنة تعرض جدول المصاريف", ((await page.textContent("body")) ?? "").includes("مصاريف الشحنة"));

  // ============== 4) مصروف مدفوع مقدمًا ==============
  const b2 = await one("select id, name_ar from branches where code='B2'");
  const beforeCount = await one<{ n: number }>("select count(*)::int as n from prepaid_expenses");
  await page.goto(`${BASE}/expenses/prepaid`, { waitUntil: "networkidle" });
  const pf = page.locator("form:has(input[name=total_amount])");
  await pf.locator('input[name="name"]').fill(`إيجار تجريبي ${stamp}`);
  await pf.locator('select[name="branch_id"]').selectOption({ label: b2.name_ar });
  await pf.locator('input[name="months"]').fill("6");
  await pf.locator('input[name="total_amount"]').fill("600");
  await pf.locator('select[name="treasury_account_id"]').selectOption({ index: 1 });
  await Promise.all([
    page.waitForURL(/saved=1/),
    pf.getByRole("button", { name: "تسجيل وترحيل" }).click(),
  ]);
  const pp = await one("select * from prepaid_expenses where name = $1", [`إيجار تجريبي ${stamp}`]);
  check("المدفوع مقدمًا سُجِّل ورُحِّل", pp?.status === "posted");
  check("القسط الشهري 100", near(Number(pp.monthly_amount), 100));
  const sched = await one<{ n: number; total: string }>("select count(*)::int as n, sum(amount) as total from prepaid_schedule where prepaid_id = $1", [pp.id]);
  check("جدول الأقساط ستة أشهر ومجموعه المبلغ", sched.n === 6 && near(Number(sched.total), 600));
  const expensedBefore = await one<{ n: number }>("select count(*)::int as n from journal_entries where doc_type = 'prepaid_amortization' and doc_id in (select id from prepaid_schedule where prepaid_id = $1)", [pp.id]);
  check("لا مصروف قبل التحميل", expensedBefore.n === 0);
  check("عدد المصاريف المدفوعة مقدمًا زاد بواحد", (await one<{ n: number }>("select count(*)::int as n from prepaid_expenses")).n === beforeCount.n + 1);

  await page.getByRole("button", { name: "تحميل الأقساط", exact: true }).click();
  await page.waitForURL(/amortized=/);
  const loaded1 = await one<{ n: number }>(
    "select count(*)::int as n from prepaid_schedule where prepaid_id = $1 and status='posted'", [pp.id]);
  check("تحميل أول قسط عند الطلب", loaded1.n === 1);

  await page.getByRole("button", { name: "تحميل الأقساط", exact: true }).click();
  await page.waitForURL(/amortized=0/);
  const loaded2 = await one<{ n: number }>(
    "select count(*)::int as n from prepaid_schedule where prepaid_id = $1 and status='posted'", [pp.id]);
  check("منع تحميل الشهر نفسه مرتين", loaded2.n === 1);
  check("رسالة عدم وجود أقساط مستحقة", ((await page.textContent("body")) ?? "").includes("لا توجد أقساط مستحقة"));

  // ============== 5) الأرصدة الافتتاحية ==============
  const cust = await one(
    `insert into customers (code, name, branch_id)
       values ($1, $2, (select id from branches where code='B3')) returning id, name`,
    [`E2E${stamp}`, `عميل افتتاحي ${stamp}`]);
  const b3 = await one("select name_ar from branches where code='B3'");
  const custBefore = Number((await one("select customer_balance($1) as b", [cust.id])).b);
  await page.goto(`${BASE}/settings/opening`, { waitUntil: "networkidle" });
  const of = page.locator("form:has(select[name=kind])");
  await of.locator('select[name="branch_id"]').selectOption({ label: b3.name_ar });
  await of.locator('select[name="customer_id"]').selectOption({ label: cust.name });
  await of.locator('input[name="amount"]').fill("250");
  await Promise.all([
    page.waitForURL(/saved=1/),
    of.getByRole("button", { name: "تسجيل الرصيد" }).click(),
  ]);
  const custAfter = Number((await one("select customer_balance($1) as b", [cust.id])).b);
  check("الرصيد الافتتاحي للعميل زاد ذمته 250", near(custAfter - custBefore, 250));
  const rev = await one(
    `select coalesce(sum(jl.credit - jl.debit), 0) as r from journal_lines jl
       join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
      where je.doc_type = 'opening_balance' and a.type = 'revenue'`);
  check("الأرصدة الافتتاحية لا تُسجَّل إيرادًا", near(Number(rev.r), 0));

  await of.locator('select[name="branch_id"]').selectOption({ label: b3.name_ar });
  await of.locator('select[name="customer_id"]').selectOption({ label: cust.name });
  await of.locator('input[name="amount"]').fill("90");
  await of.getByRole("button", { name: "تسجيل الرصيد" }).click();
  await page.waitForURL(/error=/);
  check("منع تكرار الرصيد الافتتاحي لنفس العميل والجهة", ((await page.textContent("body")) ?? "").includes("يوجد رصيد افتتاحي قائم"));

  // ============== 6) تصدير Excel ==============
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  // الجلسة بخاصية «آمن» فلا يحملها سياق الطلبات عبر http؛ نجلب من داخل الصفحة.
  const fetched = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const buf = new Uint8Array(await r.arrayBuffer());
    return {
      status: r.status,
      type: r.headers.get("content-type") ?? "",
      head: String.fromCharCode(buf[0] ?? 0, buf[1] ?? 0),
      size: buf.length,
    };
  }, `/api/export?report=shipments&format=xlsx&from=${monthStart}&to=${today}`);
  check("تصدير Excel حقيقي (ملف xlsx)",
    fetched.status === 200 && fetched.head === "PK" && fetched.type.includes("spreadsheetml"),
    `${fetched.size} بايت`);
  const csv = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, type: r.headers.get("content-type") ?? "" };
  }, `/api/export?report=consolidated&from=${monthStart}&to=${today}`);
  check("تصدير CSV للتقرير المجمّع", csv.status === 200 && csv.type.includes("csv"));

  // ============== 7) التقارير الجديدة تعرض بيانات ==============
  await page.goto(`${BASE}/reports/shipments`, { waitUntil: "networkidle" });
  check("تقرير الشحنات يعرض الشحنة الجديدة", ((await page.textContent("body")) ?? "").includes(`E2E-${stamp}`));
  await page.goto(`${BASE}/reports/stock-layers`, { waitUntil: "networkidle" });
  check("تقرير الدفعات يعرض دفعة الشحنة", ((await page.textContent("body")) ?? "").includes(`E2E-${stamp}`) ||
    ((await page.textContent("body")) ?? "").includes(ship.invoice_no));

  // ============== 8) سلامة النظام ==============
  const bad = await pool.query("select check_name from system_integrity_check() where not is_ok");
  check("فحوص السلامة سليمة بعد عمليات الواجهة", bad.rowCount === 0, bad.rows.map((r) => r.check_name).join("، "));

  if (consoleErrors.length) {
    console.log(`\nأخطاء المتصفح (${consoleErrors.length}):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 8)) console.log("  " + e);
    failures++;
  }

  await browser.close();
  await pool.end();
  console.log(failures === 0 ? "\nكل اختبارات الميزات الجديدة ناجحة" : `\n${failures} اختبار فاشل`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
