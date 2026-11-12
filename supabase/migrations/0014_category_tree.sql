-- =============================================================================
-- 0014_category_tree.sql — تصنيفات شجرية حتى خمسة مستويات
--   الحدّ والمسار محفوظان في قاعدة البيانات نفسها، فلا يمكن تجاوزهما من الواجهة
--   ولا من أي أداة أخرى.
-- =============================================================================

alter table product_categories
  add column if not exists depth      int  not null default 1,
  add column if not exists sort_order int  not null default 0,
  add column if not exists notes      text;

create index if not exists product_categories_parent_idx on product_categories(parent_id);

-- أقصى عدد مستويات مسموح به
create or replace function max_category_depth()
returns int language sql immutable as $$ select 5 $$;

-- ------------------------- التحقق قبل الإدراج والتعديل ------------------------
create or replace function product_categories_validate()
returns trigger
language plpgsql
as $$
declare
  v_parent_depth int;
  v_cursor uuid;
  v_guard  int := 0;
begin
  if new.parent_id is null then
    new.depth := 1;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'لا يمكن أن يكون التصنيف تابعًا لنفسه' using errcode = 'P0001';
  end if;

  select depth into v_parent_depth from product_categories where id = new.parent_id;
  if v_parent_depth is null then
    raise exception 'التصنيف الأب غير موجود' using errcode = 'P0001';
  end if;

  -- منع الدوران: لا يجوز أن يكون أحد أبناء التصنيف أبًا له
  v_cursor := new.parent_id;
  while v_cursor is not null and v_guard < 50 loop
    if v_cursor = new.id then
      raise exception 'لا يمكن نقل التصنيف إلى أحد تصنيفاته الفرعية' using errcode = 'P0001';
    end if;
    select parent_id into v_cursor from product_categories where id = v_cursor;
    v_guard := v_guard + 1;
  end loop;

  new.depth := v_parent_depth + 1;
  if new.depth > max_category_depth() then
    raise exception 'لا يمكن تجاوز % مستويات للتصنيفات', max_category_depth()
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists product_categories_validate_trg on product_categories;
create trigger product_categories_validate_trg
  before insert or update on product_categories
  for each row execute function product_categories_validate();

-- ---------------- إعادة حساب المستويات بعد نقل تصنيف له أبناء ----------------
create or replace function product_categories_recalc()
returns trigger
language plpgsql
as $$
declare v_max int;
begin
  with recursive tree as (
    select id, 1 as d from product_categories where parent_id is null
    union all
    select c.id, t.d + 1 from product_categories c join tree t on c.parent_id = t.id
  )
  update product_categories pc
     set depth = tree.d
    from tree
   where tree.id = pc.id and pc.depth is distinct from tree.d;

  select max(depth) into v_max from product_categories;
  if v_max > max_category_depth() then
    raise exception 'النقل يجعل عمق الشجرة % وهو أكثر من المسموح (%)',
      v_max, max_category_depth() using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists product_categories_recalc_trg on product_categories;
create constraint trigger product_categories_recalc_trg
  after insert or update on product_categories
  deferrable initially deferred
  for each row execute function product_categories_recalc();

-- -------------------------------- المسار الكامل ------------------------------
create or replace function category_path(p_id uuid, p_sep text default ' ← ')
returns text
language sql
stable
as $$
  with recursive up as (
    select id, parent_id, name_ar, 1 as lvl
      from product_categories where id = p_id
    union all
    select c.id, c.parent_id, c.name_ar, up.lvl + 1
      from product_categories c join up on up.parent_id = c.id
  )
  select string_agg(name_ar, p_sep order by lvl desc) from up;
$$;

-- التصنيف وكل ما تحته — للتصفية في التقارير
create or replace function category_descendants(p_id uuid)
returns table (id uuid)
language sql
stable
as $$
  with recursive down as (
    select c.id from product_categories c where c.id = p_id
    union all
    select c.id from product_categories c join down on c.parent_id = down.id
  )
  select id from down;
$$;

-- شجرة التصنيفات جاهزة للعرض: مرتبة ومع المسار وعدد المنتجات
create or replace function category_tree()
returns table (
  id            uuid,
  code          text,
  name_ar       text,
  parent_id     uuid,
  depth         int,
  path          text,
  sort_key      text,
  is_active     boolean,
  product_count bigint,
  child_count   bigint
)
language sql
stable
as $$
  with recursive tree as (
    select c.id, c.code, c.name_ar, c.parent_id, c.depth, c.is_active,
           lpad(c.sort_order::text, 6, '0') || '|' || c.name_ar as sort_key
      from product_categories c
     where c.parent_id is null
    union all
    select c.id, c.code, c.name_ar, c.parent_id, c.depth, c.is_active,
           t.sort_key || '>' || lpad(c.sort_order::text, 6, '0') || '|' || c.name_ar
      from product_categories c
      join tree t on c.parent_id = t.id
  )
  select t.id, t.code, t.name_ar, t.parent_id, t.depth,
         category_path(t.id), t.sort_key, t.is_active,
         (select count(*) from products p where p.category_id = t.id),
         (select count(*) from product_categories c where c.parent_id = t.id)
    from tree t
   order by t.sort_key;
$$;

-- حساب المستويات للبيانات الموجودة
update product_categories set depth = 1 where parent_id is null and depth <> 1;
