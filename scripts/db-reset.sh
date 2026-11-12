#!/usr/bin/env bash
# إعادة بناء قاعدة البيانات المحلية من الصفر وتطبيق كل المايجريشن بالترتيب.
set -euo pipefail

DB="${PGDATABASE:-erp_dev}"
PSQL="psql -v ON_ERROR_STOP=1 -q"

export PGHOST="${PGHOST:-/var/run/postgresql}"
export PGUSER="${PGUSER:-postgres}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

$PSQL -d postgres -c "drop database if exists ${DB} with (force);"
$PSQL -d postgres -c "create database ${DB};"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  $PSQL -d "$DB" -f "$f"
done

echo "✓ قاعدة البيانات ${DB} جاهزة"
