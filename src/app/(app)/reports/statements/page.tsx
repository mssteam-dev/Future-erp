import { queryAs } from "@/lib/auth";
import { getCustomers, getSettings, getSuppliers, periodFrom } from "@/lib/data";
import { DOC_TYPE_LABEL, dateStr, money } from "@/lib/format";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Empty, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);
  const type = sp.type === "supplier" ? "supplier" : "customer";

  const [customers, suppliers, settings] = await Promise.all([
    getCustomers(),
    getSuppliers(),
    getSettings(),
  ]);

  const parties = type === "customer" ? customers : suppliers;
  const partyId = sp.party || parties[0]?.id;
  const party = parties.find((p) => p.id === partyId);

  const rows = partyId
    ? await queryAs<Record<string, string>>(
        type === "customer"
          ? "select * from report_customer_statement($1::uuid, $2::date, $3::date)"
          : "select * from report_supplier_statement($1::uuid, $2::date, $3::date)",
        [partyId, from, to],
      )
    : [];

  const debit = rows.slice(1).reduce((a, r) => a + Number(r.debit ?? 0), 0);
  const credit = rows.slice(1).reduce((a, r) => a + Number(r.credit ?? 0), 0);
  const opening = rows.length ? Number(rows[0].balance) : 0;
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;

  return (
    <>
      <PageHeader title="كشوف حسابات العملاء والموردين" />
      <Filters
        branches={[]}
        showBranch={false}
        extra={[
          {
            name: "type",
            label: "النوع",
            options: [
              { value: "customer", label: "عميل" },
              { value: "supplier", label: "مورد" },
            ],
          },
          {
            name: "party",
            label: type === "customer" ? "العميل" : "المورد",
            options: parties.map((p) => ({ value: p.id, label: p.name })),
          },
        ]}
      />

      <Grid cols={4}>
        <Stat label="رصيد ما قبل الفترة" value={money(opening)} />
        <Stat label={type === "customer" ? "فواتير وحركات مدينة" : "مدفوعات ومرتجعات"} value={money(debit)} />
        <Stat label={type === "customer" ? "تحصيلات ومرتجعات" : "فواتير مشتريات"} value={money(credit)} />
        <Stat label="الرصيد النهائي" value={money(closing)} tone="brand" />
      </Grid>

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title={type === "customer" ? "كشف حساب عميل" : "كشف حساب مورد"}
          extra={[
            { label: type === "customer" ? "العميل" : "المورد", value: party?.name ?? "" },
            { label: "الفترة", value: `${from} — ${to}` },
          ]}
        />
        {rows.length === 0 ? (
          <Empty message="لا توجد حركات" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>نوع الحركة</th>
                <th>المستند</th>
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
                  <td style={{ color: "var(--muted)" }}>{r.description}</td>
                  <td className="cell-num">{Number(r.debit) ? money(r.debit) : ""}</td>
                  <td className="cell-num">{Number(r.credit) ? money(r.credit) : ""}</td>
                  <td className="cell-num" style={{ fontWeight: 600 }}><Money value={r.balance} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>الإجمالي</td>
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
