import { dateStr, money, pct, qty } from "@/lib/format";
import Filters, { type BranchOption } from "./Filters";
import PrintHeader from "./doc/PrintHeader";
import { Empty, Grid, PageHeader, Stat } from "./ui";

export type ReportCol = {
  key: string;
  label: string;
  kind?: "text" | "date" | "money" | "qty" | "pct";
  /** يُجمع العمود في صف الإجمالي */
  total?: boolean;
  /** يحوّل القيمة الخام إلى نص عرض (مثل ترجمة الحالات) */
  format?: (value: unknown, row: Record<string, unknown>) => string;
};

export type ReportStat = { label: string; value: string; tone?: "default" | "good" | "bad" | "brand" };

function cell(col: ReportCol, row: Record<string, unknown>): string {
  const v = row[col.key];
  if (col.format) return col.format(v, row);
  if (v === null || v === undefined || v === "") return "—";
  switch (col.kind) {
    case "money":
      return money(v);
    case "qty":
      return qty(v);
    case "pct":
      return pct(v);
    case "date":
      return dateStr(v);
    default:
      return String(v);
  }
}

/** صفحة تقرير موحَّدة: عنوان + فلاتر + بطاقات ملخص + جدول قابل للطباعة والتصدير */
export default function ReportView({
  title,
  subtitle,
  exportKey,
  branches,
  settings,
  columns,
  rows,
  stats,
  showPeriod = true,
  showBranch = true,
  extraFilters,
  periodLabel,
  note,
  allBranchesLabel,
}: {
  title: string;
  subtitle?: string;
  exportKey: string;
  branches: BranchOption[];
  settings: Record<string, unknown>;
  columns: ReportCol[];
  rows: Record<string, unknown>[];
  stats?: ReportStat[];
  showPeriod?: boolean;
  showBranch?: boolean;
  extraFilters?: {
    name: string;
    label: string;
    options: { value: string; label: string }[];
    defaultValue?: string;
  }[];
  periodLabel?: string;
  note?: React.ReactNode;
  allBranchesLabel?: string;
}) {
  const hasTotals = columns.some((c) => c.total);
  const sum = (key: string) => rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Filters
        exportReport={exportKey}
        branches={branches}
        showPeriod={showPeriod}
        showBranch={showBranch}
        extra={extraFilters}
        allBranchesLabel={allBranchesLabel}
      />

      {stats && stats.length > 0 ? (
        <Grid cols={Math.min(4, stats.length)}>
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} />
          ))}
        </Grid>
      ) : null}

      {note ? <div className="alert alert-warning" style={{ marginBottom: 14, fontSize: 13 }}>{note}</div> : null}

      <div className="card print-full" style={{ padding: 20, marginBottom: 16 }}>
        <PrintHeader
          company={settings}
          title={title}
          extra={periodLabel ? [{ label: "الفترة", value: periodLabel }] : undefined}
        />
        {rows.length === 0 ? (
          <Empty message="لا توجد بيانات في هذا التقرير" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={c.kind && c.kind !== "text" && c.kind !== "date" ? "cell-num" : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={
                          c.kind === "money" || c.kind === "qty" || c.kind === "pct"
                            ? "cell-num"
                            : c.kind === "date"
                              ? "num"
                              : undefined
                        }
                      >
                        {cell(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {hasTotals ? (
                <tfoot>
                  <tr>
                    {columns.map((c, i) => (
                      <td key={c.key} className={c.total ? "cell-num" : undefined} style={{ fontWeight: 700 }}>
                        {c.total
                          ? c.kind === "qty"
                            ? qty(sum(c.key))
                            : money(sum(c.key))
                          : i === 0
                            ? "الإجمالي"
                            : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </div>
    </>
  );
}
