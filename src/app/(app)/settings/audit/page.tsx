import { queryAs, requirePermission } from "@/lib/auth";
import { dateTimeStr } from "@/lib/format";
import { Card, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  insert: "إضافة",
  update: "تعديل",
  delete: "حذف",
  post: "ترحيل",
  cancel: "إلغاء",
  login: "تسجيل دخول",
  close_period: "إقفال فترة",
  reopen_period: "إعادة فتح فترة",
  close_year: "إقفال سنة",
};

export default async function AuditPage() {
  await requirePermission("audit.view");

  const rows = await queryAs<Record<string, string>>(
    `select l.*, u.full_name as user_name, b.name_ar as branch_name
       from audit_logs l
       left join app_users u on u.id = l.user_id
       left join branches b on b.id = l.branch_id
      order by l.at desc limit 300`,
  );

  return (
    <>
      <PageHeader title="سجل العمليات" subtitle="آخر 300 عملية على النظام" />
      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty message="لا توجد عمليات مسجلة" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المستخدم</th>
                <th>العملية</th>
                <th>الشاشة</th>
                <th>الوحدة</th>
                <th>البيان</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{dateTimeStr(r.at)}</td>
                  <td>{r.user_name ?? "—"}</td>
                  <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td style={{ color: "var(--muted)" }}>{r.entity}</td>
                  <td>{r.branch_name ?? ""}</td>
                  <td>{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
