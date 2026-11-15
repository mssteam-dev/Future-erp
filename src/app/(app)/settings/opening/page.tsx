import { queryAs, requirePermission } from "@/lib/auth";
import { getBranches, getCustomers, getSuppliers } from "@/lib/data";
import { dateStr, money } from "@/lib/format";
import { cancelOpeningEntry } from "@/lib/actions/opening";
import { OpeningEntryForm, TreasuryOpeningForm } from "@/components/doc/OpeningEntryForm";
import { Card, Empty, Grid, LinkButton, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { customer: "عميل", supplier: "مورد", other: "حساب آخر" };
const SIDE: Record<string, string> = { debit: "مدين", credit: "دائن" };

export default async function OpeningBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requirePermission("settings.view");
  const { error, saved } = await searchParams;

  const [branches, customers, suppliers, accounts, treasury, entries, stockOpenings, equity] =
    await Promise.all([
      getBranches(),
      getCustomers(),
      getSuppliers(),
      queryAs<{ id: string; code: string; name_ar: string }>(
        `select id, code, name_ar from accounts
          where is_postable and is_active
            and (system_key is null
                 or system_key not in ('cash','bank','ar','ap','inventory','opening_equity'))
          order by code`,
      ),
      queryAs<Record<string, string>>(
        `select t.id, t.name_ar, t.kind, t.opening_balance, t.opening_posted, t.opening_date,
                b.name_ar as branch_name
           from treasury_accounts t join branches b on b.id = t.branch_id
          where t.is_active order by b.sort_order, t.kind, t.name_ar`,
      ),
      queryAs<Record<string, string>>(
        `select o.id, o.entry_no, o.entry_date, o.kind, o.side, o.amount, o.status, o.description,
                b.name_ar as branch_name,
                coalesce(c.name, s.name, a.name_ar) as party_name
           from opening_entries o
           join branches b on b.id = o.branch_id
           left join customers c on c.id = o.customer_id
           left join suppliers s on s.id = o.supplier_id
           left join accounts a on a.id = o.account_id
          order by o.entry_date desc, o.entry_no desc`,
      ),
      queryAs<Record<string, string>>(
        `select a.id, a.adjustment_no, a.adjustment_date, a.status, b.name_ar as branch_name,
                coalesce((select sum(l.difference_qty * l.unit_cost)
                            from stock_adjustment_lines l where l.adjustment_id = a.id), 0) as value
           from stock_adjustments a join branches b on b.id = a.branch_id
          where a.kind = 'opening' order by a.adjustment_date desc, a.adjustment_no desc`,
      ),
      queryAs<{ balance: string }>(
        `select coalesce(sum(jl.credit - jl.debit), 0) as balance
           from journal_lines jl join accounts a on a.id = jl.account_id
          where a.system_key = 'opening_equity'`,
      ),
    ]);

  const pendingTreasury = treasury.filter((t) => String(t.opening_posted) !== "true");
  const doneTreasury = treasury.filter((t) => String(t.opening_posted) === "true");
  const treasuryTotal = doneTreasury.reduce((a, t) => a + Number(t.opening_balance), 0);
  const live = entries.filter((e) => e.status === "posted");
  const customersNet = live
    .filter((e) => e.kind === "customer")
    .reduce((a, e) => a + (e.side === "debit" ? 1 : -1) * Number(e.amount), 0);
  const suppliersNet = live
    .filter((e) => e.kind === "supplier")
    .reduce((a, e) => a + (e.side === "credit" ? 1 : -1) * Number(e.amount), 0);
  const stockTotal = stockOpenings
    .filter((s) => s.status === "posted")
    .reduce((a, s) => a + Number(s.value), 0);

  return (
    <>
      <PageHeader
        title="الأرصدة الافتتاحية"
        subtitle="الصندوق والبنك والمخزون والعملاء والموردون وأي رصيد آخر — تُسجَّل أرصدة أول المدة ولا تُحتسب إيرادًا"
      />
      {error ? <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {saved ? <div className="alert alert-success" style={{ marginBottom: 14 }}>تم تسجيل الرصيد الافتتاحي</div> : null}

      <Grid cols={4}>
        <Stat label="الصندوق والبنك" value={money(treasuryTotal)} />
        <Stat label="مخزون أول المدة" value={money(stockTotal)} />
        <Stat label="العملاء (صافي مدين)" value={money(customersNet)} />
        <Stat label="الموردون (صافي دائن)" value={money(suppliersNet)} />
      </Grid>

      <div className="alert alert-warning" style={{ marginBottom: 16, fontSize: 13 }}>
        كل رصيد افتتاحي يُقابَل بحساب «الأرصدة الافتتاحية» ضمن حقوق الملكية (رصيده الحالي{" "}
        <strong className="num">{money(equity[0]?.balance ?? 0)}</strong>)، فلا يظهر إيرادًا ولا ربحًا
        في أي تقرير.
      </div>

      <Card title="1) الصندوق والحسابات البنكية">
        <TreasuryOpeningForm
          accounts={pendingTreasury.map((t) => ({
            id: t.id,
            name_ar: t.name_ar,
            kind: t.kind,
            branch_name: t.branch_name,
          }))}
        />
        {doneTreasury.length > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الجهة</th>
                  <th>الحساب</th>
                  <th>النوع</th>
                  <th>التاريخ</th>
                  <th className="cell-num">الرصيد الافتتاحي</th>
                </tr>
              </thead>
              <tbody>
                {doneTreasury.map((t) => (
                  <tr key={t.id}>
                    <td>{t.branch_name}</td>
                    <td>{t.name_ar}</td>
                    <td>{t.kind === "cash" ? "صندوق" : "بنك"}</td>
                    <td className="num">{dateStr(t.opening_date)}</td>
                    <td className="cell-num">{money(t.opening_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card
        title="2) مخزون أول المدة"
        action={<LinkButton href="/inventory/adjustments/new?kind=opening" small>+ إدخال مخزون أول المدة</LinkButton>}
        padded={false}
      >
        {stockOpenings.length === 0 ? (
          <Empty message="لم يُسجَّل مخزون أول المدة بعد — اختر الجهة ثم أدخل كمية كل منتج وتكلفته" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>الجهة</th>
                  <th>التاريخ</th>
                  <th className="cell-num">القيمة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {stockOpenings.map((s) => (
                  <tr key={s.id}>
                    <td className="num">
                      <a href={`/inventory/adjustments/${s.id}`}>{s.adjustment_no}</a>
                    </td>
                    <td>{s.branch_name}</td>
                    <td className="num">{dateStr(s.adjustment_date)}</td>
                    <td className="cell-num">{money(s.value)}</td>
                    <td>
                      <span className={`badge badge-${s.status}`}>
                        {s.status === "posted" ? "مرحّل" : s.status === "cancelled" ? "ملغى" : "مسودة"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <OpeningEntryForm
        branches={branches}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        accounts={accounts}
      />

      <Card title="3) أرصدة العملاء والموردين والحسابات الأخرى" padded={false}>
        {entries.length === 0 ? (
          <Empty message="لا توجد أرصدة افتتاحية مسجَّلة" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>الجهة</th>
                  <th>النوع</th>
                  <th>الطرف / الحساب</th>
                  <th>الطبيعة</th>
                  <th className="cell-num">المبلغ</th>
                  <th>الحالة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{e.entry_no}</td>
                    <td className="num">{dateStr(e.entry_date)}</td>
                    <td>{e.branch_name}</td>
                    <td>{KIND[e.kind] ?? e.kind}</td>
                    <td>{e.party_name}</td>
                    <td>{SIDE[e.side] ?? e.side}</td>
                    <td className="cell-num">{money(e.amount)}</td>
                    <td>
                      <span className={`badge badge-${e.status}`}>
                        {e.status === "posted" ? "مرحّل" : e.status === "cancelled" ? "ملغى" : "مسودة"}
                      </span>
                    </td>
                    <td>
                      {e.status === "posted" ? (
                        <form action={cancelOpeningEntry}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="reason" value="إلغاء من شاشة الأرصدة الافتتاحية" />
                          <button className="btn btn-danger btn-sm">إلغاء</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
