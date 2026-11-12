#!/usr/bin/env bash
# نسخة احتياطية كاملة لقاعدة البيانات، مضغوطة ومؤرَّخة.
#   DATABASE_URL=postgres://... bash scripts/backup.sh [مجلد_النسخ]
set -euo pipefail

DEST="${1:-./backups}"
mkdir -p "$DEST"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$DEST/erp-$STAMP.sql.gz"

if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
else
  pg_dump --no-owner --no-privileges -d "${PGDATABASE:-erp_dev}" | gzip -9 > "$FILE"
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ تم إنشاء النسخة: $FILE ($SIZE)"
echo "  سجّل مكان النسخة في شاشة: الإعدادات ← النسخ الاحتياطي"

# الاحتفاظ بآخر 30 نسخة فقط
ls -1t "$DEST"/erp-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
