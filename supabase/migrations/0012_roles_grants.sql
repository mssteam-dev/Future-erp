-- =============================================================================
-- 0012_roles_grants.sql — دور التطبيق وصلاحيات الوصول
--   التطبيق يتصل بقاعدة البيانات بدور authenticated، فتُطبَّق عليه سياسات RLS
--   كاملةً. دوال الترحيل وحدها (SECURITY DEFINER) هي التي تكتب في الدفاتر.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end;
$$;

grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

-- الدفاتر للقراءة فقط من التطبيق؛ الكتابة عبر دوال الترحيل حصرًا
revoke insert, update, delete on journal_entries, journal_lines, stock_movements,
  product_branch_stock, document_sequences from authenticated;

-- سجل العمليات لا يُعدَّل ولا يُحذف
revoke update, delete on audit_logs from authenticated;
