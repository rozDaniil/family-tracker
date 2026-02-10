"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/event-card";
import { api } from "@/lib/api";
import type { CalendarLens, Category, EventItem, Member } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const LENS_COLORS = ["#C45A3A", "#2E7D9A", "#5E8F3D", "#9D4E9F", "#D18A1E", "#2F9C8C", "#C14F75", "#7A5A3A"] as const;

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

function colorByLensId(lensId: string): string {
  let hash = 0;
  for (let i = 0; i < lensId.length; i += 1) {
    hash = (hash * 31 + lensId.charCodeAt(i)) >>> 0;
  }
  return LENS_COLORS[hash % LENS_COLORS.length];
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

export default function TodayPage() {
  const { token, loading } = useSessionStore();
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [lenses, setLenses] = useState<CalendarLens[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [fetching, setFetching] = useState(true);
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
      const [eventsRes, categoriesRes, membersRes, lensesRes] = await Promise.all([
        api.getEvents(token, range),
        api.getCategories(token),
        api.getMembers(token),
        api.getLenses(token),
      ]);
      if (cancelled) return;
      const validLensIds = new Set(lensesRes.map((lens) => lens.id));
      setEvents(eventsRes.filter((event) => Boolean(event.lens_id && validLensIds.has(event.lens_id))));
      setLenses(lensesRes);
      setCategories(categoriesRes.filter((c) => !c.is_archived));
      setMembers(membersRes);
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
  const memberMap = useMemo(
    () => new Map(members.map((item) => [item.id, item])),
    [members],
  );
  const monthCells = useMemo(() => buildMonthGrid(cursorMonth), [cursorMonth]);
  const lensMap = useMemo(() => new Map(lenses.map((lens) => [lens.id, lens])), [lenses]);
  const lensColorMap = useMemo(
    () => new Map(lenses.map((lens) => [lens.id, colorByLensId(lens.id)])),
    [lenses],
  );
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

  if (loading || fetching) {
    return <p className="text-sm text-[rgba(63,58,52,.75)]">Собираем события дня...</p>;
  }

  return (
    <section className="space-y-4">
      <section className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
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
              className="cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2 py-1"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="min-w-40 text-center text-sm font-semibold capitalize">{monthTitle}</p>
            <button
              type="button"
              onClick={() => setCursorMonth(new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + 1, 1))}
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
                  {cellEvents.length > 3 ? <p className="text-[10px] text-[color:rgba(63,58,52,.72)]">+{cellEvents.length - 3}</p> : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[rgba(63,58,52,.7)]">Все события дня</h2>
        <p className="text-xs text-[color:rgba(63,58,52,.72)]">Дата: {selectedDate}</p>
        {selectedDateEvents.length === 0 ? (
          <EmptyState title="На эту дату пока пусто" />
        ) : (
          <div className="mt-2 space-y-3">
            {selectedDateEvents.map((event) => {
              const lensColor = event.lens_id ? lensColorMap.get(event.lens_id) ?? "#B48F68" : "#B48F68";
              const lensName = event.lens_id ? lensMap.get(event.lens_id)?.name : undefined;
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
                <div
                  key={`${event.id}-${selectedDate}`}
                  className="rounded-2xl border border-[var(--line)] bg-white/50 p-2"
                  style={{ borderLeft: `5px solid ${lensColor}`, backgroundColor: `${lensColor}1A` }}
                >
                  {lensName ? (
                    <p className="mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: `${lensColor}55` }}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: lensColor }} />
                      {lensName}
                    </p>
                  ) : null}
                  <EventCard
                    event={event}
                    category={categoryMap.get(event.category_id ?? "")}
                    member={event.member_id ? memberMap.get(event.member_id) : undefined}
                    memberNames={memberNames}
                    onStop={handleStop}
                    onOpen={event.lens_id ? () => openEventInCalendar(event) : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
