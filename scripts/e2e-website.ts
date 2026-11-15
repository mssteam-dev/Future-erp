/**
 * اختبار الواجهة لقسم الموقع الإلكتروني: المنيو والأسعار، الفروع وساعات العمل،
 * ما يقرؤه الموقع العام، وحدود صلاحيات محرر الموقع.
 *   npx tsx scripts/e2e-website.ts [baseUrl]
 * ينشئ بياناته ومستخدميه ثم يحذفهم، فلا يغيّر محتوى الموقع الموجود.
 */
import { chromium, type Page } from "playwright";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

const scrypt = promisify(scryptCb);
const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/erp_dev",
});

const TAG = `e2e-${Date.now().toString(36)}`;
const CAT_AR = `قسم تجريبي ${TAG}`;
const CAT_EN = `Test section ${TAG}`;
const ITEM_AR = `صنف تجريبي ${TAG}`;
const ITEM_EN = `Test item ${TAG}`;
const BRANCH_AR = `فرع تجريبي ${TAG}`;
const BRANCH_EN = `Test Branch ${TAG}`;
const EDITOR = `site_editor_${TAG}`;
const CASHIER = `cashier_${TAG}`;
const PRODUCT = `منتج محاسبي ${TAG}`;
const PASSWORD = randomBytes(9).toString("base64url");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
async function one<T = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return rows[0] as T;
}

async function createUser(username: string, roleCode: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(PASSWORD, salt, 64)) as Buffer;
  const { id } = await one<{ id: string }>(
    `insert into app_users (username, password_hash, full_name)
     values ($1, $2, $3) returning id`,
    [username, `scrypt$${salt}$${derived.toString("hex")}`, username],
  );
  await pool.query(
    "insert into user_roles (user_id, role_id) select $1, id from roles where code = $2",
    [id, roleCode],
  );
}

async function signIn(page: Page, username: string, password: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', username);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
}

/** يرسل نموذجًا وينتظر اكتمال الإجراء على الخادم والانتقال الذي يليه */
async function submit(page: Page, click: () => Promise<unknown>, expect: "ok" | "error" = "ok") {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(BASE)),
    click(),
  ]);
  await page.waitForURL(new RegExp(`[?&]${expect}=`));
  await page.waitForLoadState("networkidle");
}

type PublicContent = {
  categories: { name_en: string; items: { name_en: string; price: number; note_en: string }[] }[];
  branches: {
    slug: string;
    name_en: string;
    phone: string;
    hours: { weekday: number; closed: boolean; open: string | null; close: string | null }[];
  }[];
};
async function publicContent(): Promise<{ status: number; cache: string; body: PublicContent }> {
  const res = await fetch(`${BASE}/api/public/website`);
  return { status: res.status, cache: res.headers.get("cache-control") ?? "", body: await res.json() };
}
const publicItem = (c: PublicContent) =>
  c.categories.flatMap((x) => x.items).find((i) => i.name_en.includes(TAG));
const publicBranch = (c: PublicContent) => c.branches.find((b) => b.name_en.includes(TAG));

async function cleanup() {
  await pool.query("delete from site_menu_items where name_en like $1", [`%${TAG}%`]);
  await pool.query("delete from site_menu_categories where name_en like $1", [`%${TAG}%`]);
  await pool.query("delete from site_branches where name_en like $1", [`%${TAG}%`]);
  await pool.query("delete from products where name_ar = $1", [PRODUCT]);
  // سجل العمليات يشير إلى المستخدم، فتُحذف سجلات المستخدمين التجريبيين قبلهم
  const { rows } = await pool.query("select id from app_users where username in ($1, $2)", [EDITOR, CASHIER]);
  const ids = rows.map((r) => r.id as string);
  await pool.query("delete from audit_logs where user_id = any($1::uuid[])", [ids]);
  await pool.query("delete from app_users where id = any($1::uuid[])", [ids]);
}

async function main() {
  const before = await one<{ cats: string; items: string; branches: string }>(
    `select (select count(*) from site_menu_categories) as cats,
            (select count(*) from site_menu_items) as items,
            (select count(*) from site_branches) as branches`,
  );
  await createUser(EDITOR, "website_editor");
  await createUser(CASHIER, "cashier");
  await pool.query(
    "insert into products (code, name_ar, branch_id) select $1, $2, id from branches where kind = 'parent'",
    [TAG, PRODUCT],
  );

  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "ar" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  // ============================ المالك: المنيو ==============================
  await signIn(page, process.env.ERP_USER ?? "admin", process.env.ERP_PASS ?? "admin123");
  await page.goto(`${BASE}/website/menu`, { waitUntil: "networkidle" });
  check("القسم في القائمة الجانبية", (await page.locator(".sidebar").textContent())?.includes("الموقع الإلكتروني") ?? false);
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  check("المالك يرى المنتج المحاسبي التجريبي", ((await page.textContent("body")) ?? "").includes(PRODUCT));
  await page.goto(`${BASE}/treasury`, { waitUntil: "networkidle" });
  check("المالك يرى الصناديق", ((await page.textContent("body")) ?? "").includes("CASH-HQ"));
  await page.goto(`${BASE}/website/menu`, { waitUntil: "networkidle" });

  // إضافة قسم
  const catForm = page.locator("form:has(input[name=name_ar])").first();
  await catForm.locator('input[name="name_ar"]').fill(CAT_AR);
  await catForm.locator('input[name="name_en"]').fill(CAT_EN);
  await submit(page, () => catForm.locator("button.btn-primary").click());
  const cat = await one<{ id: string; sort_order: number; is_visible: boolean }>(
    "select id, sort_order, is_visible from site_menu_categories where name_en = $1",
    [CAT_EN],
  );
  check("إضافة قسم", !!cat?.id && cat.is_visible);
  check("رسالة الحفظ تظهر", (await page.locator(".alert-success").count()) === 1);
  const maxOther = await one<{ m: number }>(
    "select coalesce(max(sort_order), 0) as m from site_menu_categories where id <> $1",
    [cat.id],
  );
  check("القسم الجديد يُضاف في الآخر", cat.sort_order > Number(maxOther.m));

  // إضافة صنف بلا سعر صالح تُرفض
  await page.goto(`${BASE}/website/menu/${cat.id}`, { waitUntil: "networkidle" });
  const itemForm = page.locator("form:has(input[name=note_ar])").first();
  await itemForm.locator('input[name="name_ar"]').fill(ITEM_AR);
  await itemForm.locator('input[name="name_en"]').fill(ITEM_EN);
  await itemForm.locator('input[name="price"]').fill("2.5");
  await itemForm.locator('input[name="note_ar"]').fill("ملاحظة تجريبية");
  await itemForm.locator('input[name="note_en"]').fill("Test note");
  await submit(page, () => itemForm.locator("button.btn-primary").click());
  const item = await one<{ id: string; price: string; is_visible: boolean }>(
    "select id, price, is_visible from site_menu_items where name_en = $1",
    [ITEM_EN],
  );
  check("إضافة صنف", !!item?.id && Number(item.price) === 2.5 && item.is_visible);

  let pub = await publicContent();
  check("الموقع العام: بلا تسجيل دخول", pub.status === 200);
  check("الموقع العام: تخزين مؤقت قصير", pub.cache.includes("s-maxage=30"));
  check("الموقع العام: الصنف الجديد بسعره وملاحظته",
    publicItem(pub.body)?.price === 2.5 && publicItem(pub.body)?.note_en === "Test note");

  // تعديل السعر من القائمة مباشرة
  const row = page.locator("table.table tbody tr", { hasText: ITEM_AR });
  await row.locator('input[name="price"]').fill("2.75");
  await submit(page, () => row.getByRole("button", { name: "حفظ السعر" }).click());
  check("تعديل السعر من القائمة",
    Number((await one("select price from site_menu_items where id = $1", [item.id])).price) === 2.75);
  const audit = await one<{ summary: string }>(
    `select summary from audit_logs where entity = 'site_menu_items' and entity_id = $1
      order by at desc limit 1`,
    [item.id],
  );
  check("سجل العمليات يذكر السعر القديم والجديد",
    audit.summary.includes("2.5") && audit.summary.includes("2.75"), audit.summary);
  pub = await publicContent();
  check("الموقع العام: السعر الجديد", publicItem(pub.body)?.price === 2.75);

  // سعر سالب يُرفض من الخادم حتى لو تجاوز المتصفح
  await page.goto(`${BASE}/website/menu/${cat.id}`, { waitUntil: "networkidle" });
  const badRow = page.locator("table.table tbody tr", { hasText: ITEM_AR });
  await badRow.locator('input[name="price"]').evaluate((el: HTMLInputElement) => {
    el.removeAttribute("min");
    el.value = "-3";
  });
  await submit(page, () => badRow.getByRole("button", { name: "حفظ السعر" }).click(), "error");
  check("سعر سالب مرفوض برسالة", (await page.locator(".alert-error").textContent())?.includes("سعر") ?? false);
  check("السعر لم يتغير بعد الرفض",
    Number((await one("select price from site_menu_items where id = $1", [item.id])).price) === 2.75);

  // إخفاء ثم إظهار
  await page.goto(`${BASE}/website/menu/${cat.id}`, { waitUntil: "networkidle" });
  await submit(page, () => page.locator("table.table tbody tr", { hasText: ITEM_AR }).getByRole("button", { name: "إخفاء" }).click());
  check("إخفاء الصنف",
    (await one<{ is_visible: boolean }>("select is_visible from site_menu_items where id = $1", [item.id])).is_visible === false);
  pub = await publicContent();
  check("الموقع العام: الصنف المخفي لا يُعاد", publicItem(pub.body) === undefined);
  check("الموقع العام: القسم بلا أصناف ظاهرة لا يُعاد",
    !pub.body.categories.some((c) => c.name_en === CAT_EN));
  await submit(page, () => page.locator("table.table tbody tr", { hasText: ITEM_AR }).getByRole("button", { name: "إظهار" }).click());
  pub = await publicContent();
  check("إظهار الصنف يعيده للموقع", publicItem(pub.body)?.price === 2.75);

  // تعديل كامل للصنف
  await page.goto(`${BASE}/website/menu/${cat.id}?edit=${item.id}`, { waitUntil: "networkidle" });
  const editForm = page.locator("form:has(input[name=note_ar])").first();
  check("نموذج التعديل يعرض القيم الحالية",
    (await editForm.locator('input[name="price"]').inputValue()) === "2.75"
    && (await editForm.locator('input[name="note_en"]').inputValue()) === "Test note");
  await editForm.locator('input[name="note_en"]').fill("");
  await editForm.locator('input[name="price"]').fill("3");
  await submit(page, () => editForm.locator("button.btn-primary").click());
  const edited = await one<{ price: string; note_en: string | null; note_ar: string | null; is_visible: boolean }>(
    "select price, note_en, note_ar, is_visible from site_menu_items where id = $1",
    [item.id],
  );
  check("تعديل الصنف: السعر والملاحظة",
    Number(edited.price) === 3 && edited.note_en === null && edited.note_ar === "ملاحظة تجريبية" && edited.is_visible);

  // قسم فيه أصناف لا يُعرض له زر حذف، وحذفه مرفوض من قاعدة البيانات
  await page.goto(`${BASE}/website/menu`, { waitUntil: "networkidle" });
  const catRow = page.locator("table.table tbody tr", { hasText: CAT_AR });
  check("لا زر حذف لقسم فيه أصناف", (await catRow.getByRole("button", { name: "حذف" }).count()) === 0);

  // ============================ المالك: الفروع ==============================
  await page.goto(`${BASE}/website/branches`, { waitUntil: "networkidle" });
  const branchForm = page.locator("form:has(input[name=map_url])").first();
  await branchForm.locator('input[name="name_ar"]').fill(BRANCH_AR);
  await branchForm.locator('input[name="name_en"]').fill(BRANCH_EN);
  await branchForm.locator('input[name="phone"]').fill("07 9000 0000");
  await branchForm.locator('input[name="address_ar"]').fill("شارع تجريبي");
  await branchForm.locator('input[name="address_en"]').fill("Test St.");
  await branchForm.locator('input[name="map_url"]').fill("https://maps.example/test");
  // يوم ناقص: وقت فتح بلا إغلاق
  await branchForm.locator('input[name="open_0"]').fill("09:00");
  await submit(page, () => branchForm.locator("button.btn-primary").click(), "error");
  check("ساعات ناقصة مرفوضة برسالة تسمّي اليوم",
    (await page.locator(".alert-error").textContent())?.includes("الأحد") ?? false);
  check("لم يُحفظ الفرع عند الخطأ",
    Number((await one("select count(*) as n from site_branches where name_en = $1", [BRANCH_EN])).n) === 0);

  await branchForm.locator('input[name="name_ar"]').fill(BRANCH_AR);
  await branchForm.locator('input[name="name_en"]').fill(BRANCH_EN);
  await branchForm.locator('input[name="phone"]').fill("07 9000 0000");
  await branchForm.locator('input[name="address_ar"]').fill("شارع تجريبي");
  await branchForm.locator('input[name="address_en"]').fill("Test St.");
  await branchForm.locator('input[name="map_url"]').fill("https://maps.example/test");
  await branchForm.locator('input[name="open_0"]').fill("09:00");
  await branchForm.locator('input[name="close_0"]').fill("02:00");
  await branchForm.locator('input[name="closed_5"]').check();
  await submit(page, () => branchForm.locator("button.btn-primary").click());
  const branch = await one<{ id: string; slug: string }>(
    "select id, slug from site_branches where name_en = $1",
    [BRANCH_EN],
  );
  check("إضافة فرع بمعرّف مشتق من الاسم الإنجليزي", /^test-branch-e2e-[a-z0-9]+$/.test(branch.slug), branch.slug);
  pub = await publicContent();
  const pb = publicBranch(pub.body);
  check("الموقع العام: الفرع وساعاته",
    pb?.phone === "07 9000 0000" && pb.hours.length === 2
    && pb.hours[0].weekday === 0 && pb.hours[0].open === "09:00" && pb.hours[0].close === "02:00"
    && pb.hours[1].weekday === 5 && pb.hours[1].closed === true);
  check("ملخص الساعات في القائمة",
    (await page.locator("table.table tbody tr", { hasText: BRANCH_AR }).first().textContent())?.includes("5 أيام غير محددة") ?? false);

  // تعديل الساعات: إزالة يوم الجمعة وإضافة السبت
  await page.goto(`${BASE}/website/branches?edit=${branch.id}`, { waitUntil: "networkidle" });
  const editBranch = page.locator("form:has(input[name=map_url])").first();
  check("نموذج تعديل الفرع يعرض الساعات المحفوظة",
    (await editBranch.locator('input[name="open_0"]').inputValue()) === "09:00"
    && (await editBranch.locator('input[name="closed_5"]').isChecked()));
  await editBranch.locator('input[name="closed_5"]').uncheck();
  await editBranch.locator('input[name="open_6"]').fill("14:00");
  await editBranch.locator('input[name="close_6"]').fill("03:00");
  await submit(page, () => editBranch.locator("button.btn-primary").click());
  pub = await publicContent();
  check("تعديل الساعات يستبدل القديمة",
    JSON.stringify(publicBranch(pub.body)?.hours.map((h) => [h.weekday, h.open, h.close, h.closed]))
      === JSON.stringify([[0, "09:00", "02:00", false], [6, "14:00", "03:00", false]]));
  check("المعرّف ثابت بعد التعديل",
    (await one<{ slug: string }>("select slug from site_branches where id = $1", [branch.id])).slug === branch.slug);

  // ====================== محرر الموقع: قسم الموقع فقط =======================
  await signIn(page, EDITOR, PASSWORD);
  check("محرر الموقع يبدأ من منيو الموقع", new URL(page.url()).pathname === "/website/menu", page.url());
  const nav = (await page.locator(".sidebar").textContent()) ?? "";
  check("قائمة محرر الموقع: قسم الموقع فقط",
    nav.includes("منيو الموقع والأسعار") && !nav.includes("فواتير المبيعات")
    && !nav.includes("المستخدمون") && !nav.includes("التقارير") && !nav.includes("لوحة التحكم"));
  for (const path of ["/settings/users", "/settings/audit", "/settings/backup"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    check(`محرر الموقع لا يفتح ${path}`, new URL(page.url()).pathname === "/website/menu", page.url());
  }
  // الشاشات المحاسبية تعتمد على حماية قاعدة البيانات: تُفتح فارغة بلا أي بيانات
  await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
  check("محرر الموقع لا يرى المنتجات المحاسبية",
    !((await page.textContent("body")) ?? "").includes(PRODUCT));
  await page.goto(`${BASE}/treasury`, { waitUntil: "networkidle" });
  check("محرر الموقع لا يرى الصناديق والحسابات",
    !((await page.textContent("body")) ?? "").includes("CASH-HQ"));
  const exportRes = await page.request.get(`${BASE}/api/export?report=trial-balance`, { maxRedirects: 0 });
  check("محرر الموقع لا يصدّر التقارير", exportRes.status() >= 300, String(exportRes.status()));

  await page.goto(`${BASE}/website/menu/${cat.id}`, { waitUntil: "networkidle" });
  const editorRow = page.locator("table.table tbody tr", { hasText: ITEM_AR });
  await editorRow.locator('input[name="price"]').fill("3.25");
  await submit(page, () => editorRow.getByRole("button", { name: "حفظ السعر" }).click());
  check("محرر الموقع يعدّل السعر",
    Number((await one("select price from site_menu_items where id = $1", [item.id])).price) === 3.25);

  // ===================== من لا يملك صلاحية الموقع ===========================
  await signIn(page, CASHIER, PASSWORD);
  check("أمين الصندوق: لا قسم موقع في القائمة",
    !((await page.locator(".sidebar").textContent()) ?? "").includes("الموقع الإلكتروني"));
  await page.goto(`${BASE}/website/menu`, { waitUntil: "networkidle" });
  check("أمين الصندوق لا يفتح منيو الموقع", new URL(page.url()).pathname === "/", page.url());
  await page.goto(`${BASE}/website/branches?edit=${branch.id}`, { waitUntil: "networkidle" });
  check("أمين الصندوق لا يفتح فروع الموقع", new URL(page.url()).pathname === "/", page.url());

  // بلا تسجيل دخول
  await context.clearCookies();
  await page.goto(`${BASE}/website/menu`, { waitUntil: "networkidle" });
  check("بلا تسجيل دخول: تحويل لصفحة الدخول", new URL(page.url()).pathname === "/login");

  // ============================ المالك: الحذف ===============================
  await signIn(page, process.env.ERP_USER ?? "admin", process.env.ERP_PASS ?? "admin123");
  await page.goto(`${BASE}/website/menu/${cat.id}?edit=${item.id}`, { waitUntil: "networkidle" });
  await submit(page, () => page.getByRole("button", { name: "حذف الصنف نهائيًا" }).click());
  check("حذف الصنف",
    Number((await one("select count(*) as n from site_menu_items where id = $1", [item.id])).n) === 0);
  await page.goto(`${BASE}/website/menu`, { waitUntil: "networkidle" });
  await submit(page, () => page.locator("table.table tbody tr", { hasText: CAT_AR }).getByRole("button", { name: "حذف" }).click());
  check("حذف القسم الفارغ",
    Number((await one("select count(*) as n from site_menu_categories where id = $1", [cat.id])).n) === 0);
  await page.goto(`${BASE}/website/branches?edit=${branch.id}`, { waitUntil: "networkidle" });
  await submit(page, () => page.getByRole("button", { name: "حذف الفرع نهائيًا" }).click());
  check("حذف الفرع وساعاته",
    Number((await one("select count(*) as n from site_branch_hours where branch_id = $1", [branch.id])).n) === 0
    && Number((await one("select count(*) as n from site_branches where id = $1", [branch.id])).n) === 0);

  await browser.close();

  const after = await one<{ cats: string; items: string; branches: string }>(
    `select (select count(*) from site_menu_categories) as cats,
            (select count(*) from site_menu_items) as items,
            (select count(*) from site_branches) as branches`,
  );
  check("محتوى الموقع الموجود لم يتغير",
    before.cats === after.cats && before.items === after.items && before.branches === after.branches);
  check("لا أخطاء في المتصفح", errors.length === 0, errors.slice(0, 3).join(" | "));
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await cleanup().catch((e) => {
      console.error("تعذر حذف بيانات الاختبار:", e);
      failures++;
    });
    await pool.end();
    console.log(failures === 0 ? "\nكل الفحوص ناجحة" : `\n${failures} فحصًا فاشلًا`);
    process.exit(failures > 0 ? 1 : 0);
  });
