"use client";

import { useMemo } from "react";
import ProductPicker from "./ProductPicker";

export type ProductOption = {
  id: string;
  code: string;
  name_ar: string;
  default_sale_price: string;
  default_unit_cost: string;
  tax_rate: string | null;
  has_image?: boolean;
};

export type DocLine = {
  key: string;
  product_id: string;
  quantity: number;
  rate: number; // سعر البيع أو تكلفة الشراء
  discount: number;
  tax_rate: number;
  counted?: number; // للجرد
  system_qty?: number;
};

export type LineMode = "sale" | "purchase" | "transfer" | "count";

export function emptyLine(): DocLine {
  return {
    key: Math.random().toString(36).slice(2),
    product_id: "",
    quantity: 1,
    rate: 0,
    discount: 0,
    tax_rate: 0,
  };
}

export function lineNet(l: DocLine): number {
  return round(l.quantity * l.rate - (l.discount || 0), 4);
}
export function lineTax(l: DocLine): number {
  return round(lineNet(l) * (l.tax_rate || 0) / 100, 4);
}
export function lineTotal(l: DocLine): number {
  return round(lineNet(l) + lineTax(l), 4);
}
export function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

export default function LineTable({
  mode,
  lines,
  setLines,
  products,
  taxEnabled,
  defaultTaxRate,
  stock,
}: {
  mode: LineMode;
  lines: DocLine[];
  setLines: (next: DocLine[]) => void;
  products: ProductOption[];
  taxEnabled?: boolean;
  defaultTaxRate?: number;
  stock?: Record<string, { quantity: number; avg_cost: number }>;
}) {
  const byId = useMemo(() => {
    const m: Record<string, ProductOption> = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  const update = (key: string, patch: Partial<DocLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onProduct = (key: string, productId: string) => {
    const p = byId[productId];
    const patch: Partial<DocLine> = { product_id: productId };
    if (p) {
      if (mode === "sale") patch.rate = Number(p.default_sale_price);
      if (mode === "purchase") patch.rate = Number(p.default_unit_cost);
      if (taxEnabled) patch.tax_rate = Number(p.tax_rate ?? defaultTaxRate ?? 0);
      if (mode === "count") {
        const s = stock?.[productId];
        patch.system_qty = s?.quantity ?? 0;
        patch.counted = s?.quantity ?? 0;
        patch.rate = s?.avg_cost ?? Number(p.default_unit_cost);
      }
    }
    update(key, patch);
  };

  const showRate = mode === "sale" || mode === "purchase" || mode === "count";
  const showDiscount = mode === "sale" || mode === "purchase";
  const showTax = taxEnabled && (mode === "sale" || mode === "purchase");

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th>
            <th style={{ minWidth: 230 }}>المنتج</th>
            {mode === "count" ? <th className="cell-num">الرصيد الدفتري</th> : null}
            <th className="cell-num" style={{ width: 110 }}>
              {mode === "count" ? "الجرد الفعلي" : "الكمية"}
            </th>
            {showRate ? (
              <th className="cell-num" style={{ width: 120 }}>
                {mode === "sale" ? "سعر البيع" : "تكلفة الوحدة"}
              </th>
            ) : null}
            {showDiscount ? (
              <th className="cell-num" style={{ width: 100 }}>
                الخصم
              </th>
            ) : null}
            {showTax ? (
              <th className="cell-num" style={{ width: 90 }}>
                الضريبة %
              </th>
            ) : null}
            {mode === "count" ? (
              <th className="cell-num" style={{ width: 100 }}>
                الفرق
              </th>
            ) : (
              <th className="cell-num" style={{ width: 120 }}>
                الإجمالي
              </th>
            )}
            <th style={{ width: 44 }}></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const available = stock?.[l.product_id]?.quantity;
            const short = mode === "sale" && available !== undefined && l.quantity > available;
            return (
              <tr key={l.key}>
                <td className="num" style={{ color: "var(--muted)" }}>
                  {i + 1}
                </td>
                <td>
                  <ProductPicker
                    products={products}
                    value={l.product_id}
                    onChange={(id) => onProduct(l.key, id)}
                    stock={stock}
                    mode={mode}
                  />
                  {available !== undefined && l.product_id ? (
                    <div
                      style={{
                        fontSize: 11.5,
                        marginTop: 3,
                        color: short ? "var(--danger)" : "var(--muted)",
                      }}
                    >
                      الرصيد المتاح: <span className="num">{available}</span>
                      {short ? " — الكمية غير كافية" : ""}
                    </div>
                  ) : null}
                </td>
                {mode === "count" ? (
                  <td className="cell-num num">{l.system_qty ?? 0}</td>
                ) : null}
                <td>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    className="input input-num"
                    value={mode === "count" ? (l.counted ?? 0) : l.quantity}
                    onChange={(e) =>
                      update(
                        l.key,
                        mode === "count"
                          ? { counted: Number(e.target.value) }
                          : { quantity: Number(e.target.value) },
                      )
                    }
                    required
                  />
                </td>
                {showRate ? (
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      min="0"
                      className="input input-num"
                      value={l.rate}
                      onChange={(e) => update(l.key, { rate: Number(e.target.value) })}
                      required
                    />
                  </td>
                ) : null}
                {showDiscount ? (
                  <td>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      className="input input-num"
                      value={l.discount}
                      onChange={(e) => update(l.key, { discount: Number(e.target.value) })}
                    />
                  </td>
                ) : null}
                {showTax ? (
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input input-num"
                      value={l.tax_rate}
                      onChange={(e) => update(l.key, { tax_rate: Number(e.target.value) })}
                    />
                  </td>
                ) : null}
                <td className="cell-num num" style={{ fontWeight: 600 }}>
                  {mode === "count"
                    ? round((l.counted ?? 0) - (l.system_qty ?? 0), 4)
                    : lineTotal(l).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                    title="حذف السطر"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          {lines.length === 0 ? (
            <tr>
              <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                أضف أصنافًا إلى المستند
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ padding: 12 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setLines([...lines, emptyLine()])}
        >
          + إضافة سطر
        </button>
      </div>
    </div>
  );
}
