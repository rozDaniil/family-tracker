"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/event-card";
import { useLiveFeed } from "@/hooks/use-live-feed";
import { api } from "@/lib/api";
import { LIVE_DISCONNECT_MESSAGE, normalizeLiveEvent, shouldApplyIncoming, toTimestamp } from "@/lib/live";
import { buildMemberDisplayMap, withMemberDisplayNames } from "@/lib/member-display";
import type { CalendarLens, Category, CircleContact, EventItem, LiveMessage, Member } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

function toDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function eventMemberIds(event: EventItem): string[] {
  if (event.member_ids && event.member_ids.length > 0) return event.member_ids;
  if (event.member_id) return [event.member_id];
  return [];
}

function compareEventsDesc(a: EventItem, b: EventItem): number {
  const byDate = b.date_local.localeCompare(a.date_local);
  if (byDate !== 0) return byDate;
  const byCreated = b.created_at.localeCompare(a.created_at);
  if (byCreated !== 0) return byCreated;
  return b.id.localeCompare(a.id);
}

export default function LensPage() {
  const params = useParams<{ lensId: string }>();
  const router = useRouter();
  const lensId = params.lensId;
  const { token } = useSessionStore();

  const [lens, setLens] = useState<CalendarLens>();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [circle, setCircle] = useState<CircleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const liveResyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedEventTombstonesRef = useRef<Map<string, number>>(new Map());

  const scheduleLiveResync = useCallback(() => {
    if (liveResyncTimerRef.current) return;
    liveResyncTimerRef.current = setTimeout(() => {
      liveResyncTimerRef.current = null;
      setRefreshKey((value) => value + 1);
    }, 250);
  }, []);

  const handleLiveMessage = useCallback(
    (message: LiveMessage) => {
      if (message.type === "system.connected" || message.type === "system.ping") return;

      if (message.type === "calendar.deleted" && message.entityId === lensId) {
        router.replace("/calendars");
        return;
      }

      if (
        message.type === "calendar.updated" ||
        message.type === "calendar.deleted" ||
        message.type === "member.changed" ||
        message.type === "project.updated"
      ) {
        scheduleLiveResync();
        return;
      }

      if (!message.type.startsWith("event.")) return;
      const incomingTs = toTimestamp(message.updatedAt);

      if (message.type === "event.deleted") {
        deletedEventTombstonesRef.current.set(message.entityId, incomingTs);
        setEvents((current) => current.filter((event) => event.id !== message.entityId));
        return;
      }

      const incoming = normalizeLiveEvent(message.payload);
      if (!incoming) {
        scheduleLiveResync();
        return;
      }
      if (incoming.lens_id !== lensId) return;

      if (lens && lens.member_ids.length > 0) {
        const allowedMemberIds = new Set(lens.member_ids);
        const memberPass = eventMemberIds(incoming).some((id) => allowedMemberIds.has(id));
        if (!memberPass) {
          setEvents((current) => current.filter((event) => event.id !== incoming.id));
          return;
        }
      }

      setEvents((current) => {
        const tombstoneTs = deletedEventTombstonesRef.current.get(incoming.id) ?? 0;
        if (incomingTs <= tombstoneTs) return current;

        const existingIndex = current.findIndex((event) => event.id === incoming.id);
        if (existingIndex >= 0 && !shouldApplyIncoming(current[existingIndex]?.updated_at, message.updatedAt)) {
          return current;
        }

        const next = [...current];
        if (existingIndex >= 0) next[existingIndex] = incoming;
        else next.push(incoming);
        next.sort(compareEventsDesc);
        return next;
      });
    },
    [lens, lensId, router, scheduleLiveResync],
  );

  const liveEnabled = Boolean(token && lensId);
  const { connectionState: liveConnectionState } = useLiveFeed({
    enabled: liveEnabled,
    calendarId: lensId,
    onMessage: handleLiveMessage,
    onReconnectResync: scheduleLiveResync,
  });

  useEffect(() => {
    if (!token || !lensId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [lensRes, categoriesRes, membersRes, circleRes] = await Promise.all([
          api.getLens(token, lensId),
          api.getCategories(token),
          api.getMembers(token),
          api.getCircle(token),
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
        setCircle(circleRes);
        setEvents(filteredEvents);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes("Календарь не найден")) {
          router.replace("/calendars");
          return;
        }
        setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, lensId, refreshKey, router]);

  useEffect(() => {
    return () => {
      if (liveResyncTimerRef.current) clearTimeout(liveResyncTimerRef.current);
    };
  }, []);

  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const memberDisplayMap = useMemo(() => buildMemberDisplayMap(members, circle), [members, circle]);
  const viewMembers = useMemo(() => withMemberDisplayNames(members, memberDisplayMap), [members, memberDisplayMap]);
  const memberMap = useMemo(() => new Map(viewMembers.map((item) => [item.id, item])), [viewMembers]);
  const memberByUserId = useMemo(() => new Map(viewMembers.map((item) => [item.user_id, item])), [viewMembers]);
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
        {liveEnabled && liveConnectionState === "disconnected" ? (
          <p className="text-xs text-[color:rgba(63,58,52,.72)]">
            {LIVE_DISCONNECT_MESSAGE}
          </p>
        ) : null}
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
                    authorName={memberByUserId.get(event.created_by)?.display_name}
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
              authorName={memberByUserId.get(event.created_by)?.display_name}
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
