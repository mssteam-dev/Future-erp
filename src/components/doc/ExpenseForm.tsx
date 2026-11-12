"use client";

import { useState } from "react";
import { saveExpense } from "@/lib/actions/admin";
import { Card, Field, FormRow } from "../ui";

export default function ExpenseForm({
  branches,
  types,
  treasury,
  error,
}: {
  branches: { id: string; name_ar: string; kind: string }[];
  types: { id: string; name_ar: string; is_admin: boolean }[];
  treasury: { id: string; name_ar: string; kind: string; branch_id: string }[];
  error?: string;
}) {
  const parent = branches.find((b) => b.kind === "parent");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [branchId, setBranchId] = useState(branches.find((b) => b.kind === "branch")?.id ?? "");
  const [mode, setMode] = useState("cash");

  const type = types.find((t) => t.id === typeId);
  const isAdmin = Boolean(type?.is_admin);
  const effectiveBranch = isAdmin ? (parent?.id ?? branchId) : branchId;
  const accounts = treasury.filter(
    (t) => t.branch_id === effectiveBranch && (mode === "cash" ? t.kind === "cash" : t.kind === "bank"),
  );
  const bankAccounts = treasury.filter((t) => t.kind === "bank");

  return (
    <form action={saveExpense}>
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}

      <Card>
        <FormRow cols={4}>
          <Field label="التاريخ">
            <input type="date" name="expense_date" className="input input-num"
              defaultValue={new Date().toISOString().slice(0, 10)} required />
          </Field>
          <Field label="نوع المصروف">
            <select name="expense_type_id" className="select" value={typeId}
              onChange={(e) => setTypeId(e.target.value)} required>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_ar} {t.is_admin ? "(إداري)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="الوحدة"
            hint={isAdmin ? "المصاريف الإدارية تُسجَّل على الشركة الأم" : undefined}
          >
            <select
              name="branch_id"
              className="select"
              value={effectiveBranch}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={isAdmin}
              required
            >
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name_ar}</option>))}
            </select>
            {isAdmin ? <input type="hidden" name="branch_id" value={effectiveBranch} /> : null}
          </Field>
          <Field label="المبلغ">
            <input type="number" step="0.001" min="0.001" name="amount" className="input input-num" required />
          </Field>
        </FormRow>

        <FormRow cols={4}>
          <Field label="طريقة الدفع">
            <select name="payment_mode" className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">نقدًا من الصندوق</option>
              <option value="bank">من البنك</option>
              <option value="unpaid">غير مدفوع (التزام مستحق)</option>
            </select>
          </Field>
          <Field label="الحساب">
            <select name="treasury_account_id" className="select" disabled={mode === "unpaid"}>
              <option value="">—</option>
              {(mode === "bank" ? bankAccounts : accounts).map((t) => (
                <option key={t.id} value={t.id}>{t.name_ar}</option>
              ))}
            </select>
          </Field>
          <Field label="رقم السند"><input name="document_no" className="input" /></Field>
          <Field label="قابل للتوزيع على الفروع" hint={isAdmin ? "" : "للمصاريف الإدارية فقط"}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38 }}>
              <input type="checkbox" name="is_allocatable" defaultChecked={isAdmin} disabled={!isAdmin} />
              <span style={{ fontSize: 13.5 }}>يُوزَّع على الفروع الثلاثة</span>
            </label>
          </Field>
        </FormRow>

        <FormRow cols={2}>
          <Field label="البيان"><input name="description" className="input" /></Field>
          <Field label="ملاحظات"><input name="notes" className="input" /></Field>
        </FormRow>

        {mode === "unpaid" ? (
          <div className="alert alert-warning" style={{ fontSize: 13, marginBottom: 12 }}>
            المصروف غير المدفوع يُسجَّل التزامًا مستحقًا ولا يُخفِّض الصندوق أو البنك حتى سداده.
          </div>
        ) : null}

        <button className="btn btn-primary">حفظ وترحيل</button>
      </Card>
    </form>
  );
}
