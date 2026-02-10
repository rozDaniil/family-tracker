import type { CalendarLens, Category, EventItem, FamilyProject, Member, SessionPayload } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    if (body) {
      try {
        const parsed = JSON.parse(body) as { detail?: string };
        if (parsed?.detail) throw new Error(parsed.detail);
      } catch {
        throw new Error(body);
      }
    }
    throw new Error(`Request failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  createSession(displayName: string, userId?: string) {
    return request<SessionPayload>("/auth/session", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName, user_id: userId }),
    });
  },
  getProject(token: string) {
    return request<FamilyProject>("/projects/current", {}, token);
  },
  getMembers(token: string) {
    return request<Member[]>("/members", {}, token);
  },
  createMember(token: string, payload: { display_name: string }) {
    return request<Member>(
      "/members",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  getCategories(token: string) {
    return request<Category[]>("/categories", {}, token);
  },
  createCategory(
    token: string,
    payload: { name: string; icon: string; color: string },
  ) {
    return request<Category>(
      "/categories",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  deleteCategory(token: string, id: string) {
    return request<void>(
      `/categories/${id}`,
      {
        method: "DELETE",
      },
      token,
    );
  },
  patchCategory(
    token: string,
    id: string,
    payload: Partial<{ name: string; icon: string; color: string; is_archived: boolean }>,
  ) {
    return request<Category>(
      `/categories/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  getEvents(
    token: string,
    params: { from: string; to: string; category_id?: string; member_id?: string; lens_id?: string },
  ) {
    const search = new URLSearchParams();
    search.set("from", params.from);
    search.set("to", params.to);
    if (params.category_id) search.set("category_id", params.category_id);
    if (params.member_id) search.set("member_id", params.member_id);
    if (params.lens_id) search.set("lens_id", params.lens_id);
    return request<EventItem[]>(`/events?${search.toString()}`, {}, token);
  },
  createEvent(
    token: string,
    payload: {
      title: string;
      description?: string;
      category_id?: string | null;
      lens_id?: string | null;
      member_id?: string;
      member_ids?: string[];
      kind: "NOTE" | "RANGE" | "ACTIVE";
      date_local: string;
      end_date_local?: string;
      start_at?: string;
      end_at?: string;
    },
  ) {
    return request<EventItem>(
      "/events",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  stopEvent(token: string, eventId: string) {
    return request<EventItem>(
      `/events/${eventId}/stop`,
      {
        method: "POST",
      },
      token,
    );
  },
  createInviteLink(token: string) {
    return request<{ invite_url: string; expires_at: string | null }>(
      "/invites/link",
      {
        method: "POST",
        body: JSON.stringify({ expires_in_hours: 72 }),
      },
      token,
    );
  },
  getLenses(token: string) {
    return request<CalendarLens[]>("/lenses", {}, token);
  },
  getLens(token: string, lensId: string) {
    return request<CalendarLens>(`/lenses/${lensId}`, {}, token);
  },
  createLens(
    token: string,
    payload: {
      name: string;
      view_type: "day" | "week" | "month" | "timeline" | "list";
      range_preset: string;
      category_ids: string[];
      member_ids: string[];
      sort_order: string;
      density: string;
      is_default: boolean;
    },
  ) {
    return request<CalendarLens>(
      "/lenses",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  patchLens(
    token: string,
    lensId: string,
    payload: Partial<{
      name: string;
      view_type: "day" | "week" | "month" | "timeline" | "list";
      range_preset: string;
      category_ids: string[];
      member_ids: string[];
      sort_order: string;
      density: string;
      is_default: boolean;
    }>,
  ) {
    return request<CalendarLens>(
      `/lenses/${lensId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  deleteLens(token: string, lensId: string) {
    return request<void>(
      `/lenses/${lensId}`,
      {
        method: "DELETE",
      },
      token,
    );
  },
  patchEvent(
    token: string,
    eventId: string,
    payload: Partial<{
      title: string;
      description: string;
      category_id: string | null;
      lens_id: string | null;
      member_id: string | null;
      member_ids: string[];
      date_local: string;
      end_date_local: string;
      start_at: string | null;
      end_at: string | null;
      kind: "NOTE" | "RANGE" | "ACTIVE";
    }>,
  ) {
    return request<EventItem>(
      `/events/${eventId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
  },
  deleteEvent(token: string, eventId: string) {
    return request<void>(
      `/events/${eventId}`,
      {
        method: "DELETE",
      },
      token,
    );
  },
};
