"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { useLiveFeed } from "@/hooks/use-live-feed";
import { DatePicker } from "@/components/ui/date-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { api } from "@/lib/api";
import { LIVE_DISCONNECT_MESSAGE, normalizeLiveEvent, shouldApplyIncoming, toTimestamp } from "@/lib/live";
import { buildMemberDisplayMap, withMemberDisplayNames } from "@/lib/member-display";
import type { CalendarLens, Category, CircleContact, EventComment, EventItem, LiveMessage, Member } from "@/lib/types";
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

function eventMemberIds(event: EventItem): string[] {
  if (event.member_ids && event.member_ids.length > 0) return event.member_ids;
  if (event.member_id) return [event.member_id];
  return [];
}

function toggleId(ids: string[], value: string) {
  return ids.includes(value)
    ? ids.filter((item) => item !== value)
    : [...ids, value];
}

function formatDayLensTitle(value: string): string {
  return fromDateKey(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

function formatEventsCount(value: number): string {
  const abs = Math.abs(value);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} событие`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} события`;
  return `${value} событий`;
}

export default function CalendarsPage() {
  const { token, userId } = useSessionStore();
  const searchParams = useSearchParams();
  const appliedSearchKeyRef = useRef<string | null>(null);
  const [lenses, setLenses] = useState<CalendarLens[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [circle, setCircle] = useState<CircleContact[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedLensId, setSelectedLensId] = useState("");
  const [cursorMonth, setCursorMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));

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
  const [renameLensMemberIds, setRenameLensMemberIds] = useState<string[]>([]);

  const [deleteEventModalId, setDeleteEventModalId] = useState<string | null>(
    null,
  );
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [createFactModalOpen, setCreateFactModalOpen] = useState(false);
  const [useRangeInCreateFact, setUseRangeInCreateFact] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [eventMenuOpenId, setEventMenuOpenId] = useState<string | null>(null);
  const [commentsByEventId, setCommentsByEventId] = useState<Record<string, EventComment[]>>({});
  const [loadedCommentsEventIds, setLoadedCommentsEventIds] = useState<Set<string>>(new Set());
  const [commentsLoadingEventId, setCommentsLoadingEventId] = useState<string | null>(null);
  const [commentDraftByEventId, setCommentDraftByEventId] = useState<Record<string, string>>({});
  const [commentingEventId, setCommentingEventId] = useState<string | null>(null);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const liveResyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedEventTombstonesRef = useRef<Map<string, number>>(new Map());

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
      try {
        const [lensRes, categoriesRes, membersRes, circleRes] = await Promise.all([
          api.getLenses(token),
          api.getCategories(token),
          api.getMembers(token),
          api.getCircle(token),
        ]);
        if (cancelled) return;
        const activeCategories = categoriesRes.filter(
          (item) => !item.is_archived,
        );
        setLenses(lensRes);
        setCategories(activeCategories);
        setMembers(membersRes);
        setCircle(circleRes);
        setSelectedLensId((current) => {
          if (current && lensRes.some((item) => item.id === current)) return current;
          const fallback = lensRes.find((item) => item.is_default) ?? lensRes[0];
          return fallback?.id ?? "";
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  const selectedLens = useMemo(
    () => lenses.find((item) => item.id === selectedLensId),
    [lenses, selectedLensId],
  );
  const isLensOwner = useCallback(
    (lens: CalendarLens) => Boolean(userId) && lens.created_by === userId,
    [userId],
  );

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

      if (message.type === "calendar.deleted") {
        setLenses((current) => current.filter((item) => item.id !== message.entityId));
        setSelectedLensId((current) => (current === message.entityId ? "" : current));
        setEvents((current) => current.filter((event) => event.lens_id !== message.entityId));
        scheduleLiveResync();
        return;
      }

      if (
        message.type === "calendar.updated" ||
        message.type === "member.changed" ||
        message.type === "project.updated"
      ) {
        scheduleLiveResync();
        return;
      }

      if (message.type === "comment.added") {
        const payload = message.payload as EventComment | null;
        if (!payload) {
          scheduleLiveResync();
          return;
        }
        setLoadedCommentsEventIds((current) => {
          if (current.has(payload.event_id)) return current;
          const next = new Set(current);
          next.add(payload.event_id);
          return next;
        });
        setCommentsByEventId((current) => {
          const list = current[payload.event_id] ?? [];
          if (list.some((item) => item.id === payload.id)) return current;
          return { ...current, [payload.event_id]: [...list, payload] };
        });
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
      if (!selectedLensId || incoming.lens_id !== selectedLensId) return;

      if (selectedLens && selectedLens.member_ids.length > 0) {
        const allowedMemberIds = new Set(selectedLens.member_ids);
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
        next.sort(compareEventsStable);
        return next;
      });
    },
    [scheduleLiveResync, selectedLens, selectedLensId],
  );

  const liveEnabled = Boolean(token && selectedLensId);
  const { connectionState: liveConnectionState } = useLiveFeed({
    enabled: liveEnabled,
    calendarId: selectedLensId || undefined,
    onMessage: handleLiveMessage,
    onReconnectResync: scheduleLiveResync,
  });

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

    if (eventIdParam) setExpandedEventId(eventIdParam);
    appliedSearchKeyRef.current = searchKey;
  }, [lenses, searchParams]);

  useEffect(() => {
    if (!token || !selectedLens) return;
    let cancelled = false;
    (async () => {
      setLoadingEvents(true);
      try {
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
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.message.includes("Календарь не найден")) {
          setSelectedLensId("");
        }
        setEvents([]);
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selectedLens, cursorMonth, refreshKey]);

  useEffect(() => {
    setValue("date", selectedDate, { shouldValidate: true });
  }, [selectedDate, setValue]);

  useEffect(() => {
    setValue("mode", useRangeInCreateFact ? "range" : "day", {
      shouldValidate: true,
    });
    if (!useRangeInCreateFact) {
      setValue("end_date", "", { shouldValidate: true });
    }
  }, [setValue, useRangeInCreateFact]);

  useEffect(() => {
    const isOpen =
      createFactModalOpen ||
      createModalOpen ||
      Boolean(renameLensModalId) ||
      Boolean(deleteLensModalId) ||
      Boolean(deleteEventModalId) ||
      Boolean(editing);
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCreateFactModalOpen(false);
        setCreateModalOpen(false);
        setLensMemberIds([]);
        setRenameLensModalId(null);
        setRenameLensMemberIds([]);
        setDeleteLensModalId(null);
        setDeleteEventModalId(null);
        setEditing(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    createFactModalOpen,
    createModalOpen,
    renameLensModalId,
    deleteLensModalId,
    deleteEventModalId,
    editing,
  ]);

  useEffect(() => {
    setEventMenuOpenId(null);
  }, [selectedDate]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-event-menu-root='true']")) return;
      setEventMenuOpenId(null);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    const hasModalOpen =
      createFactModalOpen ||
      createModalOpen ||
      Boolean(renameLensModalId) ||
      Boolean(deleteLensModalId) ||
      Boolean(deleteEventModalId) ||
      Boolean(editing);
    if (!hasModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [
    createFactModalOpen,
    createModalOpen,
    renameLensModalId,
    deleteLensModalId,
    deleteEventModalId,
    editing,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (liveResyncTimerRef.current) clearTimeout(liveResyncTimerRef.current);
    };
  }, []);

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
  const availableMembers = useMemo(() => {
    if (!selectedLens || selectedLens.member_ids.length === 0) return viewMembers;
    const allowed = new Set(selectedLens.member_ids);
    return viewMembers.filter((member) => allowed.has(member.id));
  }, [viewMembers, selectedLens]);
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
      const requestedMembers = lensMemberIds;
      const created = await api.createLens(token, {
        name: lensName.trim(),
        view_type: "month",
        range_preset: "month",
        category_ids: [],
        member_ids: requestedMembers,
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
      setUseRangeInCreateFact(false);
      setCreateFactModalOpen(false);
      setShowSavedToast(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setShowSavedToast(false);
      }, 1800);
      setTimeout(() => {
        eventListRef.current?.focus();
      }, 0);
      setRefreshKey((value) => value + 1);
    } finally {
      setCreatingEvent(false);
    }
  }

  async function loadEventComments(eventId: string) {
    if (!token) return;
    if (loadedCommentsEventIds.has(eventId)) return;
    if (commentsLoadingEventId === eventId) return;
    setCommentsLoadingEventId(eventId);
    try {
      const comments = await api.getEventComments(token, eventId);
      setCommentsByEventId((current) => ({ ...current, [eventId]: comments }));
      setLoadedCommentsEventIds((current) => {
        if (current.has(eventId)) return current;
        const next = new Set(current);
        next.add(eventId);
        return next;
      });
    } finally {
      setCommentsLoadingEventId((current) => (current === eventId ? null : current));
    }
  }

  async function submitEventComment(eventId: string) {
    if (!token) return;
    if (commentingEventId === eventId) return;
    const text = (commentDraftByEventId[eventId] ?? "").trim();
    if (!text) return;
    setCommentingEventId(eventId);
    try {
      const created = await api.createEventComment(token, eventId, { text });
      setCommentsByEventId((current) => ({
        ...current,
        [eventId]: (current[eventId] ?? []).some((item) => item.id === created.id)
          ? current[eventId] ?? []
          : [...(current[eventId] ?? []), created],
      }));
      setLoadedCommentsEventIds((current) => {
        if (current.has(eventId)) return current;
        const next = new Set(current);
        next.add(eventId);
        return next;
      });
      setCommentDraftByEventId((current) => ({ ...current, [eventId]: "" }));
    } finally {
      setCommentingEventId((current) => (current === eventId ? null : current));
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
    if (!isLensOwner(lens)) return;
    setRenameLensModalId(lens.id);
    setRenameLensName(lens.name);
    setRenameLensMemberIds(lens.member_ids);
  }

  async function saveLensName(event: FormEvent) {
    event.preventDefault();
    if (!token || !renameLensModalId || !renameLensName.trim()) return;
    setRenamingLens(true);
    try {
      const requestedMembers = renameLensMemberIds;
      const updated = await api.patchLens(token, renameLensModalId, {
        name: renameLensName.trim(),
        member_ids: requestedMembers,
      });
      setLenses((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRenameLensModalId(null);
      setRenameLensName("");
      setRenameLensMemberIds([]);
    } finally {
      setRenamingLens(false);
    }
  }

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
          onClick={() => {
            setLensMemberIds([]);
            setCreateModalOpen(true);
          }}
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
                className={`group no-hover relative rounded-2xl border p-4 transition ${lens.id === selectedLensId ? "border-[var(--accent)] bg-[var(--panel-soft)]" : "border-[var(--line)] bg-white/75"}`}
              >
                  <button
                    type="button"
                    onClick={() => setSelectedLensId(lens.id)}
                    className="no-hover w-full cursor-pointer pr-14 text-left"
                  >
                    <p className="text-base font-semibold">{lens.name}</p>
                    <p className="mt-1 text-[11px] text-[color:rgba(63,58,52,.62)]">
                      Автор: {lens.created_by === userId ? "Вы" : (memberByUserId.get(lens.created_by)?.display_name ?? "Участник")}
                    </p>
                  </button>
                {isLensOwner(lens) ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRenameLens(lens);
                      }}
                      disabled={renamingLens}
                      aria-label="Переименовать календарь"
                      className="absolute right-10 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white transition disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
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
                      className="absolute right-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--line)] bg-white transition disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </article>
            ))}
          </section>

          {selectedLens ? (
            <section className="grid gap-4 xl:grid-cols-[minmax(0,2.35fr)_minmax(320px,0.95fr)]">
              <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="page-title text-3xl text-[var(--accent-ink)]">
                      {selectedLens.name}
                    </h2>
                    {liveEnabled && liveConnectionState === "disconnected" ? (
                      <p className="text-xs text-[color:rgba(63,58,52,.72)]">
                        {LIVE_DISCONNECT_MESSAGE}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const today = new Date();
                        setCursorMonth(
                          new Date(today.getFullYear(), today.getMonth(), 1),
                        );
                        setSelectedDate(todayKey);
                        setCreateFactModalOpen(false);
                        setUseRangeInCreateFact(false);
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

                <div className={`rounded-xl border border-[var(--line)] bg-white/75 transition-opacity duration-200 ${loadingEvents ? "opacity-95" : "opacity-100"}`}>
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
                          onClick={() => {
                            setSelectedDate(cell.date);
                            setCreateFactModalOpen(false);
                            setUseRangeInCreateFact(false);
                          }}
                          className={`relative flex min-h-32 cursor-pointer flex-col items-start border-l border-t border-[var(--line)] px-2 py-1.5 text-left transition ${
                            isLastColumn ? "border-r" : ""
                          } ${isLastRow ? "border-b" : ""} ${
                            isSelected
                              ? "bg-[color:rgba(180,143,104,0.16)]"
                              : isToday
                                ? "bg-[color:rgba(180,143,104,0.08)]"
                                : cell.inMonth
                                  ? "bg-white"
                                  : "bg-white/60"
                          } hover:bg-[color:rgba(180,143,104,0.08)]`}
                        >
                          <p className="text-xs text-[color:rgba(63,58,52,.56)]">
                            {day}
                          </p>
                          <div className="mt-2 w-full space-y-0.5 text-left">
                            {cellEvents.slice(0, 3).map((event) => {
                              const color =
                                categoryMap.get(event.category_id ?? "")
                                  ?.color ?? "#B48F68";
                              const marker = markerType(event, cell.date);
                              const markerOpacity =
                                marker === "middle" ? "0.46" : "0.75";
                              return (
                                <p
                                  key={`${event.id}-${cell.date}`}
                                  className="truncate pl-2 text-[11px] leading-4 text-[color:rgba(63,58,52,.86)]"
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
                              <p className="pl-2 text-[10px] text-[color:rgba(63,58,52,.58)]">
                                +{cellEvents.length - 3}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <aside className="flex h-[min(76vh,760px)] flex-col overflow-hidden rounded-2xl border border-[color:rgba(63,58,52,.16)] bg-[color:rgba(239,230,216,0.36)]">
                  <header className="sticky top-0 z-10 border-b border-[color:rgba(63,58,52,.12)] bg-[color:rgba(247,241,233,0.95)] px-4 py-2.5 backdrop-blur">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-[15px] font-semibold text-[var(--accent-ink)]">
                        События на {formatDayLensTitle(selectedDate)}
                      </h3>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <p className="text-xs text-[color:rgba(63,58,52,.56)]">
                        {formatEventsCount(selectedDateEvents.length)}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setUseRangeInCreateFact(false);
                          reset({
                            mode: "day",
                            title: "",
                            description: "",
                            member_ids: [],
                            date: selectedDate,
                            end_date: "",
                          });
                          setCreateFactModalOpen(true);
                        }}
                        className="inline-flex items-center rounded-md px-2 py-1 text-sm text-[var(--accent-ink)]"
                        >
                          + Добавить факт
                        </button>
                      </div>
                    </header>

                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {showSavedToast ? (
                      <div className="mb-3 inline-flex rounded-lg border border-[color:rgba(63,58,52,.14)] bg-white/82 px-3 py-1 text-xs text-[color:rgba(63,58,52,.72)]">
                        Сохранено
                      </div>
                    ) : null}

                    {loadingEvents ? (
                      <p className="mb-2 text-xs text-[color:rgba(63,58,52,.62)]">Обновляем события...</p>
                    ) : null}

                    {!loadingEvents && selectedDateEvents.length === 0 ? (
                      <EmptyState title="На эту дату пока пусто" />
                    ) : selectedDateEvents.length === 0 ? (
                      <div className="min-h-12" />
                    ) : (
                      <div
                        ref={eventListRef}
                        tabIndex={-1}
                        className={`space-y-3 pb-2 outline-none transition-opacity duration-200 ${loadingEvents ? "opacity-90" : "opacity-100"}`}
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
                          const authorName =
                            memberByUserId.get(event.created_by)?.display_name ?? "Неизвестный автор";
                          const metaLine = membersText
                            ? `Автор: ${authorName} • Участники: ${membersText}`
                            : `Автор: ${authorName}`;
                          const isExpanded = expandedEventId === event.id;
                          const isMenuOpen = eventMenuOpenId === event.id;
                          const isAuthor = userId === event.created_by;
                          const eventComments = commentsByEventId[event.id] ?? [];
                          const hasLoadedComments = loadedCommentsEventIds.has(event.id);
                          return (
                            <article
                              key={`${event.id}-${selectedDate}`}
                              data-event-menu-root="true"
                              className="relative rounded-xl border border-[color:rgba(63,58,52,.12)] bg-white/64 p-3 text-sm transition hover:bg-white/72"
                              style={{ borderLeft: `3px solid ${color}` }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  const nextExpanded = expandedEventId === event.id ? null : event.id;
                                  setExpandedEventId(nextExpanded);
                                  if (nextExpanded) {
                                    void loadEventComments(event.id);
                                  }
                                }}
                                className="no-hover block w-full pr-10 text-left"
                              >
                                <p className="font-semibold text-[color:rgba(63,58,52,.92)]">
                                  {event.title}
                                </p>
                                {metaLine ? (
                                  <p className="mt-1 truncate text-[11px] text-[color:rgba(63,58,52,.52)]">
                                    {metaLine}
                                  </p>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setEventMenuOpenId((value) =>
                                    value === event.id ? null : event.id,
                                  )
                                }
                                className="no-hover absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:rgba(63,58,52,.16)] bg-white"
                                aria-label="Открыть меню события"
                                data-event-menu-root="true"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                              {isMenuOpen ? (
                                <div
                                  data-event-menu-root="true"
                                  className="absolute right-2 top-10 z-10 w-36 rounded-lg border border-[var(--line)] bg-white p-1 shadow-sm"
                                >
                                  {isAuthor ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEventMenuOpenId(null);
                                        openEdit(event);
                                      }}
                                      className="no-hover w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--panel-soft)]"
                                    >
                                      Редактировать
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEventMenuOpenId(null);
                                        setExpandedEventId(event.id);
                                        void loadEventComments(event.id);
                                      }}
                                      className="no-hover w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--panel-soft)]"
                                    >
                                      Добавить заметку
                                    </button>
                                  )}
                                  {isAuthor ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEventMenuOpenId(null);
                                        setDeleteEventModalId(event.id);
                                      }}
                                      className="no-hover w-full rounded-md px-2 py-1.5 text-left text-xs text-[color:#8B3A2E] hover:bg-[var(--panel-soft)]"
                                    >
                                      Удалить
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {isExpanded ? (
                                <div className="mt-2 border-t border-[color:rgba(63,58,52,.12)] pt-2 text-xs text-[color:rgba(63,58,52,.72)]">
                                  {event.description ? (
                                    <p>{event.description}</p>
                                  ) : (
                                    <p>Без дополнительных деталей.</p>
                                  )}
                                  <div className="mt-3 space-y-2">
                                    <p className="text-[11px] font-semibold text-[color:rgba(63,58,52,.62)]">
                                      Заметки
                                    </p>
                                    {hasLoadedComments && eventComments.length === 0 ? (
                                      <p className="text-[11px]">Пока заметок нет.</p>
                                    ) : null}
                                    {eventComments.length > 0 ? (
                                      <div className="space-y-1.5">
                                        {eventComments.map((comment) => (
                                          <div key={comment.id} className="rounded-md border border-[color:rgba(63,58,52,.12)] bg-white/75 p-2">
                                            <p className="text-[11px] text-[color:rgba(63,58,52,.56)]">
                                              {memberMap.get(comment.author_member_id)?.display_name ?? "Участник"}
                                            </p>
                                            <p className="mt-1 text-xs text-[color:rgba(63,58,52,.85)]">{comment.text}</p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                    <div className="flex gap-2">
                                      <input
                                        value={commentDraftByEventId[event.id] ?? ""}
                                        onChange={(e) =>
                                          setCommentDraftByEventId((current) => ({
                                            ...current,
                                            [event.id]: e.target.value,
                                          }))
                                        }
                                        placeholder="Добавить заметку"
                                        className="w-full rounded-lg border border-[var(--line)] bg-white px-2 py-1.5 text-xs outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void submitEventComment(event.id)}
                                        disabled={commentingEventId === event.id}
                                        className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs disabled:opacity-60"
                                      >
                                        {commentingEventId === event.id ? "..." : "Отправить"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
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

      {createFactModalOpen ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setCreateFactModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2">
              <h3 className="page-title text-2xl text-[var(--accent-ink)]">
                Добавить факт
              </h3>
              <p className="mt-1 text-xs text-[color:rgba(63,58,52,.62)]">
                Дата: {formatDayLensTitle(watchedDate)}
              </p>
            </div>
            <form onSubmit={handleSubmit(submitNote)} className="space-y-1.5">
              <input
                {...register("title")}
                placeholder="Что произошло"
                className="w-full rounded-xl border border-[color:rgba(63,58,52,.14)] bg-white px-3 py-2 text-sm outline-none"
              />
              {errors.title ? (
                <p className="text-xs text-[color:#8B5D55]">{errors.title.message}</p>
              ) : null}
              <textarea
                {...register("description")}
                placeholder="Если хотите, добавьте детали"
                rows={2}
                className="w-full rounded-xl border border-[color:rgba(63,58,52,.14)] bg-white px-3 py-2 text-sm outline-none"
              />
              <input type="hidden" {...register("date")} />
              <input type="hidden" {...register("end_date")} />
              {useRangeInCreateFact ? (
                <DateRangePicker
                  from={watchedDate}
                  to={watchedEndDate}
                  onChange={({ from, to }) => {
                    setValue("date", from, { shouldValidate: true });
                    setValue("end_date", to, { shouldValidate: true });
                  }}
                  placeholder="Диапазон события"
                />
              ) : (
                <DatePicker
                  value={watchedDate}
                  onChange={(value) =>
                    setValue("date", value, { shouldValidate: true })
                  }
                  placeholder="Дата события"
                />
              )}
              {errors.end_date ? (
                <p className="text-xs text-[color:#8B5D55]">
                  {errors.end_date.message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setUseRangeInCreateFact((value) => !value)}
                className="text-xs text-[color:rgba(63,58,52,.62)] underline underline-offset-2"
              >
                {useRangeInCreateFact ? "Оставить один день" : "Указать диапазон"}
              </button>
              <div className="rounded-xl border border-[color:rgba(63,58,52,.14)] bg-white p-2">
                <p className="text-xs text-[color:rgba(63,58,52,.68)]">Участники</p>
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
              <div className="flex justify-center pt-1">
                <button
                  type="submit"
                  disabled={creatingEvent}
                  className="rounded-xl bg-[color:rgba(180,143,104,0.8)] px-4 py-2 text-sm text-white disabled:opacity-60"
                >
                  {creatingEvent ? "Сохраняем..." : "Сохранить факт"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {createModalOpen ? (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            setCreateModalOpen(false);
            setLensMemberIds([]);
          }}
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
                onClick={() => {
                  setCreateModalOpen(false);
                  setLensMemberIds([]);
                }}
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
                    {viewMembers.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setLensMemberIds((value) => toggleId(value, item.id));
                        }}
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
          onClick={() => {
            setRenameLensModalId(null);
            setRenameLensMemberIds([]);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="page-title text-2xl text-[var(--accent-ink)]">
              Редактировать календарь
            </h3>
            <form onSubmit={saveLensName} className="mt-3 space-y-3">
              <input
                value={renameLensName}
                onChange={(event) => setRenameLensName(event.target.value)}
                placeholder="Новое название"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none"
              />
              <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                <p className="text-xs uppercase tracking-[0.08em] text-[color:rgba(63,58,52,.68)]">
                  Участники
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {viewMembers.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setRenameLensMemberIds((value) => toggleId(value, item.id));
                      }}
                      className={`rounded-lg px-2 py-1 text-xs ${renameLensMemberIds.includes(item.id) ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-soft)]"}`}
                    >
                      {item.display_name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRenameLensModalId(null);
                    setRenameLensMemberIds([]);
                  }}
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
              Удалить факт?
            </h3>
            <p className="mt-2 text-sm text-[color:rgba(63,58,52,.75)]">
              Этот факт исчезнет из календаря.
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
