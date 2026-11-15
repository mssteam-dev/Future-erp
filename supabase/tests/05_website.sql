-- =============================================================================
-- اختبار 5: محتوى الموقع الإلكتروني — الصلاحيات، القيود، وما يُعاد للموقع العام
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- مستخدمان: محرر موقع لا يملك غير قسم الموقع، وأمين صندوق لا يملك قسم الموقع
insert into app_users (id, username, full_name) values
  ('00000000-0000-4000-8000-0000000000e1', 'site_editor',  'محرر الموقع'),
  ('00000000-0000-4000-8000-0000000000c1', 'site_cashier', 'أمين صندوق');
insert into user_roles (user_id, role_id)
select '00000000-0000-4000-8000-0000000000e1', id from roles where code = 'website_editor';
insert into user_roles (user_id, role_id)
select '00000000-0000-4000-8000-0000000000c1', id from roles where code = 'cashier';

insert into products (code, name_ar) values ('SITE-T1', 'منتج محاسبي للاختبار');

-- ============================ 1) الأدوار والصلاحيات ==========================
select assert_eq('محرر الموقع: صلاحيتا الموقع فقط', 2,
  (select count(*) from role_permissions rp join roles r on r.id = rp.role_id
    where r.code = 'website_editor'));
select assert_true('محرر الموقع: لا صلاحية خارج قسم الموقع',
  not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id
               where r.code = 'website_editor' and rp.permission_code not like 'website.%'));
select assert_eq('المدير العام يملك صلاحيتي الموقع', 2,
  (select count(*) from role_permissions rp join roles r on r.id = rp.role_id
    where r.code = 'general_manager' and rp.permission_code like 'website.%'));
select assert_true('دور المشاهدة يعرض الموقع ولا يعدّله',
  exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id
           where r.code = 'viewer' and rp.permission_code = 'website.view')
  and not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id
                   where r.code = 'viewer' and rp.permission_code = 'website.edit'));
select assert_true('المحاسب وأمين الصندوق ومدير الفرع بلا صلاحيات موقع',
  not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id
               where r.code in ('accountant', 'cashier', 'branch_manager')
                 and rp.permission_code like 'website.%'));

-- ============================ 2) محرر الموقع يكتب ============================
set local role authenticated;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000e1', true);

insert into site_menu_categories (id, name_ar, name_en, sort_order, is_visible) values
  ('00000000-0000-4000-8000-00000000a002', 'حلويات',        'Sweets',     2, true),
  ('00000000-0000-4000-8000-00000000a001', 'مشروبات ساخنة', 'Hot drinks', 1, true),
  ('00000000-0000-4000-8000-00000000a003', 'قسم مخفي',      'Hidden',     3, false),
  ('00000000-0000-4000-8000-00000000a004', 'قسم كل أصنافه مخفية', 'All hidden', 4, true);

insert into site_menu_items (id, category_id, name_ar, name_en, price, note_ar, note_en, sort_order, is_visible) values
  ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000a001', 'لاتيه',      'Latte',     3,     null, null, 2, true),
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000a001', 'اسبرسو',     'Espresso',  1.5,   'سنجل', 'Single', 1, true),
  ('00000000-0000-4000-8000-00000000b003', '00000000-0000-4000-8000-00000000a001', 'صنف موقوف', 'Paused',    9,     null, null, 3, false),
  ('00000000-0000-4000-8000-00000000b004', '00000000-0000-4000-8000-00000000a002', 'تيراميسو',   'Tiramisu',  3.75,  null, null, 1, true),
  ('00000000-0000-4000-8000-00000000b005', '00000000-0000-4000-8000-00000000a003', 'في قسم مخفي', 'In hidden', 1,    null, null, 1, true),
  ('00000000-0000-4000-8000-00000000b006', '00000000-0000-4000-8000-00000000a004', 'مخفي',       'Hidden',    1,     null, null, 1, false);

insert into site_branches (id, slug, name_ar, name_en, address_ar, address_en, phone, map_url, sort_order, is_visible) values
  ('00000000-0000-4000-8000-00000000d002', 'second', 'الفرع الثاني', 'Second', 'شارع ب', 'B St.', '07 9000 0002', 'https://maps.example/second', 2, true),
  ('00000000-0000-4000-8000-00000000d001', 'first',  'الفرع الأول',  'First',  'شارع أ', 'A St.', '07 9000 0001', 'https://maps.example/first',  1, true),
  ('00000000-0000-4000-8000-00000000d003', 'closed-branch', 'فرع مخفي', 'Hidden branch', null, null, null, null, 3, false);

insert into site_branch_hours (branch_id, weekday, is_closed, open_time, close_time) values
  ('00000000-0000-4000-8000-00000000d001', 0, false, '09:30', '03:00'),
  ('00000000-0000-4000-8000-00000000d001', 5, false, '14:00', '03:00'),
  ('00000000-0000-4000-8000-00000000d001', 6, true,  null,    null);

select assert_eq('المحرر يرى الأقسام التي أضافها', 4, (select count(*) from site_menu_categories));
select assert_eq('المحرر يرى الأصناف التي أضافها', 6, (select count(*) from site_menu_items));

with u as (update site_menu_items set price = 3.25
            where id = '00000000-0000-4000-8000-00000000b002' returning 1)
select assert_eq('المحرر يعدّل السعر', 1, (select count(*) from u));

-- لا شيء من النظام المحاسبي
select assert_eq('المحرر لا يرى المنتجات المحاسبية', 0, (select count(*) from products));
select assert_eq('المحرر لا يرى الصناديق', 0, (select count(*) from treasury_accounts));
select assert_eq('المحرر لا يرى سجل العمليات', 0, (select count(*) from audit_logs));
select assert_raises('المحرر لا يضيف منتجًا محاسبيًا',
  $q$insert into products (code, name_ar) values ('SITE-T2', 'x')$q$);

-- ================================ 3) القيود ==================================
select assert_raises('سعر سالب مرفوض',
  $q$update site_menu_items set price = -1 where id = '00000000-0000-4000-8000-00000000b001'$q$);
select assert_raises('اسم فارغ مرفوض',
  $q$insert into site_menu_items (category_id, name_ar, name_en, price)
     values ('00000000-0000-4000-8000-00000000a001', '   ', 'X', 1)$q$);
select assert_raises('حذف قسم فيه أصناف مرفوض',
  $q$delete from site_menu_categories where id = '00000000-0000-4000-8000-00000000a001'$q$);
select assert_raises('معرّف فرع مكرر مرفوض',
  $q$insert into site_branches (slug, name_ar, name_en) values ('first', 'x', 'x')$q$);
select assert_raises('معرّف فرع بحروف غير مسموحة مرفوض',
  $q$insert into site_branches (slug, name_ar, name_en) values ('Bad Slug', 'x', 'x')$q$);
select assert_raises('رابط خريطة غير آمن مرفوض',
  $q$update site_branches set map_url = 'javascript:alert(1)' where slug = 'first'$q$);
select assert_raises('يوم مغلق ومعه أوقات مرفوض',
  $q$insert into site_branch_hours (branch_id, weekday, is_closed, open_time, close_time)
     values ('00000000-0000-4000-8000-00000000d002', 1, true, '09:00', '10:00')$q$);
select assert_raises('وقت فتح بلا وقت إغلاق مرفوض',
  $q$insert into site_branch_hours (branch_id, weekday, is_closed, open_time)
     values ('00000000-0000-4000-8000-00000000d002', 1, false, '09:00')$q$);
select assert_raises('يوم خارج الأسبوع مرفوض',
  $q$insert into site_branch_hours (branch_id, weekday, is_closed) values
     ('00000000-0000-4000-8000-00000000d002', 7, true)$q$);

-- ====================== 4) من لا يملك صلاحية الموقع ==========================
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000c1', true);

select assert_eq('أمين الصندوق لا يرى أصناف الموقع', 0, (select count(*) from site_menu_items));
select assert_eq('أمين الصندوق لا يرى فروع الموقع', 0, (select count(*) from site_branches));
with u as (update site_menu_items set price = 99 returning 1)
select assert_eq('أمين الصندوق لا يعدّل الأسعار', 0, (select count(*) from u));
with d as (delete from site_menu_items returning 1)
select assert_eq('أمين الصندوق لا يحذف الأصناف', 0, (select count(*) from d));
select assert_raises('أمين الصندوق لا يضيف صنفًا',
  $q$insert into site_menu_items (category_id, name_ar, name_en, price)
     values ('00000000-0000-4000-8000-00000000a001', 'x', 'x', 1)$q$);
select assert_raises('أمين الصندوق لا يضيف ساعات عمل',
  $q$insert into site_branch_hours (branch_id, weekday, is_closed) values
     ('00000000-0000-4000-8000-00000000d002', 2, true)$q$);

-- مستخدم موقوف يفقد الوصول فورًا
reset role;
update app_users set is_active = false where id = '00000000-0000-4000-8000-0000000000e1';
set local role authenticated;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000e1', true);
select assert_eq('المحرر الموقوف لا يرى شيئًا', 0, (select count(*) from site_menu_items));
reset role;
update app_users set is_active = true where id = '00000000-0000-4000-8000-0000000000e1';

-- الزائر المجهول: لا جداول ولا دالة
set local role anon;
select assert_raises('الزائر المجهول لا يقرأ جداول الموقع', 'select count(*) from site_menu_items');
select assert_raises('الزائر المجهول لا ينفذ دالة المحتوى', 'select site_public_content()');
reset role;

-- ======================= 5) ما يُعاد للموقع العام ============================
do $$
declare
  c jsonb := site_public_content();
begin
  perform assert_eq('الأقسام الظاهرة ذات الأصناف الظاهرة فقط', 2, jsonb_array_length(c->'categories'));
  perform assert_true('ترتيب الأقسام حسب الترتيب المحدد',
    c->'categories'->0->>'name_en' = 'Hot drinks' and c->'categories'->1->>'name_en' = 'Sweets');
  perform assert_eq('الصنف الموقوف لا يُعاد', 2, jsonb_array_length(c->'categories'->0->'items'));
  perform assert_true('ترتيب الأصناف حسب الترتيب المحدد',
    c->'categories'->0->'items'->0->>'name_en' = 'Espresso'
    and c->'categories'->0->'items'->1->>'name_en' = 'Latte');
  perform assert_eq('السعر بعد التعديل', 3.25, (c->'categories'->0->'items'->1->>'price')::numeric);
  perform assert_true('الملاحظة بالعربية والإنجليزية',
    c->'categories'->0->'items'->0->>'note_ar' = 'سنجل'
    and c->'categories'->0->'items'->0->>'note_en' = 'Single');
  perform assert_true('الملاحظة الفارغة نص فارغ لا null',
    c->'categories'->0->'items'->1->>'note_ar' = '');
  perform assert_true('لا يُعاد صنف من قسم مخفي',
    not (c::text like '%In hidden%') and not (c::text like '%All hidden%'));

  perform assert_eq('الفروع الظاهرة فقط', 2, jsonb_array_length(c->'branches'));
  perform assert_true('ترتيب الفروع حسب الترتيب المحدد',
    c->'branches'->0->>'slug' = 'first' and c->'branches'->1->>'slug' = 'second');
  perform assert_eq('ساعات الفرع الأول: ثلاثة أيام محددة', 3, jsonb_array_length(c->'branches'->0->'hours'));
  perform assert_true('صيغة الوقت 24 ساعة',
    c->'branches'->0->'hours'->0->>'open' = '09:30'
    and c->'branches'->0->'hours'->0->>'close' = '03:00');
  perform assert_true('اليوم المغلق بلا أوقات',
    (c->'branches'->0->'hours'->2->>'closed')::boolean
    and c->'branches'->0->'hours'->2->>'open' is null);
  perform assert_eq('فرع بلا ساعات: قائمة فارغة', 0, jsonb_array_length(c->'branches'->1->'hours'));
  perform assert_true('تاريخ آخر تحديث موجود', c->>'updated_at' is not null);

  -- حذف الفرع يحذف ساعاته
  delete from site_branches where slug = 'first';
  perform assert_eq('حذف الفرع يحذف ساعاته', 0,
    (select count(*) from site_branch_hours
      where branch_id = '00000000-0000-4000-8000-00000000d001'));

  -- قاعدة فارغة: قوائم فارغة لا null
  delete from site_menu_items;
  delete from site_menu_categories;
  delete from site_branches;
  c := site_public_content();
  perform assert_true('بلا محتوى: قوائم فارغة',
    jsonb_array_length(c->'categories') = 0 and jsonb_array_length(c->'branches') = 0);

  raise notice '===== اختبار محتوى الموقع: ناجح =====';
end;
$$;

rollback;
