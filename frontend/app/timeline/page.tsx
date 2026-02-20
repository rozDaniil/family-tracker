"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/event-card";
import { useLiveFeed } from "@/hooks/use-live-feed";
import { api } from "@/lib/api";
import { LIVE_DISCONNECT_MESSAGE, normalizeLiveEvent, shouldApplyIncoming, toTimestamp } from "@/lib/live";
import { buildMemberDisplayMap, duplicateDisplayIds, withMemberDisplayNames } from "@/lib/member-display";
import type { Category, CircleContact, EventItem, LiveMessage, Member } from "@/lib/types";
import { useFiltersStore } from "@/stores/filters-store";
import { useSessionStore } from "@/stores/session-store";

function dateOffset(days: number) {
  const target = new Date();
  target.setDate(target.getDate() + days);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventMemberIds(event: EventItem): string[] {
  if (event.member_ids && event.member_ids.length > 0) return event.member_ids;
  if (event.member_id) return [event.member_id];
  return [];
}

function compareTimelineEvents(a: EventItem, b: EventItem): number {
  const byDate = b.date_local.localeCompare(a.date_local);
  if (byDate !== 0) return byDate;
  const byCreated = b.created_at.localeCompare(a.created_at);
  if (byCreated !== 0) return byCreated;
  return b.id.localeCompare(a.id);
}

export default function TimelinePage() {
  const { token, userId } = useSessionStore();
  const { categoryId, memberId, setCategoryId, setMemberId } = useFiltersStore();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [circle, setCircle] = useState<CircleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const liveResyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedEventTombstonesRef = useRef<Map<string, number>>(new Map());
  const timelineFrom = dateOffset(-90);
  const timelineTo = dateOffset(0);

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

      const inRange =
        (incoming.end_date_local ?? incoming.date_local) >= timelineFrom &&
        incoming.date_local <= timelineTo;
      const categoryPass = !categoryId || incoming.category_id === categoryId;
      const memberPass = !memberId || eventMemberIds(incoming).includes(memberId);
      if (!(inRange && categoryPass && memberPass)) {
        setEvents((current) => current.filter((event) => event.id !== incoming.id));
        return;
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
        next.sort(compareTimelineEvents);
        return next;
      });
    },
    [categoryId, memberId, scheduleLiveResync, timelineFrom, timelineTo],
  );

  const { connectionState: liveConnectionState } = useLiveFeed({
    enabled: Boolean(token),
    onMessage: handleLiveMessage,
    onReconnectResync: scheduleLiveResync,
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [eventsRes, categoriesRes, membersRes, circleRes] = await Promise.all([
          api.getEvents(token, {
            from: timelineFrom,
            to: timelineTo,
            category_id: categoryId,
            member_id: memberId,
          }),
          api.getCategories(token),
          api.getMembers(token),
          api.getCircle(token),
        ]);
        if (cancelled) return;
        setEvents(eventsRes);
        setCategories(categoriesRes.filter((c) => !c.is_archived));
        setMembers(membersRes);
        setCircle(circleRes);
      } catch {
        if (cancelled) return;
        setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, categoryId, memberId, timelineFrom, timelineTo, refreshKey]);

  useEffect(() => {
    return () => {
      if (liveResyncTimerRef.current) clearTimeout(liveResyncTimerRef.current);
    };
  }, []);

  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const memberDisplayMap = useMemo(() => buildMemberDisplayMap(members, circle), [members, circle]);
  const viewMembers = useMemo(() => withMemberDisplayNames(members, memberDisplayMap), [members, memberDisplayMap]);
  const duplicatedMemberIds = useMemo(() => duplicateDisplayIds(members, memberDisplayMap), [members, memberDisplayMap]);
  const memberMap = useMemo(() => new Map(viewMembers.map((item) => [item.id, item])), [viewMembers]);
  const memberByUserId = useMemo(() => new Map(viewMembers.map((item) => [item.user_id, item])), [viewMembers]);

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
        {Boolean(token) && liveConnectionState === "disconnected" ? (
          <p className="text-xs text-[color:rgba(63,58,52,.72)]">
            {LIVE_DISCONNECT_MESSAGE}
          </p>
        ) : null}
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
          {viewMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {duplicatedMemberIds.has(member.id)
                ? `${member.display_name} (Имя в системе: ${memberDisplayMap.get(member.id)?.systemDisplayName ?? member.display_name})`
                : member.display_name}
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
              <EventCard
                event={event}
                category={categoryMap.get(event.category_id ?? "")}
                member={event.member_id ? memberMap.get(event.member_id) : undefined}
                authorName={memberByUserId.get(event.created_by)?.display_name}
              />
              {userId === event.created_by ? (
                <button type="button" onClick={() => setDeleteEventId(event.id)} className="rounded-lg bg-white px-3 py-1 text-xs text-[color:#8B3A2E]">
                  Удалить событие
                </button>
              ) : null}
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
