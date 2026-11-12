"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type NavItem = { href: string; label: string };
export type NavGroup = { title: string; icon: string; items: NavItem[] };

export default function Sidebar({ groups, company }: { groups: NavGroup[]; company: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <button
        className="btn btn-ghost btn-sm no-print"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          top: 12,
          insetInlineEnd: 12,
          zIndex: 60,
          display: "none",
        }}
        data-mobile-toggle
      >
        ☰
      </button>

      <aside
        className="no-print"
        style={{
          width: 236,
          flexShrink: 0,
          background: "#fff",
          borderInlineStart: "1px solid var(--border)",
          height: "100vh",
          position: "sticky",
          top: 0,
          overflowY: "auto",
          display: open ? "block" : undefined,
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--brand)",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              ▣
            </span>
            <span style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.3 }}>{company}</span>
          </div>
        </div>

        <nav style={{ padding: "10px 10px 28px" }}>
          {groups.map((group) => (
            <div key={group.title} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "var(--muted)",
                  padding: "6px 10px",
                  letterSpacing: ".2px",
                }}
              >
                {group.icon} {group.title}
              </div>
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    style={{
                      display: "block",
                      padding: "8px 12px",
                      marginBottom: 2,
                      borderRadius: 8,
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 500,
                      color: active ? "var(--brand)" : "var(--text)",
                      background: active ? "var(--brand-light)" : "transparent",
                      textDecoration: "none",
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
