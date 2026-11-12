import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { withAdmin, withUser } from "./db";

const scrypt = promisify(scryptCb);
const COOKIE = "erp_session";
const MAX_AGE = 60 * 60 * 12; // 12 ساعة

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-secret-change-me";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function serialize(userId: string): string {
  const payload = `${userId}.${Date.now() + MAX_AGE * 1000}`;
  return `${payload}.${sign(payload)}`;
}

function parse(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  const expected = sign(`${userId}.${expires}`);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  if (Number(expires) < Date.now()) return null;
  return userId;
}

// ------------------------------- كلمات المرور -------------------------------
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// --------------------------------- الجلسة ----------------------------------
export type SessionUser = {
  id: string;
  fullName: string;
  username: string | null;
  email: string | null;
  isOwner: boolean;
  permissions: string[];
  branchIds: string[];
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const userId = parse(store.get(COOKIE)?.value);
  if (!userId) return null;

  return withAdmin(async (client) => {
    const { rows } = await client.query(
      `select u.id, u.full_name, u.username, u.email, u.is_owner,
              coalesce((select array_agg(distinct rp.permission_code)
                          from user_roles ur
                          join role_permissions rp on rp.role_id = ur.role_id
                         where ur.user_id = u.id), '{}') as permissions,
              coalesce((select array_agg(ub.branch_id) from user_branches ub
                         where ub.user_id = u.id), '{}') as branch_ids
         from app_users u
        where u.id = $1 and u.is_active`,
      [userId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      fullName: r.full_name,
      username: r.username,
      email: r.email,
      isOwner: r.is_owner,
      permissions: r.permissions ?? [],
      branchIds: r.branch_ids ?? [],
    };
  });
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(code: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isOwner && !user.permissions.includes(code)) {
    redirect("/?denied=" + encodeURIComponent(code));
  }
  return user;
}

export function can(user: SessionUser | null, code: string): boolean {
  if (!user) return false;
  return user.isOwner || user.permissions.includes(code);
}

export async function login(identifier: string, password: string): Promise<string | null> {
  const user = await withAdmin(async (client) => {
    const { rows } = await client.query(
      `select id, password_hash, is_active from app_users
        where (lower(username) = lower($1) or lower(email) = lower($1)) limit 1`,
      [identifier.trim()],
    );
    return rows[0];
  });

  if (!user || !user.is_active) return "بيانات الدخول غير صحيحة";
  if (!(await verifyPassword(password, user.password_hash))) return "بيانات الدخول غير صحيحة";

  const store = await cookies();
  store.set(COOKIE, serialize(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });

  await withUser(user.id, (client) =>
    client.query(
      `insert into audit_logs (user_id, action, entity, summary)
       values ($1, 'login', 'app_users', 'تسجيل دخول')`,
      [user.id],
    ),
  ).catch(() => {});

  return null;
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** تنفيذ استعلام بهوية المستخدم الحالي */
export async function queryAs<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const user = await requireUser();
  return withUser(user.id, async (client) => {
    const { rows } = await client.query(sql, params);
    return rows as T[];
  });
}
