import { notFound } from "next/navigation";
import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getSettings, periodFrom } from "@/lib/data";
import { DOC_TYPE_LABEL, dateStr, money } from "@/lib/format";
import { saveBankReconciliation } from "@/lib/actions/treasury";
import Filters from "@/components/Filters";
import PrintHeader from "@/components/doc/PrintHeader";
import { Card, Field, FormRow, Grid, Money, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TreasuryStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("treasury.view");
  const { id } = await params;
  const sp = await searchParams;
  const { from, to } = periodFrom(sp);

  const [account] = await queryAs<Record<string, string>>(
    `select t.*, b.name_ar as branch_name from treasury_accounts t
       join branches b on b.id = t.branch_id where t.id = $1`,
    [id],
  );
  if (!account) notFound();

  const rows = await queryAs<Record<string, string>>(
    "select * from report_treasury_statement($1::uuid, $2::date, $3::date)",
    [id, from, to],
  );
  const settings = await getSettings();
  const branches = await getBranches();

  const receipts = rows.reduce((a, r) => a + Number(r.receipts ?? 0), 0);
  const payments = rows.reduce((a, r) => a + Number(r.payments ?? 0), 0);
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;
  const opening = rows.length ? Number(rows[0].balance) : 0;

  return (
    <>
      <PageHeader
        title={`كشف ${account.kind === "cash" ? "الصندوق" : "الحساب البنكي"} — ${account.name_ar}`}
        subtitle={account.branch_name}
      />
      <Filters branches={branches} showBranch={false} />

      <Grid cols={4}>
        <Stat label="الرصيد الافتتاحي" value={money(opening)} />
        <Stat label="المقبوضات" value={money(receipts)} tone="good" />
        <Stat label="المدفوعات" value={money(payments)} tone="bad" />
        <Stat label="الرصيد الحالي" value={money(closing)} tone="brand" />
      </Grid>

      <div className="card print-full" style={{ padding: 20 }}>
        <PrintHeader
          company={settings}
          title={account.kind === "cash" ? "كشف صندوق" : "كشف حساب بنكي"}
          branch={account.branch_name}
          extra={[{ label: "الحساب", value: account.name_ar }, { label: "الفترة", value: `${from} — ${to}` }]}
        />
        <table className="table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>نوع الحركة</th>
              <th>المستند</th>
              <th>البيان</th>
              <th className="cell-num">مقبوضات</th>
              <th className="cell-num">مدفوعات</th>
              <th className="cell-num">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="num">{dateStr(r.entry_date)}</td>
                <td>{DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type}</td>
                <td className="num">{r.doc_no ?? ""}</td>
                <td style={{ color: "var(--muted)" }}>{r.description}</td>
                <td className="cell-num">{Number(r.receipts) ? money(r.receipts) : ""}</td>
                <td className="cell-num">{Number(r.payments) ? money(r.payments) : ""}</td>
                <td className="cell-num" style={{ fontWeight: 600 }}><Money value={r.balance} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {account.kind === "bank" ? (
        <Card title="المطابقة البنكية">
          <form action={saveBankReconciliation}>
            <input type="hidden" name="treasury_account_id" value={id} />
            <FormRow cols={4}>
              <Field label="تاريخ الكشف">
                <input type="date" name="statement_date" className="input input-num" defaultValue={to} required />
              </Field>
              <Field label="رصيد كشف البنك">
                <input type="number" step="0.001" name="statement_balance" className="input input-num" required />
              </Field>
              <Field label="الرصيد الدفتري">
                <input className="input input-num" value={closing} disabled />
              </Field>
              <Field label="ملاحظات"><input name="notes" className="input" /></Field>
            </FormRow>
            <button className="btn btn-primary">حفظ المطابقة</button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
