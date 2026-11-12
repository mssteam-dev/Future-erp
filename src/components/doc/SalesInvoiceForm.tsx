"use client";

import { useActionState, useState } from "react";
import { saveSalesInvoice } from "@/lib/actions/sales";
import LineTable, {
  type DocLine,
  type ProductOption,
  emptyLine,
  lineNet,
  lineTax,
  round,
} from "./LineTable";
import { Card, Field, FormRow } from "../ui";

type Treasury = { id: string; name_ar: string; kind: string; branch_id: string };

export default function SalesInvoiceForm({
  branches,
  products,
  customers,
  treasury,
  taxEnabled,
  defaultTaxRate,
  stockByBranch,
  initial,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  products: ProductOption[];
  customers: { id: string; code: string; name: string }[];
  treasury: Treasury[];
  taxEnabled: boolean;
  defaultTaxRate: number;
  stockByBranch: Record<string, Record<string, { quantity: number; avg_cost: number }>>;
  initial?: {
    id: string;
    invoice_date: string;
    branch_id: string;
    customer_id: string | null;
    customer_name: string | null;
    notes: string | null;
    lines: DocLine[];
    payments: { method: "cash" | "bank"; treasury_account_id: string; amount: number }[];
  };
}) {
  const [state, action, pending] = useActionState(saveSalesInvoice, {});
  const [branchId, setBranchId] = useState(
    initial?.branch_id ?? branches.find((b) => b.kind === "branch")?.id ?? branches[0]?.id ?? "",
  );
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [lines, setLines] = useState<DocLine[]>(initial?.lines ?? [emptyLine()]);
  const [cashAmount, setCashAmount] = useState(
    initial?.payments.find((p) => p.method === "cash")?.amount ?? 0,
  );
  const [bankAmount, setBankAmount] = useState(
    initial?.payments.find((p) => p.method === "bank")?.amount ?? 0,
  );

  const branchTreasury = treasury.filter((t) => t.branch_id === branchId);
  const cashAccounts = branchTreasury.filter((t) => t.kind === "cash");
  const bankAccounts = treasury.filter((t) => t.kind === "bank");

  const [cashAccount, setCashAccount] = useState(
    initial?.payments.find((p) => p.method === "cash")?.treasury_account_id ?? "",
  );
  const [bankAccount, setBankAccount] = useState(
    initial?.payments.find((p) => p.method === "bank")?.treasury_account_id ?? "",
  );

  const subtotal = round(lines.reduce((s, l) => s + l.quantity * l.rate, 0));
  const discount = round(lines.reduce((s, l) => s + (l.discount || 0), 0));
  const tax = round(lines.reduce((s, l) => s + lineTax(l), 0));
  const total = round(subtotal - discount + tax);
  const paid = round((cashAmount || 0) + (bankAmount || 0));
  const remaining = round(total - paid);

  const payments = [
    cashAmount > 0
      ? {
          method: "cash" as const,
          treasury_account_id: cashAccount || cashAccounts[0]?.id || "",
          amount: cashAmount,
        }
      : null,
    bankAmount > 0
      ? {
          method: "bank" as const,
          treasury_account_id: bankAccount || bankAccounts[0]?.id || "",
          amount: bankAmount,
        }
      : null,
  ].filter(Boolean);

  const payload = lines
    .filter((l) => l.product_id)
    .map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      rate: l.rate,
      discount: l.discount || 0,
      tax_rate: l.tax_rate || 0,
    }));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <input type="hidden" name="payments" value={JSON.stringify(payments)} />

      {state.error ? (
        <div className="alert alert-error" style={{ marginBottom: 14 }}>
          {state.error}
        </div>
      ) : null}

      <Card title="بيانات الفاتورة">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input
              type="date"
              name="invoice_date"
              className="input input-num"
              defaultValue={initial?.invoice_date ?? today}
              required
            />
          </Field>
          <Field label="الفرع">
            <select
              name="branch_id"
              className="select"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="العميل" hint="اتركه فارغًا للبيع النقدي المباشر">
            <select
              name="customer_id"
              className="select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">عميل نقدي</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="اسم العميل النقدي">
            <input
              name="customer_name"
              className="input"
              defaultValue={initial?.customer_name ?? ""}
              placeholder="اختياري"
              disabled={!!customerId}
            />
          </Field>
        </FormRow>
        <Field label="ملاحظات">
          <input name="notes" className="input" defaultValue={initial?.notes ?? ""} />
        </Field>
      </Card>

      <Card title="الأصناف" padded={false}>
        <LineTable
          mode="sale"
          lines={lines}
          setLines={setLines}
          products={products}
          taxEnabled={taxEnabled}
          defaultTaxRate={defaultTaxRate}
          stock={stockByBranch[branchId] ?? {}}
        />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        <Card title="طريقة الدفع">
          <FormRow cols={2}>
            <Field label="المبلغ نقدًا">
              <input
                type="number"
                step="0.001"
                min="0"
                className="input input-num"
                value={cashAmount}
                onChange={(e) => setCashAmount(Number(e.target.value))}
              />
            </Field>
            <Field label="الصندوق">
              <select
                className="select"
                value={cashAccount}
                onChange={(e) => setCashAccount(e.target.value)}
              >
                <option value="">— اختر —</option>
                {cashAccounts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
            </Field>
          </FormRow>
          <FormRow cols={2}>
            <Field label="المبلغ بنكيًا">
              <input
                type="number"
                step="0.001"
                min="0"
                className="input input-num"
                value={bankAmount}
                onChange={(e) => setBankAmount(Number(e.target.value))}
              />
            </Field>
            <Field label="الحساب البنكي">
              <select
                className="select"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
              >
                <option value="">— اختر —</option>
                {bankAccounts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
            </Field>
          </FormRow>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCashAmount(total);
                setBankAmount(0);
                if (!cashAccount && cashAccounts[0]) setCashAccount(cashAccounts[0].id);
              }}
            >
              تحصيل كامل نقدًا
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCashAmount(0);
                setBankAmount(0);
              }}
            >
              بيع آجل بالكامل
            </button>
          </div>

          {remaining > 0 && !customerId ? (
            <div className="alert alert-warning" style={{ marginTop: 12 }}>
              المبلغ المتبقي <span className="num">{remaining}</span> يتطلب اختيار عميل مسجل —
              العميل النقدي لا تُفتح له ذمة.
            </div>
          ) : null}
          {remaining < 0 ? (
            <div className="alert alert-error" style={{ marginTop: 12 }}>
              المبلغ المدفوع أكبر من إجمالي الفاتورة.
            </div>
          ) : null}
        </Card>

        <Card title="الإجماليات">
          <Totals
            rows={[
              ["الإجمالي قبل الخصم", subtotal],
              ["الخصم", -discount],
              ...(taxEnabled ? ([["الضريبة", tax]] as [string, number][]) : []),
              ["إجمالي الفاتورة", total],
              ["المدفوع", paid],
              ["المتبقي (ذمة)", remaining],
            ]}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="submit"
              name="intent"
              value="draft"
              className="btn btn-ghost"
              disabled={pending}
              style={{ flex: 1 }}
            >
              حفظ كمسودة
            </button>
            <button
              type="submit"
              name="intent"
              value="post"
              className="btn btn-primary"
              disabled={pending || remaining < 0}
              style={{ flex: 1 }}
            >
              حفظ وترحيل
            </button>
          </div>
        </Card>
      </div>
    </form>
  );
}

export function Totals({ rows }: { rows: [string, number][] }) {
  return (
    <table style={{ width: "100%", fontSize: 13.5 }}>
      <tbody>
        {rows.map(([label, value], i) => {
          const strong = i === rows.length - 3 || i === rows.length - 1;
          return (
            <tr key={label}>
              <td style={{ padding: "6px 0", color: strong ? undefined : "var(--muted)" }}>
                {label}
              </td>
              <td
                className="num"
                style={{
                  padding: "6px 0",
                  textAlign: "left",
                  fontWeight: strong ? 700 : 500,
                  fontSize: strong ? 15 : 13.5,
                  color: value < 0 ? "var(--danger)" : undefined,
                }}
              >
                {value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
