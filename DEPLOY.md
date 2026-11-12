# الرفع على Vercel + Supabase
1. Supabase: مشروع جديد، ثم Connect > Session pooler وانسخ الرابط (DATABASE_URL).
2. تطبيق الجداول: DATABASE_URL="..." node scripts/migrate-remote.mjs
3. إنشاء المدير: DATABASE_URL="..." PGSSL=require node scripts/create-user.mjs admin <كلمة_مرور> "المدير" --owner
4. GitHub: مستودع خاص (private) وارفع الكود.
5. Vercel: Import من GitHub، ومتغيرات البيئة: DATABASE_URL, SESSION_SECRET (نص عشوائي طويل), PGSSL=require
