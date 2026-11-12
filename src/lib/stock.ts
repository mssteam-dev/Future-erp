import "server-only";
import { queryAs } from "./auth";

export type StockMap = Record<string, Record<string, { quantity: number; avg_cost: number }>>;

/** أرصدة كل المنتجات في كل الوحدات — تُستخدم في شاشات الإدخال لمنع البيع بلا رصيد */
export async function getStockByBranch(): Promise<StockMap> {
  const rows = await queryAs<{
    branch_id: string;
    product_id: string;
    quantity: string;
    avg_cost: string;
  }>("select branch_id, product_id, quantity, avg_cost from product_branch_stock");

  const map: StockMap = {};
  for (const r of rows) {
    (map[r.branch_id] ??= {})[r.product_id] = {
      quantity: Number(r.quantity),
      avg_cost: Number(r.avg_cost),
    };
  }
  return map;
}
