"use client";

import type { DocLine } from "./LineTable";
import { round } from "./LineTable";

export type ExpenseKind = "freight" | "customs" | "transport" | "insurance" | "other";
export type AllocBasis = "default" | "qty" | "weight" | "value";
export type AllocMethod = "qty" | "weight" | "value";

export type ExpenseRow = {
  key: string;
  kind: ExpenseKind;
  description: string;
  amount: number;
  alloc_basis: AllocBasis;
  /** فارغ = مستحق للمورد الأساسي | t:معرّف = يُدفع من صندوق/بنك | s:معرّف = مستحق لمورد آخر */
  payee: string;
};

export const EXPENSE_KINDS: [ExpenseKind, string][] = [
  ["freight", "شحن"],
  ["customs", "تخليص جمركي"],
  ["transport", "نقل"],
  ["insurance", "تأمين"],
  ["other", "أخرى"],
];

export const METHOD_LABEL: Record<AllocMethod, string> = {
  qty: "بالتساوي على القطع",
  weight: "حسب الوزن",
  value: "حسب القيمة",
};

export function emptyExpense(kind: ExpenseKind = "freight"): ExpenseRow {
  return {
    key: Math.random().toString(36).slice(2),
    kind,
    description: "",
    amount: 0,
    alloc_basis: "default",
    payee: "",
  };
}

function basisValue(l: DocLine, basis: AllocMethod): number {
  if (basis === "qty") return l.quantity;
  if (basis === "weight") return l.weight_kg ?? 0;
  return round(l.quantity * l.rate - (l.discount || 0), 4);
}

/**
 * معاينة توزيع المصاريف على الأسطر — تطابق قاعدة الحساب في قاعدة البيانات:
 * تقريب كل نصيب لأربع خانات ثم تحميل الفرق على أكبر سطر في أساس التوزيع.
 * الأرقام النهائية تُحسب في الخادم عند الحفظ.
 */
export function previewAllocation(
  lines: DocLine[],
  expenses: ExpenseRow[],
  method: AllocMethod,
): { perLine: number[]; error: string | null } {
  const active = lines.map((l) => l.product_id !== "");
  const perLine = lines.map(() => 0);
  let error: string | null = null;

  for (const e of expenses) {
    if (!(e.amount > 0)) continue;
    const basis: AllocMethod = e.alloc_basis === "default" ? method : e.alloc_basis;
    const weights = lines.map((l, i) => (active[i] ? basisValue(l, basis) : 0));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) {
      error =
        basis === "weight"
          ? "التوزيع حسب الوزن يتطلب إدخال وزن الأصناف"
          : "لا يوجد أساس لتوزيع المصاريف: أضف أصنافًا بكميات وقيم";
      continue;
    }
    const shares = weights.map((w) => round((e.amount * w) / sum, 4));
    const resid = round(e.amount - shares.reduce((a, b) => a + b, 0), 4);
    if (resid !== 0) {
      let biggest = -1;
      weights.forEach((w, i) => {
        if (active[i] && (biggest === -1 || w > weights[biggest])) biggest = i;
      });
      if (biggest >= 0) shares[biggest] = round(shares[biggest] + resid, 4);
    }
    shares.forEach((s, i) => (perLine[i] = round(perLine[i] + s, 4)));
  }
  return { perLine, error };
}

type Payee = { value: string; label: string };

export default function ShipmentExpenses({
  expenses,
  setExpenses,
  payees,
  method,
}: {
  expenses: ExpenseRow[];
  setExpenses: (next: ExpenseRow[]) => void;
  payees: Payee[];
  method: AllocMethod;
}) {
  const update = (key: string, patch: Partial<ExpenseRow>) =>
    setExpenses(expenses.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table line-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th>
            <th style={{ width: 150 }}>نوع المصروف</th>
            <th style={{ minWidth: 150 }}>البيان</th>
            <th className="cell-num" style={{ width: 120 }}>
              المبلغ
            </th>
            <th style={{ width: 170 }}>أساس التوزيع</th>
            <th style={{ minWidth: 190 }}>الجهة الدائنة</th>
            <th style={{ width: 44 }}></th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e, i) => (
            <tr key={e.key}>
              <td className="num col-index" style={{ color: "var(--muted)" }}>
                {i + 1}
              </td>
              <td data-label="نوع المصروف">
                <select
                  className="select"
                  value={e.kind}
                  onChange={(ev) => update(e.key, { kind: ev.target.value as ExpenseKind })}
                >
                  {EXPENSE_KINDS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </td>
              <td data-label="البيان">
                <input
                  className="input"
                  value={e.description}
                  onChange={(ev) => update(e.key, { description: ev.target.value })}
                  placeholder="اختياري"
                />
              </td>
              <td data-label="المبلغ">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0"
                  className="input input-num"
                  value={e.amount}
                  onChange={(ev) => update(e.key, { amount: Number(ev.target.value) })}
                />
              </td>
              <td data-label="أساس التوزيع">
                <select
                  className="select"
                  value={e.alloc_basis}
                  onChange={(ev) => update(e.key, { alloc_basis: ev.target.value as AllocBasis })}
                >
                  <option value="default">كما في الشحنة ({METHOD_LABEL[method]})</option>
                  <option value="qty">بالتساوي على القطع</option>
                  <option value="weight">حسب الوزن</option>
                  <option value="value">حسب القيمة</option>
                </select>
              </td>
              <td data-label="الجهة الدائنة">
                <select
                  className="select"
                  value={e.payee}
                  onChange={(ev) => update(e.key, { payee: ev.target.value })}
                >
                  {payees.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="col-delete">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setExpenses(expenses.filter((x) => x.key !== e.key))}
                  title="حذف المصروف"
                  aria-label="حذف المصروف"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {expenses.length === 0 ? (
            <tr>
              <td className="col-empty" colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>
                لا مصاريف على هذه الفاتورة — أضف مصاريف الشحن أو التخليص لتدخل في تكلفة الأصناف
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {EXPENSE_KINDS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setExpenses([...expenses, emptyExpense(kind)])}
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
}
