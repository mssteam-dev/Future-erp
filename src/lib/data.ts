import "server-only";
import { queryAs } from "./auth";
import { currentMonthRange } from "./format";

export type Branch = { id: string; code: string; name_ar: string; kind: string };
export type Option = { id: string; code?: string; name: string };

export async function getBranches(): Promise<Branch[]> {
  return queryAs<Branch>(
    "select id, code, name_ar, kind from branches where is_active order by sort_order",
  );
}

export async function getSettings() {
  const rows = await queryAs<Record<string, unknown>>("select * from settings limit 1");
  return rows[0] ?? {};
}

export async function getTreasuryAccounts(branchId?: string) {
  return queryAs<{ id: string; name_ar: string; kind: string; branch_id: string }>(
    `select t.id, t.name_ar, t.kind, t.branch_id
       from treasury_accounts t
      where t.is_active ${branchId ? "and t.branch_id = $1" : ""}
      order by t.kind, t.name_ar`,
    branchId ? [branchId] : [],
  );
}

/** بطاقات المنتجات — لكل جهة بطاقاتها المستقلة، فتحمل كل بطاقة معرّف جهتها */
export async function getProducts() {
  return queryAs<{
    id: string;
    branch_id: string;
    code: string;
    name_ar: string;
    default_sale_price: string;
    default_unit_cost: string;
    tax_rate: string | null;
    has_image: boolean;
  }>(
    `select id, branch_id, code, name_ar, default_sale_price, default_unit_cost, tax_rate,
            (image is not null) as has_image
       from products where is_active order by code`,
  );
}

export async function getCustomers() {
  return queryAs<{ id: string; code: string; name: string }>(
    "select id, code, name from customers where is_active order by name",
  );
}

export async function getSuppliers() {
  return queryAs<{ id: string; code: string; name: string }>(
    "select id, code, name from suppliers where is_active order by name",
  );
}

export async function getExpenseTypes() {
  return queryAs<{ id: string; code: string; name_ar: string; is_admin: boolean }>(
    "select id, code, name_ar, is_admin from expense_types where is_active order by is_admin, name_ar",
  );
}

export async function getRevenueTypes() {
  return queryAs<{ id: string; code: string; name_ar: string }>(
    "select id, code, name_ar from revenue_types where is_active order by name_ar",
  );
}

/** الفترة المطلوبة من الرابط، أو الشهر الحالي افتراضيًا */
export function periodFrom(params: Record<string, string | undefined>) {
  const def = currentMonthRange();
  return {
    from: params.from || def.from,
    to: params.to || def.to,
    branch: params.branch || null,
  };
}
