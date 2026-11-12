-- دوال مساعدة للاختبار
create or replace function assert_eq(p_name text, p_expected numeric, p_actual numeric, p_tol numeric default 0.0001)
returns void
language plpgsql
as $$
begin
  if p_expected is null or p_actual is null or abs(p_expected - p_actual) > p_tol then
    raise exception '✗ %: المتوقع % والفعلي %', p_name, p_expected, p_actual;
  end if;
  raise notice '✓ % = %', p_name, p_actual;
end;
$$;

create or replace function assert_true(p_name text, p_cond boolean)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_cond, false) then
    raise exception '✗ %', p_name;
  end if;
  raise notice '✓ %', p_name;
end;
$$;

create or replace function assert_raises(p_name text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '✓ % (رُفض كما هو مطلوب: %)', p_name, left(sqlerrm, 60);
    return;
  end;
  raise exception '✗ %: كان يجب أن تُرفض العملية ولم تُرفض', p_name;
end;
$$;
