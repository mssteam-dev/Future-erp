"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type BranchOption = { id: string; name_ar: string; kind: string };

export default function Filters({
  branches,
  showBranch = true,
  showPeriod = true,
  extra,
  allBranchesLabel = "كل الوحدات",
  exportReport,
}: {
  branches: BranchOption[];
  showBranch?: boolean;
  showPeriod?: boolean;
  extra?: { name: string; label: string; options: { value: string; label: string }[] }[];
  allBranchesLabel?: string;
  /** مفتاح التقرير في /api/export — يُظهر زر تصدير CSV */
  exportReport?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const today = new Date();
  const defFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const defTo = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  return (
    <div
      className="card no-print"
      style={{
        padding: 12,
        marginBottom: 16,
        display: "flex",
        gap: 12,
        alignItems: "flex-end",
        flexWrap: "wrap",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {showPeriod ? (
        <>
          <div>
            <label className="label">من تاريخ</label>
            <input
              type="date"
              className="input input-num"
              style={{ width: 160 }}
              defaultValue={params.get("from") ?? defFrom}
              onChange={(e) => set("from", e.target.value)}
            />
          </div>
          <div>
            <label className="label">إلى تاريخ</label>
            <input
              type="date"
              className="input input-num"
              style={{ width: 160 }}
              defaultValue={params.get("to") ?? defTo}
              onChange={(e) => set("to", e.target.value)}
            />
          </div>
        </>
      ) : null}

      {showBranch ? (
        <div>
          <label className="label">الوحدة</label>
          <select
            className="select"
            style={{ width: 190 }}
            defaultValue={params.get("branch") ?? ""}
            onChange={(e) => set("branch", e.target.value)}
          >
            <option value="">{allBranchesLabel}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name_ar}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {extra?.map((field) => (
        <div key={field.name}>
          <label className="label">{field.label}</label>
          <select
            className="select"
            style={{ width: 190 }}
            defaultValue={params.get(field.name) ?? ""}
            onChange={(e) => set(field.name, e.target.value)}
          >
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      <button className="btn btn-ghost btn-sm" onClick={() => window.print()} type="button">
        طباعة
      </button>

      {exportReport ? (
        <a
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: "none" }}
          href={`/api/export?report=${exportReport}&${params.toString()}`}
        >
          تصدير CSV
        </a>
      ) : null}
    </div>
  );
}
