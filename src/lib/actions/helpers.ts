import "server-only";
import type { PoolClient } from "pg";
import { requirePermission } from "@/lib/auth";
import { dbErrorMessage, withUser } from "@/lib/db";

export type ActionState = { error?: string; ok?: boolean; id?: string };

/** ينفذ عملية كتابة بهوية المستخدم داخل معاملة واحدة ويترجم الأخطاء للعربية */
export async function run<T>(
  permission: string,
  fn: (client: PoolClient, userId: string) => Promise<T>,
): Promise<{ data?: T; error?: string }> {
  const user = await requirePermission(permission);
  try {
    const data = await withUser(user.id, (client) => fn(client, user.id));
    return { data };
  } catch (error) {
    return { error: dbErrorMessage(error) };
  }
}

export function num(formData: FormData, key: string, fallback = 0): number {
  const raw = formData.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function nullable(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value === "" ? null : value;
}

export function parseLines<T>(formData: FormData, key = "lines"): T[] {
  try {
    const parsed = JSON.parse(String(formData.get(key) ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function logAudit(
  client: PoolClient,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  summary: string,
  branchId?: string | null,
) {
  await client.query(
    `insert into audit_logs (user_id, action, entity, entity_id, branch_id, summary)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId, action, entity, entityId, branchId ?? null, summary],
  );
}
