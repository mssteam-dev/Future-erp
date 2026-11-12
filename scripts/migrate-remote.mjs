// تطبيق كل ملفات supabase/migrations على قاعدة بعيدة: DATABASE_URL=... node scripts/migrate-remote.mjs
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const dir = path.resolve("supabase/migrations");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  process.stdout.write(f + " ... ");
  await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
  console.log("ok");
}
await client.end();
