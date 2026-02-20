"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/event-card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { buildMemberDisplayMap, withMemberDisplayNames } from "@/lib/member-display";
import type { CalendarLens, Category, CircleContact, EventItem, Member } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const LENS_COLORS: string[] = ["#C45A3A", "#2E7D9A", "#5E8F3D", "#9D4E9F", "#D18A1E", "#2F9C8C", "#C14F75", "#7A5A3A", "#1F6A8A", "#B54830", "#4B7D2D", "#8A3D8C"];

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthBounds(cursor: Date): { from: string; to: string } {
  return {
    from: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1)),
    to: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)),
  };
}

function buildMonthGrid(cursor: Date): Array<{ date: string; inMonth: boolean }> {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells: Array<{ date: string; inMonth: boolean }> = [];

  for (let i = startOffset; i > 0; i -= 1) {
    cells.push({ date: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1 - i)), inMonth: false });
  }
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    cells.push({ date: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day)), inMonth: true });
  }
  let nextDayOffset = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ date: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), lastDay.getDate() + nextDayOffset)), inMonth: false });
    nextDayOffset += 1;
  }
  return cells;
}

function daysInRange(from: string, to: string): string[] {
  const values: string[] = [];
  const cursor = new Date(fromDateKey(from));
  const end = fromDateKey(to);
  while (cursor <= end) {
    values.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
}

function generateDistinctColors(count: number): string[] {
  if (count <= LENS_COLORS.length) return [...LENS_COLORS.slice(0, count)];
  const result = [...LENS_COLORS];
  for (let i = LENS_COLORS.length; i < count; i += 1) {
    const hue = Math.round((i * 137.508) % 360);
    result.push(`hsl(${hue} 58% 46%)`);
  }
  return result;
}

function compareEventsStable(a: EventItem, b: EventItem): number {
  const byDate = a.date_local.localeCompare(b.date_local);
  if (byDate !== 0) return byDate;
  const byStart = (a.start_at ?? "").localeCompare(b.start_at ?? "");
  if (byStart !== 0) return byStart;
  const byCreated = a.created_at.localeCompare(b.created_at);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

type LensEventGroup = {
  lensId: string;
  lensName: string;
  lensColor: string;
  events: EventItem[];
};

export default function TodayPage() {
  const { token, loading } = useSessionStore();
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [lenses, setLenses] = useState<CalendarLens[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [circle, setCircle] = useState<CircleContact[]>([]);
  const [fetching, setFetching] = useState(true);
  const [hasLoadedMonthData, setHasLoadedMonthData] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cursorMonth, setCursorMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setFetching(true);
      const range = monthBounds(cursorMonth);
      const [eventsRes, categoriesRes, membersRes, lensesRes, circleRes] = await Promise.all([
        api.getEvents(token, range),
        api.getCategories(token),
        api.getMembers(token),
        api.getLenses(token),
        api.getCircle(token),
      ]);
      if (cancelled) return;
      const validLensIds = new Set(lensesRes.map((lens) => lens.id));
      setEvents(eventsRes.filter((event) => Boolean(event.lens_id && validLensIds.has(event.lens_id))));
      setLenses(lensesRes);
      setCategories(categoriesRes.filter((c) => !c.is_archived));
      setMembers(membersRes);
      setCircle(circleRes);
      setHasLoadedMonthData(true);
      setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey, cursorMonth]);

  const categoryMap = useMemo(
    () => new Map(categories.map((item) => [item.id, item])),
    [categories],
  );
  const memberDisplayMap = useMemo(() => buildMemberDisplayMap(members, circle), [members, circle]);
  const viewMembers = useMemo(() => withMemberDisplayNames(members, memberDisplayMap), [members, memberDisplayMap]);
  const memberMap = useMemo(
    () => new Map(viewMembers.map((item) => [item.id, item])),
    [viewMembers],
  );
  const memberByUserId = useMemo(
    () => new Map(viewMembers.map((item) => [item.user_id, item])),
    [viewMembers],
  );
  const monthCells = useMemo(() => buildMonthGrid(cursorMonth), [cursorMonth]);
  const lensMap = useMemo(() => new Map(lenses.map((lens) => [lens.id, lens])), [lenses]);
  const lensColorMap = useMemo(() => {
    const ordered = [...lenses].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const colors = generateDistinctColors(ordered.length);
    return new Map(ordered.map((lens, idx) => [lens.id, colors[idx]]));
  }, [lenses]);
  const monthTitle = cursorMonth.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  const todayKey = toDateKey(new Date());

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, EventItem[]>();
    events.forEach((event) => {
      const start = event.date_local;
      const end = event.end_date_local ?? event.date_local;
      daysInRange(start, end).forEach((day) =>
        grouped.set(day, [...(grouped.get(day) ?? []), event]),
      );
    });
    grouped.forEach((items, day) => {
      grouped.set(day, [...items].sort(compareEventsStable));
    });
    return grouped;
  }, [events]);

  const selectedDateEvents = useMemo(
    () => eventsByDate.get(selectedDate) ?? [],
    [eventsByDate, selectedDate],
  );
  const selectedDateGroups = useMemo(() => {
    const grouped = new Map<string, LensEventGroup>();
    selectedDateEvents.forEach((event) => {
      const lensId = event.lens_id ?? "no-lens";
      const lensName = event.lens_id
        ? (lensMap.get(event.lens_id)?.name ?? "Без календаря")
        : "Без календаря";
      const lensColor = event.lens_id
        ? (lensColorMap.get(event.lens_id) ?? "#B48F68")
        : "#B48F68";
      const current = grouped.get(lensId);
      if (current) {
        current.events.push(event);
        return;
      }
      grouped.set(lensId, { lensId, lensName, lensColor, events: [event] });
    });
    return [...grouped.values()].sort((a, b) => a.lensName.localeCompare(b.lensName, "ru"));
  }, [lensColorMap, lensMap, selectedDateEvents]);

  async function handleStop(eventId: string) {
    if (!token) return;
    await api.stopEvent(token, eventId);
    setRefreshKey((value) => value + 1);
  }

  function openEventInCalendar(event: EventItem) {
    if (!event.lens_id) return;
    const search = new URLSearchParams({
      lensId: event.lens_id,
      date: selectedDate,
      eventId: event.id,
    });
    router.push(`/calendars?${search.toString()}`);
  }

  if (loading) {
    return <p className="text-sm text-[rgba(63,58,52,.75)]">Собираем события дня...</p>;
  }
  if (!hasLoadedMonthData && fetching) {
    return <p className="text-sm text-[rgba(63,58,52,.75)]">Собираем события дня...</p>;
  }

  const isMonthRefreshing = fetching && hasLoadedMonthData;

  return (
    <section className="space-y-4">
      <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-4 transition-opacity duration-200">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="page-title text-3xl text-[var(--accent-ink)]">Главный календарь</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                setCursorMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelectedDate(todayKey);
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-xs"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Сегодня
            </button>
            <button
              type="button"
              onClick={() => setCursorMonth(new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() - 1, 1))}
              disabled={isMonthRefreshing}
              className="cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2 py-1"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="min-w-40 text-center text-sm font-semibold capitalize">{monthTitle}</p>
            <button
              type="button"
              onClick={() => setCursorMonth(new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 1))}
              disabled={isMonthRefreshing}
              className="cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2 py-1"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        {lenses.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {lenses.map((lens) => (
              <button
                key={lens.id}
                type="button"
                onClick={() => router.push(`/calendars?lensId=${lens.id}&date=${selectedDate}`)}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-[11px] hover:border-[var(--accent)] hover:bg-[var(--panel-soft)]"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lensColorMap.get(lens.id) }} />
                {lens.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative min-h-[590px]">
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAY_LABELS.map((label) => (
              <p key={label} className="rounded-lg bg-[var(--panel-soft)] px-2 py-1 text-center text-xs font-semibold uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.72)]">
                {label}
              </p>
            ))}
            {monthCells.map((cell) => {
              const day = fromDateKey(cell.date).getDate();
              const cellEvents = eventsByDate.get(cell.date) ?? [];
              const isSelected = selectedDate === cell.date;
              const isToday = todayKey === cell.date;
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDate(cell.date)}
                  className={`relative min-h-28 cursor-pointer rounded-xl border p-2 text-left ${
                    isSelected
                      ? "border-[var(--accent)] bg-[var(--panel-soft)]"
                      : isToday
                        ? "border-[var(--accent-ink)] bg-[color:rgba(180,143,104,0.16)]"
                        : cell.inMonth
                          ? "border-[var(--line)] bg-white"
                          : "border-[var(--line)] bg-white/50"
                  } hover:border-[var(--accent)] hover:bg-[color:rgba(180,143,104,0.10)]`}
                >
                  <p className="absolute left-1.5 top-1 text-xs font-semibold">{day}</p>
                  <div className="mt-4 space-y-1">
                    {cellEvents.slice(0, 3).map((event) => {
                      const lensColor = event.lens_id ? lensColorMap.get(event.lens_id) ?? "#B48F68" : "#B48F68";
                      return (
                        <p
                          key={`${event.id}-${cell.date}`}
                          className="truncate rounded-md px-1.5 py-0.5 text-[10px] transition hover:brightness-95"
                          style={{
                            backgroundColor: `${lensColor}66`,
                            borderLeft: `4px solid ${lensColor}`,
                          }}
                        >
                          {event.title}
                        </p>
                      );
                    })}
                    {cellEvents.length > 3 ? <p className="text-[10px] text-[color:rgba(63,58,52,.72)]">и еще несколько событий</p> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div
            className={`pointer-events-none absolute inset-0 z-10 rounded-xl bg-[color:rgba(255,255,255,.45)] transition-opacity duration-200 ${isMonthRefreshing ? "opacity-100" : "opacity-0"}`}
          >
            <div className="grid grid-cols-7 gap-2 p-1.5">
              {Array.from({ length: 7 }).map((_, idx) => (
                <Skeleton key={`head-${idx}`} className="h-6 w-full rounded-lg" />
              ))}
              {Array.from({ length: 42 }).map((_, idx) => (
                <Skeleton key={`cell-${idx}`} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative transition-opacity duration-200">
        <h2 className="text-sm font-semibold text-[rgba(63,58,52,.7)]">Все события дня</h2>
        <p className="text-xs text-[color:rgba(63,58,52,.72)]">Дата: {selectedDate}</p>
        {selectedDateEvents.length === 0 ? (
          <EmptyState title="На эту дату пока пусто" />
        ) : (
          <div className="mt-2 space-y-4">
            {selectedDateGroups.map((group) => (
              <section
                key={group.lensId}
                className="rounded-2xl border border-[var(--line)] bg-white/55 p-3"
                style={{ borderLeft: `5px solid ${group.lensColor}`, backgroundColor: `${group.lensColor}14` }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                    style={{ backgroundColor: `${group.lensColor}55` }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.lensColor }} />
                    {group.lensName}
                  </p>
                  <p className="text-[11px] text-[color:rgba(63,58,52,.64)]">
                    {group.events.length} шт.
                  </p>
                </div>
                <div className="space-y-2">
                  {group.events.map((event) => {
                    const memberNames = Array.from(
                      new Set(
                        (event.member_ids && event.member_ids.length > 0
                          ? event.member_ids
                          : event.member_id
                            ? [event.member_id]
                            : []
                        )
                          .map((id) => memberMap.get(id)?.display_name)
                          .filter((name): name is string => Boolean(name)),
                      ),
                    );
                    return (
                      <EventCard
                        key={`${event.id}-${selectedDate}`}
                        event={event}
                        category={categoryMap.get(event.category_id ?? "")}
                        member={event.member_id ? memberMap.get(event.member_id) : undefined}
                        memberNames={memberNames}
                        authorName={memberByUserId.get(event.created_by)?.display_name}
                        onStop={handleStop}
                        onOpen={event.lens_id ? () => openEventInCalendar(event) : undefined}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
        <div
          className={`pointer-events-none absolute inset-0 z-10 rounded-xl bg-[color:rgba(255,255,255,.42)] transition-opacity duration-200 ${isMonthRefreshing ? "opacity-100" : "opacity-0"}`}
        >
          <div className="mt-7 space-y-3 p-1">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={`event-skeleton-${idx}`} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
