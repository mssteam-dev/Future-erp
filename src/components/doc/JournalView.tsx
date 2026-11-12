import { queryAs } from "@/lib/auth";
import { money } from "@/lib/format";

export default async function JournalView({ docType, docId }: { docType: string; docId: string }) {
  const lines = await queryAs<Record<string, string>>(
    `select je.entry_no, je.entry_date, je.is_reversal, a.code, a.name_ar as account,
            b.name_ar as branch, jl.debit, jl.credit, jl.description
       from journal_lines jl
       join journal_entries je on je.id = jl.entry_id
       join accounts a on a.id = jl.account_id
       left join branches b on b.id = jl.branch_id
      where je.doc_type = $1::doc_type and je.doc_id = $2
      order by je.created_at, jl.line_no`,
    [docType, docId],
  );

  if (lines.length === 0) return null;

  return (
    <table className="table">
      <thead>
        <tr>
          <th>القيد</th>
          <th>الحساب</th>
          <th>الوحدة</th>
          <th>البيان</th>
          <th className="cell-num">مدين</th>
          <th className="cell-num">دائن</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} style={l.is_reversal ? { color: "var(--danger)" } : undefined}>
            <td className="num">{l.entry_no}</td>
            <td>
              <span className="num" style={{ color: "var(--muted)" }}>
                {l.code}
              </span>{" "}
              {l.account}
            </td>
            <td>{l.branch}</td>
            <td style={{ color: "var(--muted)" }}>{l.description}</td>
            <td className="cell-num">{Number(l.debit) ? money(l.debit) : ""}</td>
            <td className="cell-num">{Number(l.credit) ? money(l.credit) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
