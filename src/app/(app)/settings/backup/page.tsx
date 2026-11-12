import { queryAs, requirePermission } from "@/lib/auth";
import { dateTimeStr } from "@/lib/format";
import { recordBackup } from "@/lib/actions/admin";
import { Card, Empty, Field, FormRow, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  await requirePermission("backup.run");

  const rows = await queryAs<Record<string, string>>(
    `select b.*, u.full_name as user_name from backup_log b
       left join app_users u on u.id = b.taken_by
      order by b.taken_at desc limit 50`,
  );

  const [integrity] = await queryAs<Record<string, string>>(
    "select count(*) filter (where not is_ok) as failed, count(*) as total from system_integrity_check()",
  );

  return (
    <>
      <PageHeader title="النسخ الاحتياطي وسلامة البيانات" />

      <Card title="فحص سلامة البيانات">
        <div
          className={`alert alert-${Number(integrity?.failed ?? 0) === 0 ? "success" : "error"}`}
          style={{ marginBottom: 12 }}
        >
          {Number(integrity?.failed ?? 0) === 0
            ? `كل الفحوص سليمة (${integrity?.total} فحصًا): القيود متوازنة، والمخزون مطابق للدفتر، والذمم مطابقة لكشوف الحسابات.`
            : `${integrity?.failed} فحص لم ينجح من أصل ${integrity?.total} — راجع القيود.`}
        </div>
        <IntegrityTable />
      </Card>

      <Card title="تسجيل نسخة احتياطية">
        <div className="alert alert-warning" style={{ fontSize: 13.5, marginBottom: 12 }}>
          نفّذ النسخ من الخادم بأمر <span className="num">pg_dump</span> ثم سجّل مكان النسخة هنا
          لتبقى سجلّات النسخ موثّقة. يوجد سكربت جاهز في{" "}
          <span className="num">scripts/backup.sh</span>.
        </div>
        <form action={recordBackup}>
          <FormRow cols={2}>
            <Field label="مكان النسخة"><input name="location" className="input" placeholder="/backups/erp-2026-10-21.sql.gz" /></Field>
            <Field label="ملاحظات"><input name="notes" className="input" /></Field>
          </FormRow>
          <button className="btn btn-primary">تسجيل النسخة</button>
        </form>
      </Card>

      <Card title="سجل النسخ" padded={false}>
        {rows.length === 0 ? (
          <Empty message="لم تُسجَّل نسخ بعد" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>بواسطة</th>
                <th>النوع</th>
                <th>المكان</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{dateTimeStr(r.taken_at)}</td>
                  <td>{r.user_name}</td>
                  <td>{r.kind === "manual" ? "يدوي" : "مجدول"}</td>
                  <td className="num" style={{ color: "var(--muted)" }}>{r.location}</td>
                  <td>
                    <span className={`badge badge-${r.status === "ok" ? "posted" : "cancelled"}`}>
                      {r.status === "ok" ? "ناجحة" : "فاشلة"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

async function IntegrityTable() {
  const checks = await queryAs<Record<string, string>>("select * from system_integrity_check()");
  return (
    <table className="table">
      <thead>
        <tr>
          <th>الفحص</th>
          <th className="cell-num">المتوقع</th>
          <th className="cell-num">الفعلي</th>
          <th>النتيجة</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c, i) => (
          <tr key={i}>
            <td>
              {c.check_name}
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.details}</div>
            </td>
            <td className="cell-num">{Number(c.expected).toLocaleString("en-US")}</td>
            <td className="cell-num">{Number(c.actual).toLocaleString("en-US")}</td>
            <td>
              <span className={`badge badge-${String(c.is_ok) === "true" ? "posted" : "cancelled"}`}>
                {String(c.is_ok) === "true" ? "سليم" : "يحتاج مراجعة"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
