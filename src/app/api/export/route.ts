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
  shipments: {
    name: "تقرير الشحنات",
    sql: "select * from report_shipments($1::date, $2::date, $3::uuid)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null],
  },
  "product-costs": {
    name: "بطاقات تكلفة المنتجات",
    sql: "select * from report_product_costs($1::uuid)",
    args: (p) => [p.get("branch") || null],
  },
  "stock-layers": {
    name: "دفعات المخزون",
    sql: "select * from report_stock_layers($1::uuid, null, $2)",
    args: (p) => [p.get("branch") || null, p.get("open") !== "all"],
  },
  prepaid: {
    name: "المصاريف المدفوعة مقدمًا",
    sql: "select * from report_prepaid($1::uuid)",
    args: (p) => [p.get("branch") || null],
  },
  "operating-expenses": {
    name: "المصاريف التشغيلية",
    sql: "select * from report_operating_expenses($1::date, $2::date, $3::uuid)",
    args: (p) => [p.get("from"), p.get("to"), p.get("branch") || null],
  },
  transfers: {
    name: "التحويلات بين الجهات",
    sql: "select * from report_transfers($1::date, $2::date)",
    args: (p) => [p.get("from"), p.get("to")],
  },
  consolidated: {
    name: "التقرير المجمّع",
    sql: "select * from report_consolidated($1::date, $2::date)",
    args: (p) => [p.get("from"), p.get("to")],
  },
  "period-close": {
    name: "تقرير الإقفال الشهري",
    sql: "select * from report_period_close($1::int, $2::int)",
    args: (p) => [
      Number(p.get("year")) || new Date().getFullYear(),
      Number(p.get("month")) || new Date().getMonth() + 1,
    ],
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
  invoice_no: "رقم الفاتورة", shipment_no: "رقم الشحنة", invoice_date: "التاريخ",
  supplier_name: "المورد", carrier: "جهة الشحن", alloc_method: "طريقة التوزيع",
  pieces: "القطع", total_weight_kg: "الوزن (كجم)", goods_value: "قيمة البضاعة",
  freight: "الشحن", customs: "التخليص", transport: "النقل", insurance: "التأمين",
  other_expenses: "مصاريف أخرى", landed_total: "الإجمالي بعد المصاريف",
  per_kg_cost: "مصاريف الكيلو", per_piece_cost: "مصاريف القطعة",
  base_price: "السعر الأساسي", loaded_expense: "مصاريف محمّلة", final_cost: "التكلفة النهائية",
  sale_price: "سعر البيع", last_weight_kg: "وزن آخر شحنة", unit_weight_kg: "وزن القطعة",
  qty_available: "المتاح", qty_returned: "المرتجع",
  received_date: "تاريخ الاستلام", doc_type: "نوع المستند", doc_no: "المستند / الشحنة",
  original_qty: "الكمية الأصلية", remaining_qty: "المتبقي", unit_cost: "تكلفة القطعة",
  remaining_value: "قيمة المتبقي",
  prepaid_no: "الرقم", name: "البيان", expense_type: "نوع المصروف", pay_date: "تاريخ الدفع",
  start_date: "من", end_date: "إلى", months: "الأشهر", total_amount: "المبلغ المدفوع",
  monthly_amount: "القسط الشهري", months_charged: "أشهر محمّلة", amortized_amount: "المحمّل",
  remaining_amount: "المتبقي", status: "الحالة",
  is_admin: "إداري", transfer_no: "رقم التحويل", transfer_date: "التاريخ",
  from_branch: "من", to_branch: "إلى", lines_count: "الأصناف", total_qty: "الكمية",
  total_cost: "التكلفة الأصلية",
  external_sales: "مبيعات خارجية (صافي)", other_revenue: "إيرادات أخرى",
  operating_expenses: "المصاريف", transfers_out: "تحويلات صادرة", transfers_in: "تحويلات واردة",
  purchases: "المشتريات", prepaid_balance: "مدفوع مقدمًا",
};

/** أعمدة نصية لا تُحوَّل إلى أرقام في ملف Excel حتى لا تضيع الأصفار من الأكواد */
const TEXT_COLUMN = /(code|_no$|^no$|name|type|status|method|kind|carrier|reference|alloc_method)/;

function cellValue(key: string, value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const d = value;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  const s = String(value);
  if (!TEXT_COLUMN.test(key) && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

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

  if (params.get("format") === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report.name.slice(0, 31), {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    ws.columns = columns.map((c) => ({
      header: HEADERS[c] ?? c,
      key: c,
      width: Math.max(12, Math.min(34, (HEADERS[c] ?? c).length + 6)),
    }));
    for (const r of rows) {
      ws.addRow(Object.fromEntries(columns.map((c) => [c, cellValue(c, r[c])])));
    }
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A6E" } };
    head.alignment = { horizontal: "center", vertical: "middle" };
    ws.eachRow((row, n) => {
      if (n === 1) return;
      row.eachCell((cell) => {
        if (typeof cell.value === "number") cell.numFmt = "#,##0.00##";
      });
    });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const xlsxName = `${report.name}-${params.get("from") ?? ""}.xlsx`;
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(xlsxName)}`,
      },
    });
  }

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
