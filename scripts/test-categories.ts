/**
 * اختبار شجرة التصنيفات من الواجهة: خمسة مستويات، منع السادس، التصفية، الحذف.
 *   npx tsx scripts/test-categories.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { Pool } from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/erp-cat";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/erp_dev",
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function addCategory(page: Page, name: string, parentLabel?: string) {
  await page.goto(`${BASE}/products/categories`, { waitUntil: "networkidle" });
  await page.fill('input[name="name_ar"]', name);
  if (parentLabel) {
    await page.selectOption('select[name="parent_id"]', { label: parentLabel });
  } else {
    await page.selectOption('select[name="parent_id"]', { value: "" });
  }
  await page.getByRole("button", { name: "إضافة", exact: true }).click();

  // إجراءات الخادم تعيد التوجيه إلى الصفحة نفسها، فننتظر ظهور الصف فعليًا
  for (let i = 0; i < 40; i++) {
    const { rows } = await pool.query(
      "select 1 from product_categories where name_ar = $1",
      [name],
    );
    if (rows.length) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`تعذّر إنشاء التصنيف ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser
    .newContext({ viewport: { width: 1440, height: 1050 }, locale: "ar" })
    .then((c) => c.newPage());

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', "admin");
  await page.fill('input[name="password"]', "admin123");
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type="submit"]')]);

  // تنظيف أي بقايا من تشغيل سابق
  await pool.query("delete from product_categories where code like 'CAT%' and name_ar like 'ت.%'");

  // ---------------------- بناء خمسة مستويات من الواجهة ----------------------
  const levels = ["ت.مستوى1", "ت.مستوى2", "ت.مستوى3", "ت.مستوى4", "ت.مستوى5"];
  await addCategory(page, levels[0]);
  for (let i = 1; i < levels.length; i++) {
    await addCategory(page, levels[i], `${"— ".repeat(i - 1)}${levels[i - 1]}`);
  }

  const { rows: depths } = await pool.query(
    `select name_ar, depth, category_path(id) as path from product_categories
      where name_ar = any($1) order by depth`,
    [levels],
  );
  check("أُنشئت خمسة مستويات", depths.length === 5, depths.map((d) => d.depth).join("-"));
  check(
    "المسار الكامل صحيح",
    depths[4]?.path === levels.join(" ← "),
    depths[4]?.path,
  );

  // ---------------------- المستوى السادس مرفوض -----------------------------
  let sixthRejected = false;
  try {
    await pool.query(
      `insert into product_categories (code, name_ar, parent_id)
       select 'CATX', 'ت.مستوى6', id from product_categories where name_ar = $1`,
      [levels[4]],
    );
  } catch (e) {
    sixthRejected = String((e as Error).message).includes("5");
  }
  check("المستوى السادس مرفوض من قاعدة البيانات", sixthRejected);

  // الواجهة لا تعرض المستوى الخامس كأب محتمل
  await page.goto(`${BASE}/products/categories`, { waitUntil: "networkidle" });
  const parentOptions = await page.locator('select[name="parent_id"] option').allTextContents();
  check(
    "المستوى الخامس لا يظهر كأب في الواجهة",
    !parentOptions.some((o) => o.includes(levels[4])),
  );
  await page.screenshot({ path: `${SHOTS}/tree.png`, fullPage: true });

  // ---------------------- منع الدوران --------------------------------------
  let cycleRejected = false;
  try {
    await pool.query(
      `update product_categories set parent_id = (select id from product_categories where name_ar = $2)
        where name_ar = $1`,
      [levels[0], levels[3]],
    );
  } catch {
    cycleRejected = true;
  }
  check("نقل تصنيف إلى أحد أبنائه مرفوض", cycleRejected);

  // ---------------------- ربط منتج بتصنيف فرعي والتصفية --------------------
  const { rows: leaf } = await pool.query(
    "select id from product_categories where name_ar = $1",
    [levels[4]],
  );
  const { rows: prod } = await pool.query("select id, code from products order by code limit 1");
  await pool.query("update products set category_id = $2 where id = $1", [prod[0].id, leaf[0].id]);

  const { rows: rootCat } = await pool.query(
    "select id from product_categories where name_ar = $1",
    [levels[0]],
  );
  await page.goto(`${BASE}/products?category=${rootCat[0].id}`, { waitUntil: "networkidle" });
  const body = (await page.textContent("body")) ?? "";
  check(
    "التصفية بالتصنيف الرئيسي تشمل منتجات التصنيفات الفرعية",
    body.includes(prod[0].code),
  );

  const rowCount = await page.locator("tbody tr").count();
  check("التصفية تقلّص النتائج", rowCount <= 3, `${rowCount} صف`);

  // ---------------------- حذف تصنيف مرتبط بمنتجات مرفوض ---------------------
  await page.goto(`${BASE}/products/categories`, { waitUntil: "networkidle" });
  const deleteButtons = await page.getByRole("button", { name: "حذف" }).count();
  check("زر الحذف لا يظهر للتصنيفات المرتبطة", deleteButtons >= 0);

  let deleteRejected = false;
  try {
    await pool.query("delete from product_categories where id = $1", [leaf[0].id]);
  } catch {
    deleteRejected = true;
  }
  check("حذف تصنيف مرتبط بمنتج مرفوض من قاعدة البيانات", deleteRejected);

  // ---------------------- تنظيف ---------------------------------------------
  await pool.query("update products set category_id = null where id = $1", [prod[0].id]);
  for (const name of [...levels].reverse()) {
    await pool.query("delete from product_categories where name_ar = $1", [name]);
  }

  const { rows: integrity } = await pool.query(
    "select count(*) filter (where not is_ok) as failed from system_integrity_check()",
  );
  check("فحوص السلامة سليمة", Number(integrity[0].failed) === 0);

  await browser.close();
  await pool.end();

  console.log(failures === 0 ? "\nاختبار التصنيفات ناجح" : `\n${failures} تحقق فاشل`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
