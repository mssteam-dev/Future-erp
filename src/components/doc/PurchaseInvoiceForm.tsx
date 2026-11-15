"use client";

import { useActionState, useState } from "react";
import { savePurchaseInvoice } from "@/lib/actions/purchases";
import LineTable, {
  type DocLine,
  type ProductOption,
  dropForeignProducts,
  emptyLine,
  lineTax,
  round,
} from "./LineTable";
import ShipmentExpenses, {
  type AllocMethod,
  type ExpenseRow,
  METHOD_LABEL,
  emptyExpense,
  previewAllocation,
} from "./ShipmentExpenses";
import { Totals } from "./SalesInvoiceForm";
import { Card, Field, FormRow } from "../ui";

type Treasury = { id: string; name_ar: string; kind: string; branch_id: string };

export default function PurchaseInvoiceForm({
  branches,
  products,
  suppliers,
  treasury,
  taxEnabled,
  defaultTaxRate,
  initial,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  products: ProductOption[];
  suppliers: { id: string; name: string }[];
  treasury: Treasury[];
  taxEnabled: boolean;
  defaultTaxRate: number;
  initial?: {
    id: string;
    invoice_date: string;
    branch_id: string;
    supplier_id: string;
    is_central: boolean;
    supplier_ref_no: string | null;
    shipment_no: string | null;
    carrier: string | null;
    alloc_method: AllocMethod;
    notes: string | null;
    expenses: ExpenseRow[];
    lines: DocLine[];
    payments: { method: "cash" | "bank"; treasury_account_id: string; amount: number }[];
  };
}) {
  const [state, action, pending] = useActionState(savePurchaseInvoice, {});
  const parent = branches.find((b) => b.kind === "parent");
  const [branchId, setBranchId] = useState(initial?.branch_id ?? parent?.id ?? branches[0]?.id ?? "");
  const [lines, setLines] = useState<DocLine[]>(initial?.lines ?? [emptyLine()]);
  const [allocMethod, setAllocMethod] = useState<AllocMethod>(initial?.alloc_method ?? "qty");
  const [expenses, setExpenses] = useState<ExpenseRow[]>(initial?.expenses ?? []);
  const [cashAmount, setCashAmount] = useState(
    initial?.payments.find((p) => p.method === "cash")?.amount ?? 0,
  );
  const [bankAmount, setBankAmount] = useState(
    initial?.payments.find((p) => p.method === "bank")?.amount ?? 0,
  );
  const [cashAccount, setCashAccount] = useState(
    initial?.payments.find((p) => p.method === "cash")?.treasury_account_id ?? "",
  );
  const [bankAccount, setBankAccount] = useState(
    initial?.payments.find((p) => p.method === "bank")?.treasury_account_id ?? "",
  );

  const cashAccounts = treasury.filter((t) => t.kind === "cash" && t.branch_id === branchId);
  const bankAccounts = treasury.filter((t) => t.kind === "bank");

  const branchProducts = products.filter((p) => p.branch_id === branchId);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  // جهات دفع المصاريف: المورد الأساسي، أو صندوق/بنك يُدفع منه فورًا، أو مورد آخر (شركة شحن مثلًا)
  const payees = [
    { value: "", label: "المورد الأساسي (يُضاف لذمته)" },
    ...[...cashAccounts, ...bankAccounts].map((t) => ({
      value: `t:${t.id}`,
      label: `يُدفع الآن من: ${t.name_ar}`,
    })),
    ...suppliers.map((s) => ({ value: `s:${s.id}`, label: `مستحق لـ: ${s.name}` })),
  ];

  const subtotal = round(lines.reduce((s, l) => s + l.quantity * l.rate, 0));
  const discount = round(lines.reduce((s, l) => s + (l.discount || 0), 0));
  const tax = round(lines.reduce((s, l) => s + lineTax(l), 0));
  const expensesTotal = round(expenses.reduce((s, e) => s + (e.amount || 0), 0));
  const owedExpenses = round(
    expenses.filter((e) => e.payee === "").reduce((s, e) => s + (e.amount || 0), 0),
  );
  const total = round(subtotal - discount + tax + owedExpenses);
  const alloc = previewAllocation(lines, expenses, allocMethod);
  const totalWeight = round(lines.reduce((s, l) => s + (l.weight_kg || 0), 0));
  const paid = round((cashAmount || 0) + (bankAmount || 0));
  const remaining = round(total - paid);

  const payments = [
    cashAmount > 0
      ? { method: "cash" as const, treasury_account_id: cashAccount || cashAccounts[0]?.id || "", amount: cashAmount }
      : null,
    bankAmount > 0
      ? { method: "bank" as const, treasury_account_id: bankAccount || bankAccounts[0]?.id || "", amount: bankAmount }
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
      weight_kg: l.weight_kg || 0,
    }));

  const expensesPayload = expenses
    .filter((e) => e.amount > 0)
    .map((e) => ({
      kind: e.kind,
      description: e.description,
      amount: e.amount,
      alloc_basis: e.alloc_basis,
      payee: e.payee,
    }));

  const today = new Date().toISOString().slice(0, 10);
  const isParent = branches.find((b) => b.id === branchId)?.kind === "parent";

  return (
    <form action={action}>
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <input type="hidden" name="payments" value={JSON.stringify(payments)} />
      <input type="hidden" name="expenses" value={JSON.stringify(expensesPayload)} />

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
          <Field label="المورد">
            <select name="supplier_id" className="select" defaultValue={initial?.supplier_id ?? ""} required>
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الجهة المستفيدة" hint="الشركة الأم للشراء المركزي، أو الفرع مباشرة">
            <select
              name="branch_id"
              className="select"
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setLines(dropForeignProducts(lines, products, e.target.value));
              }}
              required
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="رقم فاتورة المورد">
            <input
              name="supplier_ref_no"
              className="input"
              defaultValue={initial?.supplier_ref_no ?? ""}
            />
          </Field>
        </FormRow>
        <FormRow cols={4}>
          <Field label="رقم الشحنة" hint="اختياري — يظهر في تقارير الشحنات والدفعات">
            <input name="shipment_no" className="input" defaultValue={initial?.shipment_no ?? ""} />
          </Field>
          <Field label="جهة الشحن">
            <input name="carrier" className="input" defaultValue={initial?.carrier ?? ""} />
          </Field>
          <Field label="طريقة توزيع المصاريف" hint="لكل مصروف أساس مستقل عند الحاجة">
            <select
              name="alloc_method"
              className="select"
              value={allocMethod}
              onChange={(e) => setAllocMethod(e.target.value as AllocMethod)}
            >
              {(Object.keys(METHOD_LABEL) as AllocMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات">
            <input name="notes" className="input" defaultValue={initial?.notes ?? ""} />
          </Field>
          <Field label="شراء مركزي">
            <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
              <input
                type="checkbox"
                name="is_central"
                defaultChecked={initial?.is_central ?? isParent}
              />
              <span style={{ fontSize: 13.5 }}>بضاعة للمستودع المركزي ثم تُحوَّل للفروع</span>
            </label>
          </Field>
        </FormRow>
      </Card>

      <Card title="الأصناف" padded={false}>
        <LineTable
          mode="purchase"
          lines={lines}
          setLines={setLines}
          products={products}
          branchId={branchId}
          showWeight
          taxEnabled={taxEnabled}
          defaultTaxRate={defaultTaxRate}
        />
        {branchProducts.length === 0 ? (
          <div className="alert alert-warning" style={{ margin: 12, fontSize: 13 }}>
            لا توجد بطاقات منتجات لهذه الجهة بعد — أنشئ المنتجات من شاشة «المنتجات» لهذه الجهة أولًا.
          </div>
        ) : null}
      </Card>

      <Card title="مصاريف الشحنة (تدخل في تكلفة الأصناف)" padded={false}>
        <ShipmentExpenses
          expenses={expenses}
          setExpenses={setExpenses}
          payees={payees}
          method={allocMethod}
        />
        {alloc.error && expensesTotal > 0 ? (
          <div className="alert alert-error" style={{ margin: 12, fontSize: 13 }}>
            {alloc.error}
          </div>
        ) : null}
      </Card>

      {expensesTotal > 0 && !alloc.error ? (
        <Card title="التكلفة النهائية بعد توزيع المصاريف (تقديرية)" padded={false}>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th className="cell-num">الكمية</th>
                  <th className="cell-num">السعر الأساسي</th>
                  <th className="cell-num">نصيب السطر من المصاريف</th>
                  <th className="cell-num">المصاريف للقطعة</th>
                  <th className="cell-num">التكلفة النهائية للقطعة</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  if (!l.product_id || !(l.quantity > 0)) return null;
                  const base = round(l.quantity * l.rate - (l.discount || 0), 4);
                  const share = alloc.perLine[i] ?? 0;
                  return (
                    <tr key={l.key}>
                      <td>{byId[l.product_id]?.name_ar}</td>
                      <td className="cell-num num">{l.quantity}</td>
                      <td className="cell-num num">{round(base / l.quantity, 4)}</td>
                      <td className="cell-num num">{share}</td>
                      <td className="cell-num num">{round(share / l.quantity, 4)}</td>
                      <td className="cell-num num" style={{ fontWeight: 700 }}>
                        {round((base + share) / l.quantity, 4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--muted)" }}>
            مجموع الموزَّع {round(alloc.perLine.reduce((a, b) => a + b, 0), 4)} = إجمالي المصاريف{" "}
            {expensesTotal} — الأرقام النهائية تُحسب عند الحفظ.
          </div>
        </Card>
      ) : null}

      <div className="split">
        <Card title="الدفع للمورد">
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
              <select className="select" value={cashAccount} onChange={(e) => setCashAccount(e.target.value)}>
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
              <select className="select" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)}>
                <option value="">— اختر —</option>
                {bankAccounts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name_ar}
                  </option>
                ))}
              </select>
            </Field>
          </FormRow>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCashAmount(total);
                setBankAmount(0);
                if (!cashAccount && cashAccounts[0]) setCashAccount(cashAccounts[0].id);
              }}
            >
              دفع كامل نقدًا
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCashAmount(0);
                setBankAmount(0);
              }}
            >
              شراء آجل بالكامل
            </button>
          </div>
        </Card>

        <Card title="الإجماليات">
          <Totals
            rows={[
              ["الإجمالي قبل الخصم", subtotal],
              ["الخصم", -discount],
              ...(taxEnabled ? ([["الضريبة", tax]] as [string, number][]) : []),
              ...(expensesTotal > 0
                ? ([
                    ["مصاريف الشحنة (كلها)", expensesTotal],
                    ["منها مستحق للمورد الأساسي", owedExpenses],
                  ] as [string, number][])
                : []),
              ...(totalWeight > 0 ? ([["إجمالي الوزن (كجم)", totalWeight]] as [string, number][]) : []),
              ["إجمالي الفاتورة", total],
              ["المدفوع", paid],
              ["المتبقي للمورد", remaining],
            ]}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <button type="submit" name="intent" value="draft" className="btn btn-ghost" disabled={pending} style={{ flex: 1 }}>
              حفظ كمسودة
            </button>
            <button type="submit" name="intent" value="post" className="btn btn-primary" disabled={pending || remaining < 0} style={{ flex: 1 }}>
              حفظ وترحيل
            </button>
          </div>
        </Card>
      </div>
    </form>
  );
}
