import { queryAs } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { DOC_TYPE_LABEL, dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to, branch } = periodFrom(sp);
  const [branches, settings] = await Promise.all([getBranches(), getSettings()]);

  const accounts = await queryAs<Record<string, string>>(
    "select id, code, name_ar from accounts where is_postable and is_active order by code",
  );
  const accountId = sp.account || accounts[0]?.id;
  const account = accounts.find((a) => a.id === accountId);

  const rows = accountId
    ? await queryAs<Record<string, string>>(
        "select * from report_account_statement($1::uuid, $2::date, $3::date, $4::uuid)",
        [accountId, from, to, branch],
      )
    : [];

  const debit = rows.slice(1).reduce((a, r) => a + Number(r.debit ?? 0), 0);
  const credit = rows.slice(1).reduce((a, r) => a + Number(r.credit ?? 0), 0);
  const opening = rows.length ? Number(rows[0].balance) : 0;
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;

  return (
    <>
      <PageHeader title="كشف حساب" subtitle="حركة أي حساب من دليل الحسابات خلال الفترة" />
      <Filters
        branches={branches}
        extra={[
          {
            name: "account",
            label: "الحساب",
            options: accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.name_ar}` })),
          },
        ]}
      />

      <Grid cols={4}>
        <Stat label="رصيد ما قبل الفترة" value={money(opening)} />
        <Stat label="إجمالي المدين" value={money(debit)} />
        <Stat label="إجمالي الدائن" value={money(credit)} />
        <Stat label="الرصيد الختامي" value={money(closing)} tone="brand" />
      </Grid>

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title="كشف حساب"
          extra={[
            { label: "الحساب", value: account ? `${account.code} — ${account.name_ar}` : "" },
            { label: "الفترة", value: `${from} — ${to}` },
          ]}
        />
        {rows.length === 0 ? (
          <Empty message="لا توجد حركات على هذا الحساب" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>نوع الحركة</th>
                <th>القيد</th>
                <th>الوحدة</th>
                <th>البيان</th>
                <th className="cell-num">مدين</th>
                <th className="cell-num">دائن</th>
                <th className="cell-num">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={i === 0 ? { background: "#f7f9fd", fontWeight: 600 } : undefined}>
                  <td className="num">{dateStr(r.entry_date)}</td>
                  <td>{i === 0 ? "" : DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type}</td>
                  <td className="num">{r.doc_no ?? ""}</td>
                  <td>{r.branch_name ?? ""}</td>
                  <td style={{ color: "var(--muted)" }}>{r.description}</td>
                  <td className="cell-num">{Number(r.debit) ? money(r.debit) : ""}</td>
                  <td className="cell-num">{Number(r.credit) ? money(r.credit) : ""}</td>
                  <td className="cell-num" style={{ fontWeight: 600 }}><Money value={r.balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>الإجمالي</td>
                <td className="cell-num">{money(debit)}</td>
                <td className="cell-num">{money(credit)}</td>
                <td className="cell-num">{money(closing)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
