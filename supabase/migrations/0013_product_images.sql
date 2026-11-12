-- =============================================================================
-- 0013_product_images.sql — صورة المنتج
--   تُحفظ الصورة داخل قاعدة البيانات، فتدخل ضمن النسخ الاحتياطي تلقائيًا
--   ولا تعتمد على مجلد خارجي قد يُفقد عند النقل أو إعادة النشر.
-- =============================================================================

alter table products
  add column if not exists image            bytea,
  add column if not exists image_mime       text,
  add column if not exists image_updated_at timestamptz;

comment on column products.image is 'صورة مصغّرة للمنتج تظهر في شاشات الإدخال لمنع الخلط بين الأصناف';
