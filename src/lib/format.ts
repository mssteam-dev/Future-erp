export type Settings = {
  company_name_ar: string;
  currency_code: string;
  currency_name_ar: string;
  decimals: number;
  brand_color: string;
  tax_enabled: boolean;
  default_tax_rate: number;
  allow_negative_stock: boolean;
  admin_allocation_method: string;
  fiscal_year_start_month: number;
  system_start_date: string;
};

let decimalsCache = 3;
export function setDecimals(d: number) {
  decimalsCache = d;
}

export function money(value: unknown, decimals = decimalsCache): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function qty(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10000) / 10000;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function pct(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function dateStr(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function dateTimeStr(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return `${dateStr(d)} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  posted: "مرحّلة",
  cancelled: "ملغاة",
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  sales_invoice: "فاتورة مبيعات",
  sales_return: "مرتجع مبيعات",
  purchase_invoice: "فاتورة مشتريات",
  purchase_return: "مرتجع مشتريات",
  stock_transfer: "تحويل بضاعة",
  stock_adjustment: "تسوية مخزنية",
  stock_count: "جرد",
  opening_stock: "مخزون افتتاحي",
  collection: "سند قبض من عميل",
  supplier_payment: "سند صرف لمورد",
  expense: "مصروف",
  parent_revenue: "إيراد الشركة الأم",
  treasury_transfer: "تحويل بين الحسابات",
  receipt_voucher: "سند قبض",
  payment_voucher: "سند صرف",
  opening_balance: "رصيد افتتاحي",
  period_closing: "إقفال فترة",
  journal_voucher: "قيد",
};

/** أول وآخر يوم في الشهر الحالي — الفترة الافتراضية في كل التقارير */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: dateStr(from), to: dateStr(to) };
}

export function monthName(month: number): string {
  return [
    "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
    "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
  ][month - 1] ?? String(month);
}
