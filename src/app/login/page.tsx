import { redirect } from "next/navigation";
import { getSessionUser, login } from "@/lib/auth";
import { withAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  const error = await login(identifier, password);
  if (error) redirect(`/login?error=${encodeURIComponent(error)}`);
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSessionUser()) redirect("/");

  const { error } = await searchParams;
  const company = await withAdmin(async (client) => {
    const { rows } = await client.query("select company_name_ar, brand_color from settings limit 1");
    return rows[0] ?? { company_name_ar: "النظام المحاسبي", brand_color: "#15399A" };
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(160deg,#15399a 0%,#0f2a73 55%,#0b1f55 100%)",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "rgba(255,255,255,.14)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 14px",
              fontSize: 26,
            }}
          >
            ▣
          </div>
          <h1 style={{ color: "#fff", fontSize: 21, fontWeight: 700, margin: 0 }}>
            {company.company_name_ar}
          </h1>
          <p style={{ color: "rgba(255,255,255,.72)", fontSize: 13.5, margin: "6px 0 0" }}>
            النظام المحاسبي والإداري
          </p>
        </div>

        <form action={signIn} className="card" style={{ padding: 22 }}>
          {error ? (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          ) : null}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="identifier">
              اسم المستخدم أو البريد
            </label>
            <input id="identifier" name="identifier" className="input" required autoFocus />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label" htmlFor="password">
              كلمة المرور
            </label>
            <input id="password" name="password" type="password" className="input" required />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
            دخول
          </button>
        </form>
      </div>
    </div>
  );
}
