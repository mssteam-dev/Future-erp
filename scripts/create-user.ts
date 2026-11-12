/**
 * إنشاء مستخدم أو تغيير كلمة مروره.
 *   npx tsx scripts/create-user.ts <username> <password> "<الاسم الكامل>" [--owner] [--role=code]
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";

const scrypt = promisify(scryptCb);

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function main() {
  const [username, password, fullName] = process.argv.slice(2);
  if (!username || !password) {
    console.error('الاستخدام: npx tsx scripts/create-user.ts <username> <password> "<الاسم>" [--owner] [--role=code]');
    process.exit(1);
  }
  const isOwner = process.argv.includes("--owner");
  const role = process.argv.find((a) => a.startsWith("--role="))?.split("=")[1];

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/erp_dev",
  });

  const passwordHash = await hash(password);
  const { rows } = await pool.query(
    `insert into app_users (username, password_hash, full_name, is_owner)
     values ($1, $2, $3, $4)
     on conflict (username) do update
        set password_hash = excluded.password_hash,
            full_name     = excluded.full_name,
            is_owner      = excluded.is_owner,
            is_active     = true
     returning id`,
    [username, passwordHash, fullName ?? username, isOwner],
  );
  const userId = rows[0].id;

  if (role) {
    await pool.query(
      `insert into user_roles (user_id, role_id)
       select $1, r.id from roles r where r.code = $2
       on conflict do nothing`,
      [userId, role],
    );
  }

  // وصول إلى كل الوحدات لغير المالك إن لم يُحدد غير ذلك
  await pool.query(
    `insert into user_branches (user_id, branch_id)
     select $1, b.id from branches b on conflict do nothing`,
    [userId],
  );

  console.log(`✓ المستخدم ${username} جاهز${isOwner ? " (مالك)" : ""} — المعرّف ${userId}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
