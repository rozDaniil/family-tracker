import type { EventItem } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export const LIVE_DISCONNECT_MESSAGE = "Соединение потеряно — синхронизация при восстановлении";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function buildLiveWsUrl(params: { calendarId?: string; projectFeed?: boolean }): string {
  const base = new URL(API_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${trimTrailingSlash(base.pathname)}/live/ws`;
  if (params.calendarId) base.searchParams.set("calendar_id", params.calendarId);
  if (params.projectFeed === false) base.searchParams.set("project_feed", "false");
  return base.toString();
}

export function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function shouldApplyIncoming(currentUpdatedAt: string | null | undefined, incomingUpdatedAt: string): boolean {
  return toTimestamp(incomingUpdatedAt) >= toTimestamp(currentUpdatedAt);
}

export function normalizeLiveEvent(payload: unknown): EventItem | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Partial<EventItem>;
  if (!raw.id || !raw.project_id || !raw.title || !raw.date_local || !raw.kind || !raw.created_at || !raw.updated_at) {
    return null;
  }
  return {
    id: raw.id,
    project_id: raw.project_id,
    title: raw.title,
    description: raw.description ?? null,
    category_id: raw.category_id ?? null,
    lens_id: raw.lens_id ?? null,
    member_id: raw.member_id ?? null,
    member_ids: raw.member_ids ?? [],
    kind: raw.kind,
    date_local: raw.date_local,
    end_date_local: raw.end_date_local ?? raw.date_local,
    start_at: raw.start_at ?? null,
    end_at: raw.end_at ?? null,
    is_active: Boolean(raw.is_active),
    created_by: raw.created_by ?? "",
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}
