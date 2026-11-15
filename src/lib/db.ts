import { Pool, type PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __erpPool: Pool | undefined;
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/erp_dev";

export const pool =
  global.__erpPool ??
  new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") global.__erpPool = pool;

/**
 * ينفذ العمل داخل جلسة بهوية المستخدم ودور authenticated،
 * فتُطبَّق سياسات RLS تمامًا كما تُطبَّق في الإنتاج.
 */
export async function withUser<T>(
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId ?? ""]);
    if (userId) await client.query("set local role authenticated");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** اتصال بصلاحيات كاملة — للمصادقة والمهام الإدارية فقط */
export async function withAdmin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export type Row = Record<string, unknown>;

/** رسالة خطأ عربية مفهومة بدل نص Postgres الخام */
export function dbErrorMessage(error: unknown): string {
  const e = error as { message?: string; code?: string; constraint?: string };
  const raw = e?.message ?? "حدث خطأ غير متوقع";

  if (e?.code === "23505") {
    if (e.constraint?.startsWith("products_") && e.constraint.includes("code")) {
      return "كود المنتج مستخدم في هذه الجهة، اختر كودًا آخر";
    }
    if (e.constraint?.includes("shipment_no")) return "رقم الشحنة مستخدم في شحنة أخرى";
    if (e.constraint?.includes("code")) return "الكود مستخدم مسبقًا، اختر كودًا آخر";
    return "القيمة مكررة، تحقق من الحقول الفريدة";
  }
  if (e?.code === "23503") return "لا يمكن إتمام العملية لوجود بيانات مرتبطة";
  if (e?.code === "42501") return "لا تملك صلاحية تنفيذ هذه العملية";

  return raw.replace(/^ERROR:\s*/i, "");
}
