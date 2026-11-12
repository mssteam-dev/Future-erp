"use client";

import { useRef, useState } from "react";
import { saveProduct } from "@/lib/actions/inventory";
import { Card, Field, FormRow } from "./ui";

type Option = { id: string; name_ar: string; depth?: string | number; path?: string };

export type ProductInitial = {
  id: string;
  code: string;
  name_ar: string;
  category_id: string | null;
  uom_id: string | null;
  default_sale_price: string;
  default_unit_cost: string;
  reorder_level: string;
  tax_rate: string | null;
  barcode: string | null;
  notes: string | null;
  is_active: boolean;
  has_image: boolean;
};

/** تصغير الصورة في المتصفح قبل الرفع: حجم أصغر وتحميل أسرع في شاشات الإدخال */
async function shrink(file: File, max = 480): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر تجهيز الصورة");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", 0.82);
}

export default function ProductForm({
  categories,
  uoms,
  initial,
}: {
  categories: Option[];
  uoms: Option[];
  initial?: ProductInitial;
}) {
  const [preview, setPreview] = useState<string | null>(
    initial?.has_image ? `/api/products/${initial.id}/image` : null,
  );
  const [imageData, setImageData] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await shrink(file);
      setImageData(data);
      setPreview(data);
      setRemoveImage(false);
    } catch {
      alert("تعذّر قراءة الصورة. جرّب صورة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form action={saveProduct}>
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="image_data" value={imageData} />
      {removeImage ? <input type="hidden" name="image_remove" value="on" /> : null}

      <Card title={initial ? "تعديل المنتج" : "إضافة منتج"}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* ------------------------------ الصورة ------------------------------ */}
          <div style={{ width: 150, flexShrink: 0 }}>
            <label className="label">صورة المنتج</label>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                width: 150,
                height: 150,
                borderRadius: 12,
                border: "1px dashed #c6cde0",
                background: preview ? "#fff" : "#f7f9fd",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                overflow: "hidden",
              }}
              title="اضغط لاختيار صورة"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="صورة المنتج"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "center", padding: 10 }}>
                  اضغط لاختيار صورة
                  <br />
                  <span style={{ fontSize: 11 }}>تظهر في شاشات الإدخال</span>
                </span>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />

            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                style={{ flex: 1 }}
              >
                {busy ? "..." : preview ? "تغيير" : "اختيار"}
              </button>
              {preview ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setPreview(null);
                    setImageData("");
                    setRemoveImage(true);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  حذف
                </button>
              ) : null}
            </div>
          </div>

          {/* ------------------------------ الحقول ------------------------------ */}
          <div style={{ flex: "1 1 min(100%, 420px)", minWidth: 0 }}>
            <FormRow cols={2}>
              <Field label="الكود">
                <input
                  name="code"
                  className="input input-num"
                  defaultValue={initial?.code ?? ""}
                  placeholder="تلقائي"
                />
              </Field>
              <Field label="اسم المنتج">
                <input name="name_ar" className="input" defaultValue={initial?.name_ar ?? ""} required />
              </Field>
            </FormRow>

            <FormRow cols={2}>
              <Field label="التصنيف">
                <select name="category_id" className="select" defaultValue={initial?.category_id ?? ""}>
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {"— ".repeat(Math.max(0, Number(c.depth ?? 1) - 1))}
                      {c.name_ar}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="وحدة القياس">
                <select name="uom_id" className="select" defaultValue={initial?.uom_id ?? ""}>
                  <option value="">—</option>
                  {uoms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name_ar}
                    </option>
                  ))}
                </select>
              </Field>
            </FormRow>

            <FormRow cols={2}>
              <Field label="سعر البيع الافتراضي">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  name="default_sale_price"
                  className="input input-num"
                  defaultValue={Number(initial?.default_sale_price ?? 0)}
                />
              </Field>
              <Field label="تكلفة الوحدة الافتراضية">
                <input
                  type="number"
                  step="0.000001"
                  min="0"
                  name="default_unit_cost"
                  className="input input-num"
                  defaultValue={Number(initial?.default_unit_cost ?? 0)}
                />
              </Field>
            </FormRow>

            <FormRow cols={3}>
              <Field label="حد إعادة الطلب">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  name="reorder_level"
                  className="input input-num"
                  defaultValue={Number(initial?.reorder_level ?? 0)}
                />
              </Field>
              <Field label="نسبة الضريبة %" hint="فارغ = النسبة الافتراضية">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="tax_rate"
                  className="input input-num"
                  defaultValue={initial?.tax_rate ?? ""}
                />
              </Field>
              <Field label="الباركود">
                <input name="barcode" className="input input-num" defaultValue={initial?.barcode ?? ""} />
              </Field>
            </FormRow>

            <Field label="ملاحظات">
              <input name="notes" className="input" defaultValue={initial?.notes ?? ""} />
            </Field>

            {initial ? (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginTop: 12 }}>
                <input type="checkbox" name="is_active" defaultChecked={initial.is_active} />
                المنتج فعّال
              </label>
            ) : null}

            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={busy}>
                {initial ? "حفظ التعديلات" : "إضافة المنتج"}
              </button>
            </div>
          </div>
        </div>
      </Card>
    </form>
  );
}
