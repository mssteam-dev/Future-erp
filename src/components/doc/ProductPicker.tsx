"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProductOption } from "./LineTable";

export function ProductThumb({
  product,
  size = 34,
}: {
  product?: { id: string; has_image?: boolean; name_ar: string } | null;
  size?: number;
}) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 7,
    objectFit: "cover",
    background: "#f1f3f9",
    border: "1px solid var(--border)",
    flexShrink: 0,
  };

  if (!product) return <div style={style} />;
  if (!product.has_image) {
    return (
      <div
        style={{
          ...style,
          display: "grid",
          placeItems: "center",
          color: "#aab0c4",
          fontSize: size * 0.42,
        }}
        title="بلا صورة"
      >
        ▢
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/products/${product.id}/image`} alt={product.name_ar} style={style} />
  );
}

/**
 * منتقي المنتجات: بحث بالاسم أو الكود مع صورة الصنف ورصيده المتاح،
 * بدل القائمة المنسدلة التي يسهل الخلط فيها بين الأصناف المتشابهة.
 */
export default function ProductPicker({
  products,
  value,
  onChange,
  stock,
  mode,
}: {
  products: ProductOption[];
  value: string;
  onChange: (productId: string) => void;
  stock?: Record<string, { quantity: number; avg_cost: number }>;
  mode?: "sale" | "purchase" | "transfer" | "count";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => products.find((p) => p.id === value), [products, value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? products.filter(
          (p) => p.name_ar.toLowerCase().includes(q) || p.code.toLowerCase().includes(q),
        )
      : products;
    return list.slice(0, 60);
  }, [products, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(430, Math.max(r.width, 300));
      const spaceBelow = window.innerHeight - r.bottom;
      const height = 390;
      const top = spaceBelow < height && r.top > height ? r.top - height - 4 : r.bottom + 4;
      setRect({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDocClick = (e: MouseEvent) => {
      const inBox = boxRef.current?.contains(e.target as Node);
      const inPanel = panelRef.current?.contains(e.target as Node);
      if (!inBox && !inPanel) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="input"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          textAlign: "start",
          cursor: "pointer",
          height: 44,
          width: "100%",
        }}
      >
        <ProductThumb product={selected ? { ...selected, has_image: selected.has_image } : null} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? (
            <>
              <span className="num" style={{ color: "var(--muted)", fontSize: 12 }}>
                {selected.code}
              </span>{" "}
              {selected.name_ar}
            </>
          ) : (
            <span style={{ color: "var(--muted)" }}>اختر المنتج…</span>
          )}
        </span>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>▾</span>
      </button>

      {open && rect
        ? createPortal(
        <div
          ref={panelRef}
          dir="rtl"
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 11,
            boxShadow: "0 12px 32px rgba(16,24,48,.16)",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 9, borderBottom: "1px solid var(--border)" }}>
            <input
              ref={inputRef}
              className="input"
              placeholder="ابحث بالاسم أو الكود…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (results[0]) pick(results[0].id);
                }
              }}
            />
          </div>

          <div style={{ maxHeight: 330, overflowY: "auto" }}>
            {results.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                لا يوجد منتج مطابق
              </div>
            ) : (
              results.map((p) => {
                const available = stock?.[p.id]?.quantity;
                const out = mode === "sale" && available !== undefined && available <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 11px",
                      border: "none",
                      borderBottom: "1px solid #f3f5fa",
                      background: p.id === value ? "var(--brand-light)" : "#fff",
                      cursor: "pointer",
                      textAlign: "start",
                      font: "inherit",
                    }}
                  >
                    <ProductThumb product={p} size={40} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name_ar}
                      </span>
                      <span className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {p.code}
                      </span>
                    </span>
                    <span style={{ textAlign: "end", fontSize: 12 }}>
                      {available !== undefined ? (
                        <span
                          className="num"
                          style={{ display: "block", color: out ? "var(--danger)" : "var(--muted)" }}
                        >
                          رصيد {available}
                        </span>
                      ) : null}
                      <span className="num" style={{ color: "var(--text)" }}>
                        {Number(mode === "purchase" ? p.default_unit_cost : p.default_sale_price).toFixed(2)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
