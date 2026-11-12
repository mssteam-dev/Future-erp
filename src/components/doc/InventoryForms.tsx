"use client";

import { useActionState, useState } from "react";
import { saveStockAdjustment, saveStockTransfer } from "@/lib/actions/inventory";
import LineTable, { type DocLine, type ProductOption, emptyLine, round } from "./LineTable";
import { Card, Field, FormRow } from "../ui";
import type { StockMapClient } from "./types";

export function TransferForm({
  branches,
  products,
  stockByBranch,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  products: ProductOption[];
  stockByBranch: StockMapClient;
}) {
  const [state, action, pending] = useActionState(saveStockTransfer, {});
  const parent = branches.find((b) => b.kind === "parent");
  const [from, setFrom] = useState(parent?.id ?? branches[0]?.id ?? "");
  const [to, setTo] = useState(branches.find((b) => b.kind === "branch")?.id ?? "");
  const [lines, setLines] = useState<DocLine[]>([emptyLine()]);

  const stock = stockByBranch[from] ?? {};
  const totalCost = round(
    lines.reduce((s, l) => s + (stock[l.product_id]?.avg_cost ?? 0) * l.quantity, 0),
  );

  const payload = lines
    .filter((l) => l.product_id && l.quantity > 0)
    .map((l) => ({ product_id: l.product_id, quantity: l.quantity }));

  return (
    <form action={action}>
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      {state.error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{state.error}</div> : null}

      <Card title="بيانات التحويل">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input
              type="date"
              name="transfer_date"
              className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </Field>
          <Field label="من وحدة">
            <select name="from_branch_id" className="select" value={from} onChange={(e) => setFrom(e.target.value)} required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="إلى وحدة">
            <select name="to_branch_id" className="select" value={to} onChange={(e) => setTo(e.target.value)} required>
              {branches.filter((b) => b.id !== from).map((b) => (
                <option key={b.id} value={b.id}>{b.name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات">
            <input name="notes" className="input" />
          </Field>
        </FormRow>
        <div className="alert alert-warning" style={{ fontSize: 13 }}>
          التحويل نقل مخزون وتكلفة بين وحدتين — لا يُسجَّل إيرادًا للشركة الأم ولا مصروف شراء للفرع.
        </div>
      </Card>

      <Card title="الأصناف المحوَّلة" padded={false}>
        <LineTable mode="transfer" lines={lines} setLines={setLines} products={products} stock={stock} />
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14 }}>
            التكلفة التقديرية للتحويل:{" "}
            <strong className="num">
              {totalCost.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
            </strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" name="intent" value="draft" className="btn btn-ghost" disabled={pending}>
              حفظ كمسودة
            </button>
            <button type="submit" name="intent" value="post" className="btn btn-primary" disabled={pending}>
              حفظ وترحيل
            </button>
          </div>
        </div>
      </Card>
    </form>
  );
}

export function AdjustmentForm({
  branches,
  products,
  stockByBranch,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  products: ProductOption[];
  stockByBranch: StockMapClient;
}) {
  const [state, action, pending] = useActionState(saveStockAdjustment, {});
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [kind, setKind] = useState("count");
  const [lines, setLines] = useState<DocLine[]>([emptyLine()]);

  const stock = stockByBranch[branchId] ?? {};

  const payload = lines
    .filter((l) => l.product_id)
    .map((l) => ({
      product_id: l.product_id,
      system_qty: l.system_qty ?? 0,
      counted: l.counted ?? 0,
      rate: l.rate ?? 0,
    }));

  const diffValue = round(
    payload.reduce((s, l) => s + (l.counted - l.system_qty) * (l.rate || 0), 0),
  );

  return (
    <form action={action}>
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      {state.error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{state.error}</div> : null}

      <Card title="بيانات التسوية">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input
              type="date"
              name="adjustment_date"
              className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </Field>
          <Field label="الوحدة">
            <select name="branch_id" className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="النوع">
            <select name="kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="count">جرد فعلي</option>
              <option value="adjustment">تسوية مخزنية</option>
              <option value="opening">رصيد أول المدة</option>
            </select>
          </Field>
          <Field label="السبب / البيان">
            <input name="reason" className="input" />
          </Field>
        </FormRow>
      </Card>

      <Card title="الأصناف" padded={false}>
        <LineTable mode="count" lines={lines} setLines={setLines} products={products} stock={stock} />
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14 }}>
            قيمة الفروقات:{" "}
            <strong className="num" style={{ color: diffValue < 0 ? "var(--danger)" : "var(--success)" }}>
              {diffValue.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
            </strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" name="intent" value="draft" className="btn btn-ghost" disabled={pending}>
              حفظ كمسودة
            </button>
            <button type="submit" name="intent" value="post" className="btn btn-primary" disabled={pending}>
              حفظ وترحيل
            </button>
          </div>
        </div>
      </Card>
    </form>
  );
}
