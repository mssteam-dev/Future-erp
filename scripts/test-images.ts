/**
 * اختبار صور المنتجات من الواجهة: رفع صورة، التأكد من حفظها وظهورها في شاشة البيع.
 *   npx tsx scripts/test-images.ts [baseUrl] [imageDir]
 */
import { chromium, type Page } from "playwright";
import { Pool } from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const IMG_DIR = process.argv[3] ?? "/tmp/claude-0/-home-claude/e19c31b4-d77e-5036-b4e4-edbd1c6f0e95/scratchpad/img";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/erp-img";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/erp_dev",
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', "admin");
  await page.fill('input[name="password"]', "admin123");
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type="submit"]')]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser
    .newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar" })
    .then((c) => c.newPage());

  await login(page);

  const { rows: products } = await pool.query(
    "select id, code, name_ar from products order by code limit 2",
  );

  // ---------------------- 1) رفع صورة لمنتج من الواجهة ----------------------
  await page.goto(`${BASE}/products/${products[0].id}`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', `${IMG_DIR}/rice.jpg`);
  await page.waitForTimeout(800);

  const previewSrc = await page.locator('img[alt="صورة المنتج"]').getAttribute("src");
  check("الصورة صُغِّرت في المتصفح قبل الرفع", Boolean(previewSrc?.startsWith("data:image/jpeg")));

  await Promise.all([
    page.waitForURL((u) => u.pathname === "/products"),
    page.getByRole("button", { name: "حفظ التعديلات" }).click(),
  ]);

  const { rows: saved } = await pool.query(
    "select octet_length(image) as bytes, image_mime from products where id = $1",
    [products[0].id],
  );
  check(
    "الصورة حُفظت في قاعدة البيانات",
    Number(saved[0].bytes) > 1000 && saved[0].image_mime === "image/jpeg",
    `${Math.round(Number(saved[0].bytes) / 1024)} كيلوبايت`,
  );
  check("الحجم المحفوظ صغير (أقل من ١٥٠ كيلوبايت)", Number(saved[0].bytes) < 150_000);

  // ---------------------- 2) الصورة تُعرض عبر الرابط ------------------------
  const fetched = await page.evaluate(async (id) => {
    const r = await fetch(`/api/products/${id}/image`);
    const blob = await r.blob();
    return { status: r.status, type: r.headers.get("content-type") ?? "", size: blob.size };
  }, products[0].id);
  check(
    "رابط الصورة يعمل",
    fetched.status === 200 && fetched.type.startsWith("image/") && fetched.size > 1000,
    `${fetched.status} ${fetched.type} ${fetched.size}ب`,
  );

  // ---------------------- 3) الصورة تظهر في قائمة المنتجات -------------------
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  const thumbs = await page.locator(`img[src*="/api/products/"]`).count();
  check("الصورة تظهر في قائمة المنتجات", thumbs >= 1, `${thumbs} صورة`);

  // ---------------------- 4) منتقي المنتجات في فاتورة المبيعات ---------------
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.locator("tbody button.input").first().click();
  await page.waitForTimeout(400);

  const pickerVisible = await page.getByPlaceholder("ابحث بالاسم أو الكود…").isVisible();
  check("منتقي المنتجات يفتح بمربع بحث", pickerVisible);

  await page.getByPlaceholder("ابحث بالاسم أو الكود…").fill(products[0].name_ar.slice(0, 6));
  await page.waitForTimeout(400);
  const pickerThumbs = await page.locator(`img[src*="/api/products/"]`).count();
  check("نتائج البحث تعرض صور المنتجات", pickerThumbs >= 1, `${pickerThumbs} صورة`);

  await page.screenshot({ path: `${SHOTS}/picker.png` });

  // اختيار المنتج من المنتقي
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const chosen = await page.locator("tbody button.input").first().textContent();
  check(
    "اختيار المنتج من المنتقي يملأ السطر",
    Boolean(chosen && chosen.includes(products[0].code)),
    chosen?.trim().slice(0, 40),
  );

  const priceValue = await page.locator("tbody input[type=number]").nth(1).inputValue();
  check("سعر البيع يُملأ تلقائيًا بعد الاختيار", Number(priceValue) > 0, `السعر ${priceValue}`);

  await page.screenshot({ path: `${SHOTS}/line.png` });

  // ---------------------- 5) حذف الصورة ------------------------------------
  await page.goto(`${BASE}/products/${products[0].id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "حذف" }).first().click();
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/products"),
    page.getByRole("button", { name: "حفظ التعديلات" }).click(),
  ]);
  const { rows: afterDelete } = await pool.query(
    "select image is null as cleared from products where id = $1",
    [products[0].id],
  );
  check("حذف الصورة يعمل", afterDelete[0].cleared === true);

  // إعادة الصورة لتبقى في البيانات التجريبية
  await page.goto(`${BASE}/products/${products[0].id}`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', `${IMG_DIR}/rice.jpg`);
  await page.waitForTimeout(700);
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/products"),
    page.getByRole("button", { name: "حفظ التعديلات" }).click(),
  ]);

  await page.goto(`${BASE}/products/${products[1].id}`, { waitUntil: "networkidle" });
  await page.setInputFiles('input[type="file"]', `${IMG_DIR}/oil.jpg`);
  await page.waitForTimeout(700);
  await Promise.all([
    page.waitForURL((u) => u.pathname === "/products"),
    page.getByRole("button", { name: "حفظ التعديلات" }).click(),
  ]);

  // ---------------------- 6) سلامة البيانات لم تتأثر ------------------------
  const { rows: integrity } = await pool.query(
    "select count(*) filter (where not is_ok) as failed from system_integrity_check()",
  );
  check("فحوص السلامة سليمة", Number(integrity[0].failed) === 0);

  await browser.close();
  await pool.end();

  console.log(failures === 0 ? "\nاختبار الصور ناجح" : `\n${failures} تحقق فاشل`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
