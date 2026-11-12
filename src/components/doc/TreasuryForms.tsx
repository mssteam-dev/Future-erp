"use client";

import { useMemo, useState } from "react";
import { saveCollection, saveSupplierPayment } from "@/lib/actions/treasury";
import { Card, Field, FormRow } from "../ui";

export type OpenInvoice = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  party_id: string;
  outstanding: string;
};

type Treasury = { id: string; name_ar: string; kind: string; branch_id: string };

function AllocationTable({
  invoices,
  allocations,
  setAllocations,
}: {
  invoices: OpenInvoice[];
  allocations: Record<string, number>;
  setAllocations: (next: Record<string, number>) => void;
}) {
  if (invoices.length === 0) {
    return (
      <div style={{ padding: 14, color: "var(--muted)", fontSize: 13 }}>
        لا توجد فواتير مفتوحة لهذا الطرف
      </div>
    );
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>الفاتورة</th>
          <th>التاريخ</th>
          <th className="cell-num">المتبقي</th>
          <th className="cell-num" style={{ width: 150 }}>
            المخصص
          </th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv) => (
          <tr key={inv.id}>
            <td className="num">{inv.invoice_no}</td>
            <td className="num">{inv.invoice_date}</td>
            <td className="cell-num">{Number(inv.outstanding).toFixed(3)}</td>
            <td>
              <input
                type="number"
                step="0.001"
                min="0"
                max={Number(inv.outstanding)}
                className="input input-num"
                value={allocations[inv.id] ?? 0}
                onChange={(e) =>
                  setAllocations({ ...allocations, [inv.id]: Number(e.target.value) })
                }
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function useAllocation(invoices: OpenInvoice[], partyId: string, amount: number) {
  const partyInvoices = useMemo(
    () => invoices.filter((i) => i.party_id === partyId && Number(i.outstanding) > 0),
    [invoices, partyId],
  );
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  const autoAllocate = () => {
    let left = amount;
    const next: Record<string, number> = {};
    for (const inv of partyInvoices) {
      if (left <= 0) break;
      const take = Math.min(left, Number(inv.outstanding));
      next[inv.id] = Math.round(take * 1000) / 1000;
      left -= take;
    }
    setAllocations(next);
  };

  const allocated = Object.values(allocations).reduce((a, b) => a + (b || 0), 0);
  const payload = Object.entries(allocations)
    .filter(([, v]) => v > 0)
    .map(([invoice_id, amount]) => ({ invoice_id, amount }));

  return { partyInvoices, allocations, setAllocations, autoAllocate, allocated, payload };
}

export function CollectionForm({
  branches,
  customers,
  treasury,
  openInvoices,
  error,
}: {
  branches: { id: string; name_ar: string }[];
  customers: { id: string; name: string }[];
  treasury: Treasury[];
  openInvoices: OpenInvoice[];
  error?: string;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState(0);
  const alloc = useAllocation(openInvoices, customerId, amount);

  const accounts = treasury.filter((t) => t.kind === "bank" || t.branch_id === branchId);

  return (
    <form action={saveCollection}>
      <input type="hidden" name="allocations" value={JSON.stringify(alloc.payload)} />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card title="سند قبض من عميل">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input type="date" name="collection_date" className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)} required />
          </Field>
          <Field label="الفرع">
            <select name="branch_id" className="select" value={branchId}
              onChange={(e) => setBranchId(e.target.value)} required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="العميل">
            <select name="customer_id" className="select" value={customerId}
              onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">— اختر العميل —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="المبلغ المحصَّل">
            <input type="number" step="0.001" min="0.001" name="amount" className="input input-num"
              value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
          </Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="الصندوق أو البنك">
            <select name="treasury_account_id" className="select" required>
              {accounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "cash" ? "صندوق" : "بنك"} — {t.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المرجع">
            <input name="reference" className="input" placeholder="رقم الشيك أو الحوالة" />
          </Field>
          <Field label="ملاحظات">
            <input name="notes" className="input" />
          </Field>
        </FormRow>
        <div className="alert alert-warning" style={{ fontSize: 13 }}>
          التحصيل يخفض ذمة العميل ويزيد الصندوق أو البنك — ولا يُسجَّل إيراد مبيعات جديد.
        </div>
      </Card>

      <Card
        title="توزيع المبلغ على الفواتير"
        padded={false}
        action={
          <button type="button" className="btn btn-ghost btn-sm" onClick={alloc.autoAllocate}>
            توزيع تلقائي على الأقدم
          </button>
        }
      >
        <AllocationTable
          invoices={alloc.partyInvoices}
          allocations={alloc.allocations}
          setAllocations={alloc.setAllocations}
        />
        <div style={{ padding: 12, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 13.5 }}>
            الموزَّع: <strong className="num">{alloc.allocated.toFixed(3)}</strong> من{" "}
            <strong className="num">{amount.toFixed(3)}</strong>
            {alloc.allocated > amount ? (
              <span style={{ color: "var(--danger)" }}> — التوزيع يتجاوز المبلغ</span>
            ) : null}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!customerId || amount <= 0 || alloc.allocated > amount}>
            حفظ وترحيل السند
          </button>
        </div>
      </Card>
    </form>
  );
}

export function SupplierPaymentForm({
  branches,
  suppliers,
  treasury,
  openInvoices,
  error,
}: {
  branches: { id: string; name_ar: string }[];
  suppliers: { id: string; name: string }[];
  treasury: Treasury[];
  openInvoices: OpenInvoice[];
  error?: string;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState(0);
  const alloc = useAllocation(openInvoices, supplierId, amount);

  const accounts = treasury.filter((t) => t.kind === "bank" || t.branch_id === branchId);

  return (
    <form action={saveSupplierPayment}>
      <input type="hidden" name="allocations" value={JSON.stringify(alloc.payload)} />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card title="سند صرف لمورد">
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input type="date" name="payment_date" className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)} required />
          </Field>
          <Field label="الفرع">
            <select name="branch_id" className="select" value={branchId}
              onChange={(e) => setBranchId(e.target.value)} required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="المورد">
            <select name="supplier_id" className="select" value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="المبلغ المدفوع">
            <input type="number" step="0.001" min="0.001" name="amount" className="input input-num"
              value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
          </Field>
        </FormRow>
        <FormRow cols={3}>
          <Field label="الصندوق أو البنك">
            <select name="treasury_account_id" className="select" required>
              {accounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "cash" ? "صندوق" : "بنك"} — {t.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المرجع">
            <input name="reference" className="input" />
          </Field>
          <Field label="ملاحظات">
            <input name="notes" className="input" />
          </Field>
        </FormRow>
        <div className="alert alert-warning" style={{ fontSize: 13 }}>
          الدفع يخفض ذمة المورد ويخفض النقدية — ولا يُسجَّل مشتريات مرة ثانية.
        </div>
      </Card>

      <Card
        title="توزيع المبلغ على فواتير المورد"
        padded={false}
        action={
          <button type="button" className="btn btn-ghost btn-sm" onClick={alloc.autoAllocate}>
            توزيع تلقائي على الأقدم
          </button>
        }
      >
        <AllocationTable
          invoices={alloc.partyInvoices}
          allocations={alloc.allocations}
          setAllocations={alloc.setAllocations}
        />
        <div style={{ padding: 12, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 13.5 }}>
            الموزَّع: <strong className="num">{alloc.allocated.toFixed(3)}</strong> من{" "}
            <strong className="num">{amount.toFixed(3)}</strong>
          </div>
          <button type="submit" className="btn btn-primary" disabled={!supplierId || amount <= 0 || alloc.allocated > amount}>
            حفظ وترحيل السند
          </button>
        </div>
      </Card>
    </form>
  );
}
