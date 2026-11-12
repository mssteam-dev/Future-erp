"use client";

import { useActionState, useState } from "react";
import { saveSalesReturn } from "@/lib/actions/sales";
import { savePurchaseReturn } from "@/lib/actions/purchases";
import LineTable, { type DocLine, type ProductOption, emptyLine, lineTax, round } from "./LineTable";
import { Totals } from "./SalesInvoiceForm";
import { Card, Field, FormRow } from "../ui";

type Treasury = { id: string; name_ar: string; kind: string; branch_id: string };

export function SalesReturnForm({
  branches,
  products,
  customers,
  treasury,
  taxEnabled,
  defaultTaxRate,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  products: ProductOption[];
  customers: { id: string; name: string }[];
  treasury: Treasury[];
  taxEnabled: boolean;
  defaultTaxRate: number;
}) {
  const [state, action, pending] = useActionState(saveSalesReturn, {});
  const [branchId, setBranchId] = useState(branches.find((b) => b.kind === "branch")?.id ?? "");
  const [mode, setMode] = useState("credit");
  const [lines, setLines] = useState<DocLine[]>([emptyLine()]);

  const accounts = treasury.filter(
    (t) => t.kind === "bank" || t.branch_id === branchId,
  );
  const net = round(lines.reduce((s, l) => s + l.quantity * l.rate, 0));
  const tax = round(lines.reduce((s, l) => s + lineTax(l), 0));

  const payload = lines
    .filter((l) => l.product_id)
    .map((l) => ({ product_id: l.product_id, quantity: l.quantity, rate: l.rate, tax_rate: l.tax_rate || 0 }));

  return (
    <form action={action}>
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      {state.error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{state.error}</div> : null}

      <Card title="بيانات المرتجع">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input type="date" name="return_date" className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)} required />
          </Field>
          <Field label="الفرع">
            <select name="branch_id" className="select" value={branchId}
              onChange={(e) => setBranchId(e.target.value)} required>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name_ar}</option>))}
            </select>
          </Field>
          <Field label="العميل">
            <select name="customer_id" className="select">
              <option value="">عميل نقدي</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </Field>
          <Field label="معالجة المبلغ">
            <select name="refund_mode" className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="credit">خصم من ذمة العميل</option>
              <option value="cash">رد نقدي</option>
              <option value="bank">رد بنكي</option>
            </select>
          </Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="الصندوق أو البنك">
            <select name="treasury_account_id" className="select" disabled={mode === "credit"}>
              <option value="">—</option>
              {accounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "cash" ? "صندوق" : "بنك"} — {t.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات"><input name="notes" className="input" /></Field>
        </FormRow>
      </Card>

      <Card title="الأصناف المرتجعة" padded={false}>
        <LineTable mode="sale" lines={lines} setLines={setLines} products={products}
          taxEnabled={taxEnabled} defaultTaxRate={defaultTaxRate} />
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: "min(100%, 260px)" }}>
            <Totals
              rows={[
                ["قيمة المرتجع", net],
                ...(taxEnabled ? ([["الضريبة", tax]] as [string, number][]) : []),
                ["الإجمالي", round(net + tax)],
              ]}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="submit" name="intent" value="draft" className="btn btn-ghost" disabled={pending}>حفظ كمسودة</button>
            <button type="submit" name="intent" value="post" className="btn btn-primary" disabled={pending}>حفظ وترحيل</button>
          </div>
        </div>
      </Card>
    </form>
  );
}

export function PurchaseReturnForm({
  branches,
  products,
  suppliers,
  treasury,
  taxEnabled,
  defaultTaxRate,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  products: ProductOption[];
  suppliers: { id: string; name: string }[];
  treasury: Treasury[];
  taxEnabled: boolean;
  defaultTaxRate: number;
}) {
  const [state, action, pending] = useActionState(savePurchaseReturn, {});
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [mode, setMode] = useState("credit");
  const [lines, setLines] = useState<DocLine[]>([emptyLine()]);

  const accounts = treasury.filter((t) => t.kind === "bank" || t.branch_id === branchId);
  const net = round(lines.reduce((s, l) => s + l.quantity * l.rate, 0));
  const tax = round(lines.reduce((s, l) => s + lineTax(l), 0));

  const payload = lines
    .filter((l) => l.product_id)
    .map((l) => ({ product_id: l.product_id, quantity: l.quantity, rate: l.rate, tax_rate: l.tax_rate || 0 }));

  return (
    <form action={action}>
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      {state.error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{state.error}</div> : null}

      <Card title="بيانات مرتجع المشتريات">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input type="date" name="return_date" className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)} required />
          </Field>
          <Field label="المورد">
            <select name="supplier_id" className="select" required>
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Field>
          <Field label="الوحدة">
            <select name="branch_id" className="select" value={branchId}
              onChange={(e) => setBranchId(e.target.value)} required>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name_ar}</option>))}
            </select>
          </Field>
          <Field label="معالجة المبلغ">
            <select name="settle_mode" className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="credit">خصم من ذمة المورد</option>
              <option value="cash">استرداد نقدي</option>
              <option value="bank">استرداد بنكي</option>
            </select>
          </Field>
        </FormRow>
        <FormRow cols={2}>
          <Field label="الصندوق أو البنك">
            <select name="treasury_account_id" className="select" disabled={mode === "credit"}>
              <option value="">—</option>
              {accounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "cash" ? "صندوق" : "بنك"} — {t.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات"><input name="notes" className="input" /></Field>
        </FormRow>
        <div className="alert alert-warning" style={{ fontSize: 13 }}>
          أدخل تكلفة الشراء الأصلية للصنف حتى تُعكس التكلفة بالقيمة الصحيحة.
        </div>
      </Card>

      <Card title="الأصناف المرتجعة" padded={false}>
        <LineTable mode="purchase" lines={lines} setLines={setLines} products={products}
          taxEnabled={taxEnabled} defaultTaxRate={defaultTaxRate} />
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: "min(100%, 260px)" }}>
            <Totals
              rows={[
                ["قيمة المرتجع", net],
                ...(taxEnabled ? ([["الضريبة", tax]] as [string, number][]) : []),
                ["الإجمالي", round(net + tax)],
              ]}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="submit" name="intent" value="draft" className="btn btn-ghost" disabled={pending}>حفظ كمسودة</button>
            <button type="submit" name="intent" value="post" className="btn btn-primary" disabled={pending}>حفظ وترحيل</button>
          </div>
        </div>
      </Card>
    </form>
  );
}
