-- =============================================================================
-- 0020_website.sql — محتوى الموقع الإلكتروني
--   المنيو والأسعار وفروع الموقع وساعات عملها تُدار من النظام، ويقرؤها الموقع
--   العام عبر دالة قراءة واحدة. الجداول مستقلة تمامًا عن الجداول المحاسبية:
--   لا علاقة لها بالمنتجات ولا بالمخزون ولا بالقيود.
-- =============================================================================

-- ------------------------------- أقسام المنيو ---------------------------------
create table site_menu_categories (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null check (btrim(name_ar) <> ''),
  name_en     text not null check (btrim(name_en) <> ''),
  sort_order  int  not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------- أصناف المنيو ---------------------------------
create table site_menu_items (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references site_menu_categories(id) on delete restrict,
  name_ar     text not null check (btrim(name_ar) <> ''),
  name_en     text not null check (btrim(name_en) <> ''),
  price       numeric(12,3) not null check (price >= 0),
  note_ar     text,
  note_en     text,
  sort_order  int  not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index site_menu_items_category_idx on site_menu_items(category_id, sort_order);

-- ------------------------------- فروع الموقع ----------------------------------
-- فروع الموقع بيانات عرض للزوار (عنوان، هاتف، خريطة، ساعات عمل) وليست الجهات
-- المحاسبية في جدول branches.
create table site_branches (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_ar     text not null check (btrim(name_ar) <> ''),
  name_en     text not null check (btrim(name_en) <> ''),
  address_ar  text,
  address_en  text,
  phone       text,
  map_url     text check (map_url is null or map_url ~ '^https://'),
  sort_order  int  not null default 0,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ساعات العمل لكل يوم. اليوم بلا صف = ساعاته غير محددة فلا تُعرض.
-- وقت إغلاق أصغر من وقت الفتح أو يساويه = الإغلاق بعد منتصف الليل.
create table site_branch_hours (
  branch_id   uuid not null references site_branches(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = الأحد
  is_closed   boolean not null default false,
  open_time   time,
  close_time  time,
  primary key (branch_id, weekday),
  check (
    (is_closed and open_time is null and close_time is null)
    or (not is_closed and open_time is not null and close_time is not null)
  )
);

create trigger site_menu_categories_touch before update on site_menu_categories
  for each row execute function touch_updated_at();
create trigger site_menu_items_touch before update on site_menu_items
  for each row execute function touch_updated_at();
create trigger site_branches_touch before update on site_branches
  for each row execute function touch_updated_at();

-- --------------------------------- الصلاحيات ----------------------------------
insert into permissions (code, module, action, name_ar) values
  ('website.view', 'website', 'view', 'عرض محتوى الموقع الإلكتروني'),
  ('website.edit', 'website', 'edit', 'تعديل محتوى الموقع الإلكتروني');

-- دور لا يرى من النظام إلا قسم الموقع (لموظفي المحل مثلًا)
insert into roles (code, name_ar, is_system) values
  ('website_editor', 'محرر الموقع', true);

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r, permissions p
 where p.module = 'website'
   and (r.code in ('general_manager', 'website_editor')
        or (r.code = 'viewer' and p.action = 'view'));

-- ---------------------------------- الحماية -----------------------------------
alter table site_menu_categories enable row level security;
alter table site_menu_items      enable row level security;
alter table site_branches        enable row level security;
alter table site_branch_hours    enable row level security;

create policy site_categories_read on site_menu_categories for select
  using (has_permission('website.view'));
create policy site_items_read on site_menu_items for select
  using (has_permission('website.view'));
create policy site_branches_read on site_branches for select
  using (has_permission('website.view'));
create policy site_hours_read on site_branch_hours for select
  using (has_permission('website.view'));

create policy site_categories_write on site_menu_categories for all
  using (has_permission('website.edit')) with check (has_permission('website.edit'));
create policy site_items_write on site_menu_items for all
  using (has_permission('website.edit')) with check (has_permission('website.edit'));
create policy site_branches_write on site_branches for all
  using (has_permission('website.edit')) with check (has_permission('website.edit'));
create policy site_hours_write on site_branch_hours for all
  using (has_permission('website.edit')) with check (has_permission('website.edit'));

grant select, insert, update, delete
  on site_menu_categories, site_menu_items, site_branches, site_branch_hours
  to authenticated;
revoke all
  on site_menu_categories, site_menu_items, site_branches, site_branch_hours
  from anon;

-- ------------------------- ما يقرؤه الموقع العام ------------------------------
-- يعيد المحتوى الظاهر فقط، مرتبًا وجاهزًا للعرض. القسم بلا أصناف ظاهرة لا يُعاد.
create or replace function site_public_content()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'updated_at', (
      select max(t) from (
        select max(updated_at) as t from site_menu_categories
        union all select max(updated_at) from site_menu_items
        union all select max(updated_at) from site_branches
      ) x
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name_ar', c.name_ar,
               'name_en', c.name_en,
               'items', (
                 select jsonb_agg(jsonb_build_object(
                          'id', i.id,
                          'name_ar', i.name_ar,
                          'name_en', i.name_en,
                          'price', i.price,
                          'note_ar', coalesce(i.note_ar, ''),
                          'note_en', coalesce(i.note_en, '')
                        ) order by i.sort_order, i.created_at, i.id)
                   from site_menu_items i
                  where i.category_id = c.id and i.is_visible
               )
             ) order by c.sort_order, c.created_at, c.id)
        from site_menu_categories c
       where c.is_visible
         and exists (select 1 from site_menu_items i
                      where i.category_id = c.id and i.is_visible)
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', b.slug,
               'name_ar', b.name_ar,
               'name_en', b.name_en,
               'address_ar', coalesce(b.address_ar, ''),
               'address_en', coalesce(b.address_en, ''),
               'phone', coalesce(b.phone, ''),
               'map_url', coalesce(b.map_url, ''),
               'hours', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'weekday', h.weekday,
                          'closed', h.is_closed,
                          'open', to_char(h.open_time, 'HH24:MI'),
                          'close', to_char(h.close_time, 'HH24:MI')
                        ) order by h.weekday)
                   from site_branch_hours h
                  where h.branch_id = b.id
               ), '[]'::jsonb)
             ) order by b.sort_order, b.created_at, b.id)
        from site_branches b
       where b.is_visible
    ), '[]'::jsonb)
  );
$$;

revoke execute on function site_public_content() from public, anon;
grant execute on function site_public_content() to authenticated;
