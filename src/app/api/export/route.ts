import { NextRequest } from "next/server";
import { queryAs, requirePermission } from "@/lib/auth";
import { currentMonthRange } from "@/lib/format";

/** تصدير التقارير إلى CSV يفتح مباشرة في Excel بالعربية */
const REPORTS: Record<string, { sql: string; args: (p: URLSearchParams) => unknown[]; name: string }> = {
  branches: {
    name: "التقرير المالي للفروع",
    sql: "select * from report_branch_financial($1::date, $2::date, $3::uuid)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null],
  },
  products: {
    name: "ربحية المنتجات",
    sql: "select * from report_product_profitability($1::date, $2::date, $3::uuid, $4)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null, p.get("zero") === "1"],
  },
  "top-sales": {
    name: "أعلى المنتجات مبيعًا",
    sql: "select * from report_top_products($1::date, $2::date, $3::uuid, $4, $5)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null,
                  p.get("order") === "quantity" ? "quantity" : "sales", Number(p.get("limit") ?? 10)],
  },
  "top-profit": {
    name: "أعلى المنتجات ربحًا",
    sql: "select * from report_top_products($1::date, $2::date, $3::uuid, 'profit', $4)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null, Number(p.get("limit") ?? 10)],
  },
  inventory: {
    name: "أرصدة المخزون",
    sql: "select * from report_inventory($1::uuid, $2)",
    args: (p) => [p.get("branch") || null, p.get("low") === "1"],
  },
  "trial-balance": {
    name: "ميزان المراجعة",
    sql: "select * from report_trial_balance($1::date, $2::date, $3::uuid)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null],
  },
  collections: {
    name: "تقرير التحصيلات",
    sql: "select * from report_collections($1::date, $2::date, $3::uuid)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null],
  },
  company: {
    name: "ملخص الشركة",
    sql: "select * from report_company_summary($1::date, $2::date)",
    args: (p) => [p.get("from"), p.get("to")],
  },
};

const HEADERS: Record<string, string> = {
  branch_id: "معرف الوحدة", branch_name: "الوحدة", branch_kind: "النوع",
  gross_sales: "إجمالي المبيعات", sales_returns: "مرتجعات المبيعات",
  sales_discounts: "الخصومات", net_sales: "صافي المبيعات", cogs: "تكلفة البضاعة المباعة",
  gross_profit: "مجمل الربح", margin_before: "هامش الربح قبل المصاريف",
  direct_expenses: "المصاريف المباشرة", admin_share: "نصيب المصاريف الإدارية",
  total_expenses: "إجمالي المصاريف", net_profit: "صافي الربح",
  margin_after: "هامش الربح بعد المصاريف", collections: "التحصيلات",
  receivables: "الذمم المدينة", payables: "الذمم الدائنة", inventory_value: "قيمة المخزون",
  cash_balance: "رصيد الصندوق", bank_balance: "رصيد البنك",
  product_id: "معرف المنتج", product_code: "كود المنتج", product_name: "اسم المنتج",
  category_name: "التصنيف", qty_sold: "الكمية المباعة", margin_pct: "هامش الربح",
  rank_no: "الترتيب", quantity: "الكمية", avg_cost: "متوسط التكلفة",
  stock_value: "قيمة المخزون", reorder_level: "حد إعادة الطلب", is_low: "قارب على النفاد",
  account_code: "كود الحساب", account_name: "اسم الحساب", account_type: "نوع الحساب",
  opening_balance: "رصيد أول المدة", period_debit: "مدين", period_credit: "دائن",
  closing_balance: "الرصيد الختامي", collection_date: "التاريخ", collection_no: "رقم السند",
  customer_name: "العميل", method: "طريقة التحصيل", treasury_name: "الحساب",
  amount: "المبلغ", reference: "المرجع",
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  await requirePermission("reports.export");

  const params = request.nextUrl.searchParams;
  const key = params.get("report") ?? "";
  const report = REPORTS[key];
  if (!report) return new Response("تقرير غير معروف", { status: 400 });

  const def = currentMonthRange();
  if (!params.get("from")) params.set("from", def.from);
  if (!params.get("to")) params.set("to", def.to);

  const rows = await queryAs<Record<string, unknown>>(report.sql, report.args(params));
  const columns = rows.length ? Object.keys(rows[0]).filter((c) => !c.endsWith("_id")) : [];

  const lines = [
    columns.map((c) => csvCell(HEADERS[c] ?? c)).join(","),
    ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
  ];

  // BOM حتى يفتح Excel الملف بترميز UTF-8 ويعرض العربية سليمة
  const body = "\uFEFF" + lines.join("\r\n");
  const filename = `${report.name}-${params.get("from")}.csv`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
