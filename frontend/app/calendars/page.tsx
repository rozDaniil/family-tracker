"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DatePicker } from "@/components/ui/date-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { api } from "@/lib/api";
import type { CalendarLens, Category, EventItem, Member } from "@/lib/types";
import { useSessionStore } from "@/stores/session-store";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const noteSchema = z
  .object({
    mode: z.enum(["day", "range"]),
    title: z.string().trim().min(2, "Введите минимум 2 символа"),
    description: z.string().optional(),
    member_ids: z.array(z.string()),
    date: z.string().min(1, "Выберите дату"),
    end_date: z.string().optional(),
  })
  .refine((v) => (v.mode === "day" ? true : Boolean(v.end_date)), {
    message: "Для диапазона выберите дату окончания",
    path: ["end_date"],
  })
  .refine(
    (v) => (v.mode === "day" || !v.end_date ? true : v.end_date >= v.date),
    {
      message: "Дата окончания не может быть раньше даты начала",
      path: ["end_date"],
    },
  );

type NoteFormValues = z.infer<typeof noteSchema>;
type EditState = {
  id: string;
  mode: "day" | "range";
  title: string;
  description: string;
  memberIds: string[];
  date: string;
  endDate: string;
} | null;

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

function buildMonthGrid(
  cursor: Date,
): Array<{ date: string; inMonth: boolean }> {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = startOffset; i > 0; i -= 1)
    cells.push({
      date: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1 - i)),
      inMonth: false,
    });
  for (let day = 1; day <= lastDay.getDate(); day += 1)
    cells.push({
      date: toDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day)),
      inMonth: true,
    });
  let nextDayOffset = 1;
  while (cells.length % 7 !== 0) {
    cells.push({
      date: toDateKey(
        new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          lastDay.getDate() + nextDayOffset,
        ),
      ),
      inMonth: false,
    });
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

function markerType(
  event: EventItem,
  day: string,
): "single" | "start" | "middle" | "end" {
  const start = event.date_local;
  const end = event.end_date_local ?? event.date_local;
  if (start === end) return "single";
  if (day === start) return "start";
  if (day === end) return "end";
  return "middle";
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

function toggleId(ids: string[], value: string) {
  return ids.includes(value)
    ? ids.filter((item) => item !== value)
    : [...ids, value];
}

export default function CalendarsPage() {
  const { token } = useSessionStore();
  const searchParams = useSearchParams();
  const appliedSearchKeyRef = useRef<string | null>(null);
  const [lenses, setLenses] = useState<CalendarLens[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedLensId, setSelectedLensId] = useState("");
  const [cursorMonth, setCursorMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [renameLensModalId, setRenameLensModalId] = useState<string | null>(
    null,
  );
  const [deleteLensModalId, setDeleteLensModalId] = useState<string | null>(
    null,
  );
  const [creatingLens, setCreatingLens] = useState(false);
  const [renamingLens, setRenamingLens] = useState(false);
  const [deletingLensId, setDeletingLensId] = useState<string | null>(null);
  const [lensDeleteError, setLensDeleteError] = useState<string | null>(null);
  const [lensName, setLensName] = useState("");
  const [renameLensName, setRenameLensName] = useState("");
  const [lensMemberIds, setLensMemberIds] = useState<string[]>([]);

  const [deleteEventModalId, setDeleteEventModalId] = useState<string | null>(
    null,
  );
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);

  const {
    register,
    watch,
    setValue,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: {
      mode: "day",
      title: "",
      description: "",
      member_ids: [],
      date: selectedDate,
      end_date: "",
    },
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [lensRes, categoriesRes, membersRes] = await Promise.all([
        api.getLenses(token),
        api.getCategories(token),
        api.getMembers(token),
      ]);
      if (cancelled) return;
      const activeCategories = categoriesRes.filter(
        (item) => !item.is_archived,
      );
      setLenses(lensRes);
      setCategories(activeCategories);
      setMembers(membersRes);
      if (lensRes[0])
        setSelectedLensId(
          (lensRes.find((item) => item.is_default) ?? lensRes[0]).id,
        );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, setValue]);

  const selectedLens = useMemo(
    () => lenses.find((item) => item.id === selectedLensId),
    [lenses, selectedLensId],
  );

  useEffect(() => {
    if (lenses.length === 0) return;
    const searchKey = searchParams.toString();
    if (!searchKey || appliedSearchKeyRef.current === searchKey) return;

    const lensIdParam = searchParams.get("lensId");
    const dateParam = searchParams.get("date");
    const eventIdParam = searchParams.get("eventId");

    if (lensIdParam && lenses.some((item) => item.id === lensIdParam)) {
      setSelectedLensId(lensIdParam);
    }

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setSelectedDate(dateParam);
      const parsed = fromDateKey(dateParam);
      setCursorMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    }

    if (eventIdParam) {
      setFocusedEventId(eventIdParam);
    }
    appliedSearchKeyRef.current = searchKey;
  }, [lenses, searchParams]);

  useEffect(() => {
    if (!token || !selectedLens) return;
    let cancelled = false;
    (async () => {
      setLoadingEvents(true);
      const range = monthBounds(cursorMonth);
      const fetched = await api.getEvents(token, {
        ...range,
        lens_id: selectedLens.id,
      });
      if (cancelled) return;
      const filtered = fetched.filter((event) => {
        const eventMembers = event.member_ids?.length
          ? event.member_ids
          : event.member_id
            ? [event.member_id]
            : [];
        const memberPass =
          selectedLens.member_ids.length === 0 ||
          eventMembers.some((id) => selectedLens.member_ids.includes(id));
        return memberPass;
      });
      setEvents(filtered);
      setLoadingEvents(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selectedLens, cursorMonth, refreshKey]);

  useEffect(() => {
    setValue("date", selectedDate, { shouldValidate: true });
  }, [selectedDate, setValue]);

  useEffect(() => {
    const isOpen =
      createModalOpen ||
      Boolean(renameLensModalId) ||
      Boolean(deleteLensModalId) ||
      Boolean(deleteEventModalId) ||
      Boolean(editing);
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCreateModalOpen(false);
        setRenameLensModalId(null);
        setDeleteLensModalId(null);
        setDeleteEventModalId(null);
        setEditing(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    createModalOpen,
    renameLensModalId,
    deleteLensModalId,
    deleteEventModalId,
    editing,
  ]);

  const categoryMap = useMemo(
    () => new Map(categories.map((item) => [item.id, item])),
    [categories],
  );
  const memberMap = useMemo(
    () => new Map(members.map((item) => [item.id, item])),
    [members],
  );
  const availableMembers = useMemo(() => {
    if (!selectedLens || selectedLens.member_ids.length === 0) return members;
    const allowed = new Set(selectedLens.member_ids);
    return members.filter((member) => allowed.has(member.id));
  }, [members, selectedLens]);
  const availableMemberIds = useMemo(
    () => new Set(availableMembers.map((member) => member.id)),
    [availableMembers],
  );
  const monthCells = useMemo(() => buildMonthGrid(cursorMonth), [cursorMonth]);
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
  async function createLens(event: FormEvent) {
    event.preventDefault();
    if (!token || !lensName.trim()) return;
    setCreatingLens(true);
    try {
      const created = await api.createLens(token, {
        name: lensName.trim(),
        view_type: "month",
        range_preset: "month",
        category_ids: [],
        member_ids: lensMemberIds,
        sort_order: "recent",
        density: "comfortable",
        is_default: lenses.length === 0,
      });
      setLenses((current) => [...current, created]);
      setSelectedLensId(created.id);
      setCreateModalOpen(false);
      setLensName("");
      setLensMemberIds([]);
    } finally {
      setCreatingLens(false);
    }
  }

  async function confirmDeleteLens() {
    if (!token || !deleteLensModalId) return;
    setLensDeleteError(null);
    setDeletingLensId(deleteLensModalId);
    try {
      await api.deleteLens(token, deleteLensModalId);
      const next = lenses.filter((item) => item.id !== deleteLensModalId);
      setLenses(next);
      setDeleteLensModalId(null);
      if (selectedLensId === deleteLensModalId)
        setSelectedLensId(
          (next.find((item) => item.is_default) ?? next[0])?.id ?? "",
        );
      setRefreshKey((value) => value + 1);
    } catch {
      setLensDeleteError("Не удалось удалить календарь. Попробуйте еще раз.");
    } finally {
      setDeletingLensId(null);
    }
  }

  async function confirmDeleteEvent() {
    if (!token || !deleteEventModalId) return;
    setDeletingEventId(deleteEventModalId);
    try {
      await api.deleteEvent(token, deleteEventModalId);
      setDeleteEventModalId(null);
      setRefreshKey((value) => value + 1);
    } finally {
      setDeletingEventId(null);
    }
  }

  async function submitNote(values: NoteFormValues) {
    if (!token || !selectedLens) return;
    setCreatingEvent(true);
    try {
      const endDate =
        values.mode === "range"
          ? (values.end_date ?? values.date)
          : values.date;
      const scopedMemberIds = values.member_ids.filter((id) =>
        availableMemberIds.has(id),
      );
      await api.createEvent(token, {
        title: values.title.trim(),
        description: values.description?.trim() || undefined,
        category_id: null,
        lens_id: selectedLens.id,
        member_ids: scopedMemberIds,
        kind: values.mode === "range" ? "RANGE" : "NOTE",
        date_local: values.date,
        end_date_local: endDate,
      });
      reset({
        mode: "day",
        title: "",
        description: "",
        member_ids: [],
        date: selectedDate,
        end_date: "",
      });
      setRefreshKey((value) => value + 1);
    } finally {
      setCreatingEvent(false);
    }
  }

  function openEdit(event: EventItem) {
    const eventMemberIds = event.member_ids?.length
      ? event.member_ids
      : event.member_id
        ? [event.member_id]
        : [];
    setEditing({
      id: event.id,
      mode:
        (event.end_date_local ?? event.date_local) === event.date_local
          ? "day"
          : "range",
      title: event.title,
      description: event.description ?? "",
      memberIds: eventMemberIds.filter((id) => availableMemberIds.has(id)),
      date: event.date_local,
      endDate: event.end_date_local ?? event.date_local,
    });
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!token || !editing || !selectedLens) return;
    setSavingEdit(true);
    try {
      const endDate =
        editing.mode === "range" ? editing.endDate || editing.date : editing.date;
      const scopedMemberIds = editing.memberIds.filter((id) =>
        availableMemberIds.has(id),
      );
      await api.patchEvent(token, editing.id, {
        title: editing.title.trim(),
        description: editing.description.trim() || undefined,
        category_id: null,
        lens_id: selectedLens.id,
        member_ids: scopedMemberIds,
        member_id: scopedMemberIds[0] ?? null,
        kind: editing.mode === "range" ? "RANGE" : "NOTE",
        date_local: editing.date,
        end_date_local: endDate,
      });
      setEditing(null);
      setRefreshKey((value) => value + 1);
    } finally {
      setSavingEdit(false);
    }
  }

  function openRenameLens(lens: CalendarLens) {
    setRenameLensModalId(lens.id);
    setRenameLensName(lens.name);
  }

  async function saveLensName(event: FormEvent) {
    event.preventDefault();
    if (!token || !renameLensModalId || !renameLensName.trim()) return;
    setRenamingLens(true);
    try {
      const updated = await api.patchLens(token, renameLensModalId, {
        name: renameLensName.trim(),
      });
      setLenses((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRenameLensModalId(null);
      setRenameLensName("");
    } finally {
      setRenamingLens(false);
    }
  }

  const noteMode = watch("mode");
  const watchedMemberIds = watch("member_ids");
  const watchedDate = watch("date");
  const watchedEndDate = watch("end_date");
  const selectedMemberIds = useMemo(
    () => watchedMemberIds ?? [],
    [watchedMemberIds],
  );

  useEffect(() => {
    const scoped = selectedMemberIds.filter((id) => availableMemberIds.has(id));
    if (scoped.length !== selectedMemberIds.length) {
      setValue("member_ids", scoped, { shouldValidate: true });
    }
  }, [availableMemberIds, selectedMemberIds, setValue]);

  if (loading)
    return (
      <p className="text-sm text-[color:rgba(63,58,52,.75)]">
        Загружаем календари...
      </p>
    );

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title text-4xl text-[var(--accent-ink)]">
            Календари
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setCreateModalOpen(true)}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white"
        >
          <Plus className="h-4 w-4" />
          Новый календарь
        </button>
      </header>

      {lenses.length === 0 ? (
        <EmptyState title="Пока нет календарей. Нажмите «Новый календарь», чтобы создать первый." />
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {lenses.map((lens) => (
              <article
                key={lens.id}
                className={`no-hover relative rounded-2xl border p-4 ${lens.id === selectedLensId ? "border-[var(--accent)] bg-[var(--panel-soft)]" : "border-[var(--line)] bg-white/75"}`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedLensId(lens.id)}
                  className="no-hover w-full cursor-pointer pr-14 text-left"
                >
                  <p className="text-base font-semibold">{lens.name}</p>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRenameLens(lens);
                  }}
                  disabled={renamingLens}
                  aria-label="Переименовать календарь"
                  className="absolute right-10 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteLensModalId(lens.id);
                  }}
                  disabled={deletingLensId === lens.id}
                  aria-label="Удалить календарь"
                  className="absolute right-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </article>
            ))}
          </section>

          {selectedLens ? (
            <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
              <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="page-title text-3xl text-[var(--accent-ink)]">
                    {selectedLens.name}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const today = new Date();
                        setCursorMonth(
                          new Date(today.getFullYear(), today.getMonth(), 1),
                        );
                        setSelectedDate(todayKey);
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-2 py-1 text-xs"
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      Сегодня
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCursorMonth(
                          new Date(
                            cursorMonth.getFullYear(),
                            cursorMonth.getMonth() - 1,
                            1,
                          ),
                        )
                      }
                      className="cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2 py-1"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <p className="min-w-40 text-center text-sm font-semibold capitalize">
                      {monthTitle}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setCursorMonth(
                          new Date(
                            cursorMonth.getFullYear(),
                            cursorMonth.getMonth() + 1,
                            1,
                          ),
                        )
                      }
                      className="cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2 py-1"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--line)] bg-white/75">
                  <div className="grid grid-cols-7">
                    {WEEKDAY_LABELS.map((label) => (
                      <p
                        key={label}
                        className="border-b border-[var(--line)] px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.68)]"
                      >
                        {label}
                      </p>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {monthCells.map((cell, index) => {
                      const day = fromDateKey(cell.date).getDate();
                      const cellEvents = eventsByDate.get(cell.date) ?? [];
                      const isSelected = selectedDate === cell.date;
                      const isToday = todayKey === cell.date;
                      const isLastColumn = index % 7 === 6;
                      const isLastRow = index >= monthCells.length - 7;
                      return (
                        <button
                          key={cell.date}
                          type="button"
                          onClick={() => setSelectedDate(cell.date)}
                          className={`relative min-h-32 cursor-pointer border-l border-t border-[var(--line)] px-2 py-1.5 text-left transition ${
                            isLastColumn ? "border-r" : ""
                          } ${isLastRow ? "border-b" : ""} ${
                            isSelected
                              ? "bg-[color:rgba(180,143,104,0.18)]"
                              : isToday
                                ? "bg-[color:rgba(180,143,104,0.10)]"
                                : cell.inMonth
                                  ? "bg-white"
                                  : "bg-white/55 text-[color:rgba(63,58,52,.6)]"
                          } hover:bg-[color:rgba(180,143,104,0.08)]`}
                        >
                          <p className="absolute left-1.5 top-1 text-xs">{day}</p>
                          <div className="mt-4 space-y-0.5">
                            {cellEvents.slice(0, 3).map((event) => {
                              const color =
                                categoryMap.get(event.category_id ?? "")
                                  ?.color ?? "#B48F68";
                              const marker = markerType(event, cell.date);
                              const markerOpacity =
                                marker === "middle" ? "0.5" : "0.8";
                              return (
                                <p
                                  key={`${event.id}-${cell.date}`}
                                  className="truncate pl-2 text-[10px] leading-4 text-[color:rgba(63,58,52,.84)]"
                                  style={{
                                    borderLeft: `2px solid ${color}${Math.round(Number(markerOpacity) * 255)
                                      .toString(16)
                                      .padStart(2, "0")}`,
                                  }}
                                >
                                  {event.title}
                                </p>
                              );
                            })}
                          {cellEvents.length > 3 ? (
                            <p className="text-[10px] text-[color:rgba(63,58,52,.72)]">
                              и еще несколько событий
                            </p>
                          ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <aside className="space-y-3 rounded-2xl border border-[var(--line)] bg-[color:rgba(239,230,216,0.65)] p-4">
                <div>
                  <h3 className="text-base font-semibold">События на дату</h3>
                  <p className="text-xs text-[color:rgba(63,58,52,.72)]">
                    Дата: {selectedDate}
                  </p>
                </div>

                <form
                  onSubmit={handleSubmit(submitNote)}
                  className="space-y-2 rounded-xl border border-[var(--line)] bg-white/70 p-3"
                >
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setValue("mode", "day")}
                      className={`rounded-lg px-3 py-1 text-xs ${noteMode === "day" ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                    >
                      Один день
                    </button>
                    <button
                      type="button"
                      onClick={() => setValue("mode", "range")}
                      className={`rounded-lg px-3 py-1 text-xs ${noteMode === "range" ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                    >
                      Несколько дней
                    </button>
                  </div>
                  <input
                    {...register("title")}
                    placeholder="Что произошло"
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
                  />
                  {errors.title ? (
                    <p className="text-xs text-[color:#8B5D55]">
                      {errors.title.message}
                    </p>
                  ) : null}
                  <textarea
                    {...register("description")}
                    placeholder="Если важно, добавьте детали"
                    rows={2}
                    className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
                  />
                  <input type="hidden" {...register("date")} />
                  <input type="hidden" {...register("end_date")} />
                  {noteMode === "day" ? (
                    <DatePicker
                      value={watchedDate}
                      onChange={(value) =>
                        setValue("date", value, { shouldValidate: true })
                      }
                      placeholder="Дата события"
                    />
                  ) : (
                    <DateRangePicker
                      from={watchedDate}
                      to={watchedEndDate}
                      onChange={({ from, to }) => {
                        setValue("date", from, { shouldValidate: true });
                        setValue("end_date", to, { shouldValidate: true });
                      }}
                      placeholder="Диапазон события"
                    />
                  )}
                  {errors.end_date ? (
                    <p className="text-xs text-[color:#8B5D55]">
                      {errors.end_date.message}
                    </p>
                  ) : null}
                  <div className="rounded-xl border border-[var(--line)] bg-white p-2">
                    <p className="text-xs text-[color:rgba(63,58,52,.68)]">
                      Участники
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {availableMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() =>
                            setValue(
                              "member_ids",
                              toggleId(selectedMemberIds, member.id),
                              { shouldValidate: true },
                            )
                          }
                          className={`rounded-lg px-2 py-1 text-xs ${selectedMemberIds.includes(member.id) ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                        >
                          {member.display_name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={creatingEvent}
                    className="w-full rounded-xl bg-[color:rgba(180,143,104,0.85)] px-4 py-2 text-sm text-white disabled:opacity-60"
                  >
                    {creatingEvent ? "Сохраняем..." : "Сохранить факт"}
                  </button>
                </form>

                <div className="space-y-2">
                  {loadingEvents ? (
                    <p className="text-sm text-[color:rgba(63,58,52,.72)]">
                      Загружаем события...
                    </p>
                  ) : selectedDateEvents.length === 0 ? (
                    <EmptyState title="На эту дату пока пусто" />
                  ) : (
                    <div
                      className={`space-y-2 ${selectedDateEvents.length >= 3 ? "max-h-[420px] overflow-y-auto pr-1" : ""}`}
                    >
                      {selectedDateEvents.map((event) => {
                        const color =
                          categoryMap.get(event.category_id ?? "")?.color ??
                          "#B48F68";
                        const membersText = (
                          event.member_ids?.length
                            ? event.member_ids
                            : event.member_id
                              ? [event.member_id]
                              : []
                        )
                          .map((id) => memberMap.get(id)?.display_name)
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <article
                            key={`${event.id}-${selectedDate}`}
                            className={`rounded-xl border p-3 text-sm ${focusedEventId === event.id ? "border-[var(--accent)] bg-[var(--panel-soft)]" : "border-[var(--line)]"}`}
                            style={{
                              backgroundColor: `${color}22`,
                              borderLeft: `4px solid ${color}`,
                            }}
                          >
                            <p className="font-semibold">{event.title}</p>
                            <p className="mt-1 text-xs text-[color:rgba(63,58,52,.68)]">
                              {event.date_local}
                              {event.end_date_local &&
                              event.end_date_local !== event.date_local
                                ? ` -> ${event.end_date_local}`
                                : ""}
                            </p>
                            {event.description ? (
                              <p className="mt-1 text-xs text-[color:rgba(63,58,52,.75)]">
                                {event.description}
                              </p>
                            ) : null}
                            {membersText ? (
                              <p className="mt-1 text-xs text-[color:rgba(63,58,52,.72)]">
                                Участники: {membersText}
                              </p>
                            ) : null}
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(event)}
                                className="rounded-lg bg-white px-2 py-1 text-xs"
                              >
                                Редактировать
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteEventModalId(event.id)}
                                className="rounded-lg bg-white px-2 py-1 text-xs text-[color:#8B3A2E]"
                              >
                                Удалить
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            </section>
          ) : null}
        </>
      )}

      {createModalOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setCreateModalOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <h2 className="page-title text-3xl text-[var(--accent-ink)]">
                Новый календарь
              </h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                aria-label="Закрыть"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={createLens} className="space-y-3">
              <input
                value={lensName}
                onChange={(event) => setLensName(event.target.value)}
                placeholder="Название календаря"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
              />
              <div className="grid gap-3">
                <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                  <p className="text-xs uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.68)]">
                    Участники
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {members.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          setLensMemberIds((value) => toggleId(value, item.id))
                        }
                        className={`rounded-lg px-2 py-1 text-xs ${lensMemberIds.includes(item.id) ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                      >
                        {item.display_name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="submit"
                disabled={creatingLens || !lensName.trim()}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-60"
              >
                {creatingLens ? "Создаём..." : "Создать календарь"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {deleteLensModalId ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDeleteLensModalId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="page-title text-2xl text-[var(--accent-ink)]">
              Удалить календарь?
            </h3>
            <p className="mt-2 text-sm text-[color:rgba(63,58,52,.75)]">
              События остаются в общей базе и не удаляются.
            </p>
            {lensDeleteError ? (
              <p className="mt-2 text-xs text-[color:#8B5D55]">
                {lensDeleteError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteLensModalId(null)}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteLens()}
                disabled={deletingLensId === deleteLensModalId}
                className="rounded-xl bg-[color:#8B3A2E] px-4 py-2 text-sm text-white disabled:opacity-70"
              >
                {deletingLensId === deleteLensModalId
                  ? "Удаляем..."
                  : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renameLensModalId ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setRenameLensModalId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="page-title text-2xl text-[var(--accent-ink)]">
              Переименовать календарь
            </h3>
            <form onSubmit={saveLensName} className="mt-3 space-y-3">
              <input
                value={renameLensName}
                onChange={(event) => setRenameLensName(event.target.value)}
                placeholder="Новое название"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameLensModalId(null)}
                  className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={renamingLens || !renameLensName.trim()}
                  className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-70"
                >
                  {renamingLens ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteEventModalId ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDeleteEventModalId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="page-title text-2xl text-[var(--accent-ink)]">
              Удалить событие?
            </h3>
            <p className="mt-2 text-sm text-[color:rgba(63,58,52,.75)]">
              Событие исчезнет из календаря. Если передумали, просто закройте
              это окно.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteEventModalId(null)}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteEvent()}
                disabled={deletingEventId === deleteEventModalId}
                className="rounded-xl bg-[color:#8B3A2E] px-4 py-2 text-sm text-white disabled:opacity-70"
              >
                {deletingEventId === deleteEventModalId
                  ? "Удаляем..."
                  : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <h3 className="page-title text-2xl text-[var(--accent-ink)]">
                Редактировать событие
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Закрыть"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={saveEdit} className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEditing((value) =>
                      value ? { ...value, mode: "day" } : value,
                    )
                  }
                  className={`rounded-lg px-3 py-1 text-xs ${editing.mode === "day" ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                >
                  Один день
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditing((value) =>
                      value ? { ...value, mode: "range" } : value,
                    )
                  }
                  className={`rounded-lg px-3 py-1 text-xs ${editing.mode === "range" ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                >
                  Несколько дней
                </button>
              </div>
              <input
                value={editing.title}
                onChange={(event) =>
                  setEditing((value) =>
                    value ? { ...value, title: event.target.value } : value,
                  )
                }
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
              />
              <textarea
                value={editing.description}
                onChange={(event) =>
                  setEditing((value) =>
                    value
                      ? { ...value, description: event.target.value }
                      : value,
                  )
                }
                rows={2}
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
              />
              {editing.mode === "day" ? (
                <DatePicker
                  value={editing.date}
                  onChange={(value) =>
                    setEditing((current) =>
                      current ? { ...current, date: value } : current,
                    )
                  }
                  placeholder="Дата события"
                />
              ) : (
                <DateRangePicker
                  from={editing.date}
                  to={editing.endDate}
                  onChange={({ from, to }) =>
                    setEditing((current) =>
                      current ? { ...current, date: from, endDate: to } : current,
                    )
                  }
                  placeholder="Диапазон события"
                />
              )}
              <div className="rounded-xl border border-[var(--line)] bg-white p-2">
                <p className="text-xs text-[color:rgba(63,58,52,.68)]">
                  Участники
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableMembers.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() =>
                        setEditing((value) =>
                          value
                            ? {
                                ...value,
                                memberIds: toggleId(value.memberIds, member.id),
                              }
                            : value,
                        )
                      }
                      className={`rounded-lg px-2 py-1 text-xs ${editing.memberIds.includes(member.id) ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                    >
                      {member.display_name}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-60"
              >
                {savingEdit ? "Сохраняем..." : "Сохранить"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
