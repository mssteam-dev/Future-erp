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
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h1>
        {subtitle ? (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "5px 0 0" }}>{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="no-print" style={{ display: "flex", gap: 8 }}>{action}</div> : null}
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
        <header
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: 0 }}>{title}</h2>
          {action}
        </header>
      ) : null}
      <div style={padded ? { padding: 16 } : undefined}>{children}</div>
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
    <div className="card" style={{ padding: "13px 15px" }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 19, fontWeight: 700, color }}>
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
      style={{ textDecoration: "none" }}
    >
      {children}
    </Link>
  );
}

export function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${Math.floor(1100 / cols)}px, 1fr))`,
        gap: 12,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

export function FormRow({ children, cols = 3 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
        gap: 12,
        marginBottom: 12,
      }}
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
