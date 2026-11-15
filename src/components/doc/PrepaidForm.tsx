"use client";

import { useState } from "react";
import { savePrepaidExpense } from "@/lib/actions/prepaid";
import { Card, Field, FormRow } from "../ui";

export default function PrepaidForm({
  branches,
  types,
  treasury,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  types: { id: string; name_ar: string }[];
  treasury: { id: string; name_ar: string; kind: string; branch_id: string }[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [branchId, setBranchId] = useState(branches.find((b) => b.kind === "branch")?.id ?? branches[0]?.id ?? "");
  const [mode, setMode] = useState("cash");
  const [months, setMonths] = useState(12);
  const [amount, setAmount] = useState(0);

  const accounts = treasury.filter(
    (t) => (mode === "cash" ? t.kind === "cash" && t.branch_id === branchId : t.kind === "bank"),
  );
  const monthly = months > 0 ? Math.round((amount / months) * 10000) / 10000 : 0;

  return (
    <form action={savePrepaidExpense}>
      <Card title="تسجيل مصروف مدفوع مقدمًا">
        <FormRow cols={4}>
          <Field label="البيان">
            <input name="name" className="input" placeholder="مثال: إيجار سنوي" required />
          </Field>
          <Field label="الجهة المستفيدة">
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
          <Field label="نوع المصروف" hint="يُحمَّل القسط الشهري على هذا النوع">
            <select name="expense_type_id" className="select" required>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="تاريخ الدفع">
            <input type="date" name="pay_date" className="input input-num" defaultValue={today} required />
          </Field>
        </FormRow>

        <FormRow cols={4}>
          <Field label="بداية الاستفادة" hint="أول شهر يُحمَّل عليه القسط">
            <input type="date" name="start_date" className="input input-num" defaultValue={today} required />
          </Field>
          <Field label="عدد الأشهر">
            <input
              type="number"
              name="months"
              min={1}
              max={120}
              className="input input-num"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="المبلغ المدفوع">
            <input
              type="number"
              name="total_amount"
              min="0"
              step="0.001"
              className="input input-num"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="القسط الشهري" hint="الشهر الأخير يستوعب فرق التقريب">
            <input className="input input-num" value={monthly} readOnly tabIndex={-1} />
          </Field>
        </FormRow>

        <FormRow cols={3}>
          <Field label="طريقة الدفع">
            <select name="payment_mode" className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">نقدًا من صندوق</option>
              <option value="bank">من حساب بنكي</option>
              <option value="unpaid">مستحق غير مدفوع</option>
            </select>
          </Field>
          <Field label="الصندوق / الحساب البنكي">
            <select name="treasury_account_id" className="select" disabled={mode === "unpaid"}>
              <option value="">— اختر —</option>
              {accounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ملاحظات">
            <input name="notes" className="input" />
          </Field>
        </FormRow>

        <div className="alert alert-warning" style={{ fontSize: 13, marginBottom: 12 }}>
          يُسجَّل المبلغ أصلًا (مصروفًا مدفوعًا مقدمًا) ولا يظهر مصروفًا في الأرباح إلا بقدر القسط الشهري،
          ويُحمَّل القسط تلقائيًا عند إقفال كل شهر دون تكرار.
        </div>

        <button className="btn btn-primary">تسجيل وترحيل</button>
      </Card>
    </form>
  );
}
