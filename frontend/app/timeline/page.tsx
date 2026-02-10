"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/event-card";
import { api } from "@/lib/api";
import type { Category, EventItem, Member } from "@/lib/types";
import { useFiltersStore } from "@/stores/filters-store";
import { useSessionStore } from "@/stores/session-store";

function dateOffset(days: number) {
  const target = new Date();
  target.setDate(target.getDate() + days);
  return target.toISOString().slice(0, 10);
}

export default function TimelinePage() {
  const { token } = useSessionStore();
  const { categoryId, memberId, setCategoryId, setMemberId } = useFiltersStore();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [eventsRes, categoriesRes, membersRes] = await Promise.all([
        api.getEvents(token, {
          from: dateOffset(-90),
          to: dateOffset(0),
          category_id: categoryId,
          member_id: memberId,
        }),
        api.getCategories(token),
        api.getMembers(token),
      ]);
      if (cancelled) return;
      setEvents(eventsRes);
      setCategories(categoriesRes.filter((c) => !c.is_archived));
      setMembers(membersRes);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, categoryId, memberId, refreshKey]);

  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const memberMap = useMemo(() => new Map(members.map((item) => [item.id, item])), [members]);

  async function confirmDeleteEvent() {
    if (!token || !deleteEventId) return;
    setDeleting(true);
    try {
      await api.deleteEvent(token, deleteEventId);
      setDeleteEventId(null);
      setRefreshKey((value) => value + 1);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[color:rgba(63,58,52,.75)]">Строим таймлайн...</p>;
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="page-title text-4xl text-[var(--accent-ink)]">Таймлайн</h1>
        <p className="text-sm text-[color:rgba(63,58,52,.75)]">Последние 90 дней как единая история событий.</p>
      </header>

      <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[color:rgba(239,230,216,0.65)] p-3 md:grid-cols-2">
        <select
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value || undefined)}
          className="rounded-xl border border-[var(--line)] bg-white/80 px-3 py-2 text-sm outline-none"
        >
          <option value="">Все категории</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          value={memberId ?? ""}
          onChange={(e) => setMemberId(e.target.value || undefined)}
          className="rounded-xl border border-[var(--line)] bg-white/80 px-3 py-2 text-sm outline-none"
        >
          <option value="">Все участники</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name}
            </option>
          ))}
        </select>
      </div>

      {events.length === 0 ? (
        <EmptyState title="Здесь пока пусто для этого просмотра" />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <article key={event.id} className="space-y-2">
              <EventCard event={event} category={categoryMap.get(event.category_id ?? "")} member={event.member_id ? memberMap.get(event.member_id) : undefined} />
              <button type="button" onClick={() => setDeleteEventId(event.id)} className="rounded-lg bg-white px-3 py-1 text-xs text-[color:#8B3A2E]">
                Удалить событие
              </button>
            </article>
          ))}
        </div>
      )}

      {deleteEventId ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setDeleteEventId(null)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4" onClick={(event) => event.stopPropagation()}>
            <h3 className="page-title text-2xl text-[var(--accent-ink)]">Удалить событие?</h3>
            <p className="mt-2 text-sm text-[color:rgba(63,58,52,.75)]">
              Событие исчезнет из таймлайна. Если передумали, просто закройте это окно.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteEventId(null)} className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm">
                Отмена
              </button>
              <button type="button" onClick={() => void confirmDeleteEvent()} disabled={deleting} className="rounded-xl bg-[color:#8B3A2E] px-4 py-2 text-sm text-white disabled:opacity-70">
                {deleting ? "Удаляем..." : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
