"use client";

import { useState } from "react";
import { saveOpeningEntry, saveTreasuryOpening } from "@/lib/actions/opening";
import { Card, Field, FormRow } from "../ui";

type Opt = { id: string; name: string };

export function TreasuryOpeningForm({
  accounts,
}: {
  accounts: { id: string; name_ar: string; kind: string; branch_name: string }[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  if (accounts.length === 0) {
    return (
      <div style={{ fontSize: 13.5, color: "var(--muted)" }}>
        كل الصناديق والحسابات البنكية رُحِّلت أرصدتها الافتتاحية.
      </div>
    );
  }
  return (
    <form action={saveTreasuryOpening}>
      <FormRow cols={4}>
        <Field label="الصندوق / الحساب البنكي">
          <select name="treasury_account_id" className="select" required>
            <option value="">— اختر —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.branch_name} — {a.kind === "cash" ? "صندوق" : "بنك"} {a.name_ar}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الرصيد">
          <input type="number" name="amount" min="0" step="0.001" className="input input-num" required />
        </Field>
        <Field label="التاريخ">
          <input type="date" name="entry_date" className="input input-num" defaultValue={today} required />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="btn btn-primary">تسجيل الرصيد</button>
        </div>
      </FormRow>
    </form>
  );
}

export function OpeningEntryForm({
  branches,
  customers,
  suppliers,
  accounts,
}: {
  branches: { id: string; name_ar: string }[];
  customers: Opt[];
  suppliers: Opt[];
  accounts: { id: string; code: string; name_ar: string }[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState("customer");
  const [side, setSide] = useState("debit");

  // الأصل الطبيعي: العميل مدين والمورد دائن، ويمكن عكسه (دفعة مقدمة)
  const pick = (k: string) => {
    setKind(k);
    if (k === "customer") setSide("debit");
    if (k === "supplier") setSide("credit");
  };

  return (
    <form action={saveOpeningEntry}>
      <Card title="رصيد افتتاحي لعميل أو مورد أو حساب آخر">
        <FormRow cols={4}>
          <Field label="النوع">
            <select name="kind" className="select" value={kind} onChange={(e) => pick(e.target.value)}>
              <option value="customer">عميل</option>
              <option value="supplier">مورد</option>
              <option value="other">رصيد مدين / دائن آخر</option>
            </select>
          </Field>
          <Field label="الجهة">
            <select name="branch_id" className="select" required>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name_ar}
                </option>
              ))}
            </select>
          </Field>
          {kind === "customer" ? (
            <Field label="العميل">
              <select name="customer_id" className="select" required>
                <option value="">— اختر —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {kind === "supplier" ? (
            <Field label="المورد">
              <select name="supplier_id" className="select" required>
                <option value="">— اختر —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {kind === "other" ? (
            <Field label="الحساب">
              <select name="account_id" className="select" required>
                <option value="">— اختر —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name_ar}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="التاريخ">
            <input type="date" name="entry_date" className="input input-num" defaultValue={today} required />
          </Field>
        </FormRow>
        <FormRow cols={4}>
          <Field
            label="طبيعة الرصيد"
            hint={
              kind === "customer"
                ? "مدين = على العميل لنا"
                : kind === "supplier"
                  ? "دائن = علينا للمورد"
                  : "حسب طبيعة الحساب"
            }
          >
            <select name="side" className="select" value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="debit">مدين</option>
              <option value="credit">دائن</option>
            </select>
          </Field>
          <Field label="المبلغ">
            <input type="number" name="amount" min="0" step="0.001" className="input input-num" required />
          </Field>
          <Field label="البيان">
            <input name="description" className="input" placeholder="اختياري" />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-primary">تسجيل الرصيد</button>
          </div>
        </FormRow>
      </Card>
    </form>
  );
}
