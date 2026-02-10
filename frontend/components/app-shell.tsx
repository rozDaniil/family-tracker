"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, Home, LayoutGrid, Tags, Users } from "lucide-react";
import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";

const NAV_ITEMS = [
  { href: "/", label: "Сегодня", icon: Home, exact: true },
  { href: "/calendars", label: "Календари", icon: LayoutGrid, exact: false },
  { href: "/timeline", label: "Таймлайн", icon: Clock3, exact: true },
  { href: "/categories", label: "Категории", icon: Tags, exact: true },
  { href: "/family", label: "Моя Семья", icon: Users, exact: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ensureSession, loading, project } = useSessionStore();

  useEffect(() => {
    void ensureSession();
  }, [ensureSession]);

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-[250px_1fr]">
        <aside className="card p-4 md:p-5">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-2xl bg-[var(--panel-soft)] p-2">
              <CalendarDays className="h-5 w-5 text-[var(--accent-ink)]" />
            </div>
            <div>
              <div className="page-title text-2xl leading-none">Family Life</div>
              <p className="text-sm text-[color:rgba(63,58,52,.72)]">{project?.name ?? "Загрузка..."}</p>
            </div>
          </div>
          <nav className="space-y-2">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                    active ? "bg-[var(--panel-soft)] text-[var(--accent-ink)]" : "hover:bg-[var(--panel-soft)]/70"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="card p-4 md:p-6">
          {loading ? <p className="text-sm">Загружаем пространство семьи...</p> : children}
        </main>
      </div>
    </div>
  );
}
