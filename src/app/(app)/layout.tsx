import { redirect } from "next/navigation";
import { can, logout, requireUser } from "@/lib/auth";
import { withAdmin } from "@/lib/db";
import Sidebar, { type NavGroup } from "@/components/Sidebar";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await withAdmin(async (client) => {
    const { rows } = await client.query(
      "select company_name_ar, currency_code from settings limit 1",
    );
    return rows[0] ?? { company_name_ar: "النظام المحاسبي", currency_code: "JOD" };
  });

  const allGroups: (NavGroup & { perm?: string })[] = [
    {
      title: "عام",
      icon: "◳",
      perm: "dashboard.view",
      items: [{ href: "/", label: "لوحة التحكم" }],
    },
    {
      title: "المبيعات",
      icon: "▤",
      perm: "sales.view",
      items: [
        { href: "/sales", label: "فواتير المبيعات" },
        { href: "/sales/returns", label: "مرتجعات المبيعات" },
      ],
    },
    {
      title: "المشتريات",
      icon: "▥",
      perm: "purchases.view",
      items: [
        { href: "/purchases", label: "فواتير المشتريات" },
        { href: "/purchases/returns", label: "مرتجعات المشتريات" },
      ],
    },
    {
      title: "المخزون",
      icon: "▦",
      perm: "inventory.view",
      items: [
        { href: "/inventory", label: "أرصدة المخزون" },
        { href: "/inventory/transfers", label: "تحويل البضائع" },
        { href: "/inventory/adjustments", label: "التسويات والجرد" },
        { href: "/inventory/card", label: "بطاقة حركة منتج" },
      ],
    },
    {
      title: "الصندوق والبنك",
      icon: "▧",
      perm: "treasury.view",
      items: [
        { href: "/treasury", label: "الصناديق والحسابات" },
        { href: "/treasury/collections", label: "تحصيلات العملاء" },
        { href: "/treasury/payments", label: "مدفوعات الموردين" },
        { href: "/treasury/transfers", label: "التحويل بين الحسابات" },
        { href: "/treasury/vouchers", label: "سندات القبض والصرف" },
      ],
    },
    {
      title: "المصاريف والإيرادات",
      icon: "▨",
      perm: "expenses.view",
      items: [
        { href: "/expenses", label: "المصاريف" },
        { href: "/expenses/parent-revenue", label: "إيرادات الشركة الأم" },
      ],
    },
    {
      title: "الأطراف والمنتجات",
      icon: "▩",
      perm: "parties.view",
      items: [
        { href: "/parties/customers", label: "العملاء" },
        { href: "/parties/suppliers", label: "الموردون" },
        { href: "/products", label: "المنتجات" },
        { href: "/products/categories", label: "تصنيفات المنتجات" },
      ],
    },
    {
      title: "التقارير",
      icon: "◴",
      perm: "reports.view",
      items: [
        { href: "/reports/branches", label: "التقرير المالي للفروع" },
        { href: "/reports/company", label: "ملخص الشركة" },
        { href: "/reports/top-products", label: "أعلى 10 منتجات" },
        { href: "/reports/products", label: "ربحية المنتجات" },
        { href: "/reports/statements", label: "كشوف الحسابات" },
        { href: "/reports/trial-balance", label: "ميزان المراجعة" },
        { href: "/reports/ledger", label: "كشف حساب" },
        { href: "/reports/collections", label: "تقرير التحصيلات" },
      ],
    },
    {
      title: "الإعدادات",
      icon: "◰",
      perm: "settings.view",
      items: [
        { href: "/settings", label: "إعدادات الشركة" },
        { href: "/settings/branches", label: "الفروع" },
        { href: "/settings/accounts", label: "دليل الحسابات" },
        { href: "/settings/types", label: "أنواع المصاريف والإيرادات" },
        { href: "/settings/periods", label: "الفترات والإقفال" },
        { href: "/settings/users", label: "المستخدمون والصلاحيات" },
        { href: "/settings/audit", label: "سجل العمليات" },
        { href: "/settings/backup", label: "النسخ الاحتياطي" },
      ],
    },
  ];

  const groups = allGroups
    .filter((g) => !g.perm || can(user, g.perm))
    .map(({ title, icon, items }) => ({ title, icon, items }));

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar groups={groups} company={settings.company_name_ar} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          className="no-print"
          style={{
            height: 56,
            background: "#fff",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            position: "sticky",
            top: 0,
            zIndex: 30,
          }}
        >
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            العملة: <strong style={{ color: "var(--text)" }}>{settings.currency_code}</strong>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{user.fullName}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {user.isOwner ? "مالك النظام" : "مستخدم"}
              </div>
            </div>
            <form action={signOut}>
              <button className="btn btn-ghost btn-sm" type="submit">
                خروج
              </button>
            </form>
          </div>
        </header>

        <main style={{ flex: 1, padding: "22px 24px 48px", maxWidth: 1480, width: "100%" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
