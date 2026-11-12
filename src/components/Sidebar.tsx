"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type NavItem = { href: string; label: string };
export type NavGroup = { title: string; icon: string; items: NavItem[] };

export default function Sidebar({ groups, company }: { groups: NavGroup[]; company: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  // إغلاق الدرج عند تغيّر الصفحة، وبمفتاح Escape، ومنع تمرير الخلفية أثناء فتحه
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="sidebar-toggle no-print"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
        aria-expanded={open}
        aria-controls="app-sidebar"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div
        className="sidebar-backdrop no-print"
        data-open={open}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <aside id="app-sidebar" className="sidebar no-print" data-open={open}>
        <div className="sidebar-head">
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

        <nav style={{ padding: "10px 10px 28px" }} aria-label="القائمة الرئيسية">
          {groups.map((group) => (
            <div key={group.title} style={{ marginBottom: 14 }}>
              <div className="nav-group-title">
                {group.icon} {group.title}
              </div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
