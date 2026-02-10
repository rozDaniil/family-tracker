"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/event-card";
import { api } from "@/lib/api";
import type { CalendarLens, Category, EventItem, Member } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  const to = new Date(now);

  if (preset === "day") {
    return { from: toDateString(from), to: toDateString(to) };
  }
  if (preset === "week") {
    from.setDate(now.getDate() - 6);
    return { from: toDateString(from), to: toDateString(to) };
  }
  if (preset === "month") {
    from.setDate(now.getDate() - 30);
    return { from: toDateString(from), to: toDateString(to) };
  }
  from.setDate(now.getDate() - 90);
  return { from: toDateString(from), to: toDateString(to) };
}

function groupByDate(events: EventItem[]): Array<{ date: string; items: EventItem[] }> {
  const grouped = new Map<string, EventItem[]>();
  events.forEach((event) => {
    const start = new Date(event.date_local);
    const end = new Date(event.end_date_local ?? event.date_local);
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = toDateString(cursor);
      const list = grouped.get(key) ?? [];
      list.push(event);
      grouped.set(key, list);
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return [...grouped.entries()]
    .sort((a, b) => (a[0] > b[0] ? -1 : 1))
    .map(([date, items]) => ({ date, items }));
}

export default function LensPage() {
  const params = useParams<{ lensId: string }>();
  const lensId = params.lensId;
  const { token } = useSessionStore();

  const [lens, setLens] = useState<CalendarLens>();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !lensId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [lensRes, categoriesRes, membersRes] = await Promise.all([
        api.getLens(token, lensId),
        api.getCategories(token),
        api.getMembers(token),
      ]);
      if (cancelled) return;
      const range = resolveRange(lensRes.range_preset);
      const eventResults = await api.getEvents(token, { ...range, lens_id: lensRes.id });
      const filteredEvents = eventResults.filter((event) => {
        const eventMembers =
          event.member_ids && event.member_ids.length > 0
            ? event.member_ids
            : event.member_id
              ? [event.member_id]
              : [];
        const memberPass =
          lensRes.member_ids.length === 0 ||
          eventMembers.some((memberId) => lensRes.member_ids.includes(memberId));
        return memberPass;
      });
      if (cancelled) return;
      setLens(lensRes);
      setCategories(categoriesRes.filter((item) => !item.is_archived));
      setMembers(membersRes);
      setEvents(filteredEvents);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, lensId]);

  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const memberMap = useMemo(() => new Map(members.map((item) => [item.id, item])), [members]);
  const grouped = useMemo(() => groupByDate(events), [events]);

  if (loading) {
    return <p className="text-sm text-[color:rgba(63,58,52,.75)]">Открываем календарный экран...</p>;
  }

  if (!lens) {
    return <EmptyState title="Календарь не найден" />;
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="page-title text-4xl text-[var(--accent-ink)]">{lens.name}</h1>
        <p className="text-sm text-[color:rgba(63,58,52,.75)]">
          Режим: {lens.view_type} · Диапазон: {lens.range_preset}
        </p>
      </header>

      {lens.view_type === "month" || lens.view_type === "week" || lens.view_type === "day" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map((bucket) => (
            <section key={bucket.date} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-3">
              <h2 className="page-title text-2xl text-[var(--accent-ink)]">{bucket.date}</h2>
              <div className="mt-2 space-y-2">
                {bucket.items.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    category={categoryMap.get(event.category_id ?? "")}
                    member={event.member_id ? memberMap.get(event.member_id) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {lens.view_type === "timeline" ? (
        <div className="space-y-3">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              category={categoryMap.get(event.category_id ?? "")}
              member={event.member_id ? memberMap.get(event.member_id) : undefined}
            />
          ))}
        </div>
      ) : null}

      {lens.view_type === "list" ? (
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm">
              <p className="font-semibold">{event.title}</p>
              <p className="text-xs text-[color:rgba(63,58,52,.68)]">
                {event.date_local}
                {event.end_date_local && event.end_date_local !== event.date_local ? ` -> ${event.end_date_local}` : ""}
                {" · "}
                {categoryMap.get(event.category_id ?? "")?.name ?? "Без категории"}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {events.length === 0 ? <EmptyState title="Для этой линзы пока нет событий" /> : null}
    </section>
  );
}
