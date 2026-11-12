import Link from "next/link";
import { STATUS_LABEL, money } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="page-actions no-print">{action}</div> : null}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  padded = true,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      {title ? (
        <header className="card-head">
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={padded ? "card-body" : "card-body-flush"}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "brand";
}) {
  const color =
    tone === "good"
      ? "var(--success)"
      : tone === "bad"
        ? "var(--danger)"
        : tone === "brand"
          ? "var(--brand)"
          : "var(--text)";
  return (
    <div className="card stat-card">
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div className="num stat-value" style={{ color }}>
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      ) : null}
    </div>
  );
}

export function Money({ value, tone }: { value: unknown; tone?: boolean }) {
  const n = Number(value ?? 0);
  const color = tone ? (n < 0 ? "var(--danger)" : n > 0 ? "var(--success)" : undefined) : undefined;
  return (
    <span className="num" style={{ color }}>
      {money(n)}
    </span>
  );
}

export function Empty({ message = "لا توجد بيانات" }: { message?: string }) {
  return (
    <div style={{ padding: "34px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
      {message}
    </div>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
  small,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  small?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`btn btn-${variant}${small ? " btn-sm" : ""}`}
    >
      {children}
    </Link>
  );
}

export function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div
      className="stat-grid"
      style={{ "--min": `${cols >= 4 ? 220 : 260}px` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

export function FormRow({ children, cols = 3 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      className="form-row"
      data-cols={cols}
      style={{ "--cols": cols } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      ) : null}
    </div>
  );
}
