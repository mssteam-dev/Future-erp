#!/usr/bin/env bash
# يبني قاعدة اختبار نظيفة ويشغّل كل مجموعات الاختبار عليها.
set -euo pipefail

export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE=erp_test

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"

bash "$ROOT/scripts/db-reset.sh" > /dev/null
$PSQL -d erp_test -f "$ROOT/supabase/tests/_helpers.sql"

pass=0
fail=0
for f in "$ROOT"/supabase/tests/[0-9]*.sql; do
  name="$(basename "$f" .sql)"
  if out="$(psql -d erp_test -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    checks="$(grep -c 'NOTICE:  ✓' <<< "$out" || true)"
    echo "✓ ${name} — ${checks} تأكيدًا"
    pass=$((pass + 1))
  else
    echo "✗ ${name}"
    grep -E 'ERROR|✗' <<< "$out" | head -5
    fail=$((fail + 1))
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "كل المجموعات ناجحة (${pass})"
else
  echo "${fail} مجموعة فاشلة من أصل $((pass + fail))"
  exit 1
fi
