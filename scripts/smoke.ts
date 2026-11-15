/**
 * اختبار دخاني للواجهة: تسجيل دخول حقيقي، ثم زيارة كل الشاشات والتقاط أي خطأ.
 *   npx tsx scripts/smoke.ts [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/erp-shots";

const ROUTES: [string, string][] = [
  ["/", "لوحة التحكم"],
  ["/sales", "فواتير المبيعات"],
  ["/sales/new", "فاتورة مبيعات جديدة"],
  ["/sales/returns", "مرتجعات المبيعات"],
  ["/sales/returns/new", "مرتجع مبيعات"],
  ["/purchases", "فواتير المشتريات"],
  ["/purchases/new", "فاتورة مشتريات جديدة"],
  ["/purchases/returns", "مرتجعات المشتريات"],
  ["/purchases/returns/new", "مرتجع مشتريات"],
  ["/inventory", "أرصدة المخزون"],
  ["/inventory/transfers", "تحويل البضائع"],
  ["/inventory/transfers/new", "تحويل بضاعة جديد"],
  ["/inventory/adjustments", "التسويات المخزنية"],
  ["/inventory/adjustments/new", "تسوية مخزنية"],
  ["/inventory/card", "بطاقة حركة المنتج"],
  ["/treasury", "الصناديق والحسابات"],
  ["/treasury/collections", "تحصيلات العملاء"],
  ["/treasury/collections/new", "سند قبض جديد"],
  ["/treasury/payments", "مدفوعات الموردين"],
  ["/treasury/payments/new", "سند صرف لمورد"],
  ["/treasury/transfers", "التحويل بين الصندوق والبنك"],
  ["/treasury/transfers/new", "تحويل بين الحسابات"],
  ["/treasury/vouchers", "سندات القبض والصرف"],
  ["/treasury/vouchers/new", "سند قبض / صرف"],
  ["/expenses", "المصاريف"],
  ["/expenses/new", "تسجيل مصروف"],
  ["/expenses/parent-revenue", "إيرادات الشركة الأم"],
  ["/expenses/parent-revenue/new", "تسجيل إيراد للشركة الأم"],
  ["/parties/customers", "العملاء"],
  ["/parties/suppliers", "الموردون"],
  ["/products", "المنتجات"],
  ["/products/categories", "تصنيفات المنتجات"],
  ["/reports/branches", "التقرير المالي للفروع"],
  ["/reports/company", "ملخص الشركة"],
  ["/reports/top-products", "أعلى 10 منتجات"],
  ["/reports/products", "ربحية المنتجات"],
  ["/reports/statements", "كشوف حسابات"],
  ["/reports/trial-balance", "ميزان المراجعة"],
  ["/reports/ledger", "كشف حساب"],
  ["/reports/collections", "تقرير التحصيلات"],
  ["/reports/consolidated", "التقرير المجمّع للشركة"],
  ["/reports/shipments", "تقرير الشحنات"],
  ["/reports/product-costs", "بطاقات تكلفة المنتجات"],
  ["/reports/stock-layers", "دفعات المخزون"],
  ["/reports/operating-expenses", "المصاريف التشغيلية"],
  ["/reports/prepaid", "المصاريف المدفوعة مقدمًا"],
  ["/reports/transfers", "التحويلات بين الجهات"],
  ["/reports/period-close", "تقرير إقفال شهر"],
  ["/expenses/prepaid", "المصاريف المدفوعة مقدمًا"],
  ["/website/menu", "منيو الموقع"],
  ["/website/branches", "فروع الموقع وساعات العمل"],
  ["/settings/opening", "الأرصدة الافتتاحية"],
  ["/settings", "إعدادات الشركة"],
  ["/settings/branches", "الشركة الأم والفروع"],
  ["/settings/accounts", "دليل الحسابات"],
  ["/settings/types", "أنواع المصاريف"],
  ["/settings/periods", "الفترات المالية"],
  ["/settings/users", "المستخدمون"],
  ["/settings/audit", "سجل العمليات"],
  ["/settings/backup", "النسخ الاحتياطي"],
];

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "ar" });
  const page = await context.newPage();

  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => errors.push(`[page] ${String(e).slice(0, 160)}`));

  // تسجيل الدخول من الواجهة نفسها
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="identifier"]', process.env.ERP_USER ?? "admin");
  await page.fill('input[name="password"]', process.env.ERP_PASS ?? "admin123");
  await Promise.all([page.waitForURL(`${BASE}/`), page.click('button[type="submit"]')]);
  console.log("✓ تسجيل الدخول");

  let failed = 0;
  for (const [route, expected] of ROUTES) {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;
    const body = await page.textContent("body");
    const hasText = body?.includes(expected) ?? false;
    const serverError =
      body?.includes("Application error") || body?.includes("Internal Server Error");

    if (status >= 400 || !hasText || serverError) {
      failed++;
      console.log(`✗ ${route} — الحالة ${status}${hasText ? "" : ` — لم يُعثر على «${expected}»`}`);
    } else {
      console.log(`✓ ${route}`);
    }
  }

  // لقطات للشاشات الرئيسية
  for (const route of ["/", "/sales/new", "/reports/branches", "/reports/top-products", "/inventory", "/settings/backup"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: `${SHOTS}/${route.replace(/\//g, "_") || "_home"}.png`,
      fullPage: route !== "/",
    });
  }

  await browser.close();

  if (errors.length) {
    console.log(`\nأخطاء المتصفح (${errors.length}):`);
    for (const e of [...new Set(errors)].slice(0, 10)) console.log("  " + e);
  }
  console.log(`\n${ROUTES.length - failed}/${ROUTES.length} شاشة سليمة`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
