import { dateStr } from "@/lib/format";

export default function PrintHeader({
  company,
  title,
  docNo,
  date,
  branch,
  extra,
}: {
  company: { company_name_ar?: string; company_phone?: string; company_address?: string; tax_number?: string };
  title: string;
  docNo?: string;
  date?: unknown;
  branch?: string;
  extra?: { label: string; value: string }[];
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 20,
        paddingBottom: 14,
        marginBottom: 16,
        borderBottom: "2px solid var(--brand)",
      }}
    >
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--brand)" }}>
          {company.company_name_ar ?? ""}
        </div>
        {company.company_address ? (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            {company.company_address}
          </div>
        ) : null}
        {company.company_phone ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>هاتف: {company.company_phone}</div>
        ) : null}
        {company.tax_number ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            الرقم الضريبي: <span className="num">{company.tax_number}</span>
          </div>
        ) : null}
      </div>

      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        {docNo ? (
          <div style={{ fontSize: 13, marginTop: 4 }}>
            رقم المستند: <span className="num">{docNo}</span>
          </div>
        ) : null}
        {date ? (
          <div style={{ fontSize: 13 }}>
            التاريخ: <span className="num">{dateStr(date)}</span>
          </div>
        ) : null}
        {branch ? <div style={{ fontSize: 13 }}>الوحدة: {branch}</div> : null}
        {extra?.map((e) => (
          <div key={e.label} style={{ fontSize: 13 }}>
            {e.label}: {e.value}
          </div>
        ))}
      </div>
    </div>
  );
}
