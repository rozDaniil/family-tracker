import type { CalendarLens, Category, CircleContact, EventItem, FamilyProject, Member, ProfileItem } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

let refreshPromise: Promise<void> | null = null;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!raw) return null;
  return decodeURIComponent(raw.substring(name.length + 1));
}

function withCsrf(init: RequestInit): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = readCookie("flc_csrf");
    if (csrf) {
      const headers = new Headers(init.headers ?? {});
      headers.set("X-CSRF-Token", csrf);
      return { ...init, headers };
    }
  }
  return init;
}

async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const prepared = withCsrf(init);
  const headers = new Headers(prepared.headers ?? {});
  const isFormData =
    typeof FormData !== "undefined" && prepared.body instanceof FormData;
  if (!headers.has("Content-Type") && prepared.body !== undefined && !isFormData) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_URL}${path}`, {
    ...prepared,
    headers,
    credentials: "include",
  });
}

async function refreshSessionOnce(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await rawRequest("/auth/refresh", { method: "POST" });
      if (!response.ok) {
        throw new Error("Session refresh failed");
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  let response = await rawRequest(path, init);

  if (response.status === 401 && allowRefresh && path !== "/auth/refresh" && !path.startsWith("/auth/login") && !path.startsWith("/auth/signup")) {
    try {
      await refreshSessionOnce();
      response = await rawRequest(path, init);
    } catch {
      throw new Error("UNAUTHORIZED");
    }
  }

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

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  signup(payload: { email: string; password: string; display_name: string; remember_me?: boolean }) {
    return request<{ user: { id: string; display_name: string; email: string | null; email_verified: boolean; avatar_url: string | null }; project: FamilyProject; member: Member; email_verified: boolean }>(
      "/auth/signup",
      { method: "POST", body: JSON.stringify(payload) },
      false,
    );
  },
  login(payload: { email: string; password: string; remember_me?: boolean }) {
    return request<{ user: { id: string; display_name: string; email: string | null; email_verified: boolean; avatar_url: string | null }; project: FamilyProject; member: Member; email_verified: boolean }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(payload) },
      false,
    );
  },
  logout() {
    return request<void>("/auth/logout", { method: "POST" }, false);
  },
  getSession() {
    return request<{ user: { id: string; display_name: string; email: string | null; email_verified: boolean; avatar_url: string | null }; project: FamilyProject; member: Member; email_verified: boolean }>("/auth/session", {}, false);
  },
  refresh() {
    return request<{ user: { id: string; display_name: string; email: string | null; email_verified: boolean; avatar_url: string | null }; project: FamilyProject; member: Member; email_verified: boolean }>(
      "/auth/refresh",
      { method: "POST" },
      false,
    );
  },
  resendVerification(payload: { email: string }) {
    return request<void>("/auth/verify-email/resend", { method: "POST", body: JSON.stringify(payload) }, false);
  },
  confirmVerification(payload: { token: string }) {
    return request<void>("/auth/verify-email/confirm", { method: "POST", body: JSON.stringify(payload) }, false);
  },
  forgotPassword(payload: { email: string }) {
    return request<void>("/auth/password/forgot", { method: "POST", body: JSON.stringify(payload) }, false);
  },
  resetPassword(payload: { token: string; password: string }) {
    return request<void>("/auth/password/reset", { method: "POST", body: JSON.stringify(payload) }, false);
  },
  googleStartUrl() {
    return `${API_URL}/auth/google/start`;
  },
  getProfile(_token?: string) {
    void _token;
    return request<ProfileItem>("/profile");
  },
  patchProfile(
    _token: string | undefined,
    payload: Partial<{ display_name: string; avatar_url: string | null; birthday: string | null }>,
  ) {
    void _token;
    return request<ProfileItem>(
      "/profile",
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },
  uploadAvatar(_token: string | undefined, file: File) {
    void _token;
    const formData = new FormData();
    formData.append("file", file);
    return request<ProfileItem>(
      "/profile/avatar",
      {
        method: "POST",
        body: formData,
      },
    );
  },
  changePassword(
    _token: string | undefined,
    payload: { current_password: string; new_password: string },
  ) {
    void _token;
    return request<void>(
      "/profile/change-password",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  resendMyVerification(_token?: string) {
    void _token;
    return request<void>("/profile/resend-verification", { method: "POST" });
  },
  getCircle(_token?: string) {
    void _token;
    return request<CircleContact[]>("/profile/circle");
  },
  patchCircleNickname(
    _token: string | undefined,
    memberId: string,
    payload: { nickname: string | null },
  ) {
    void _token;
    return request<CircleContact>(
      `/profile/circle/${memberId}/nickname`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },

  // Legacy method kept for compatibility while UI migrates.
  createSession(displayName: string, userId?: string) {
    return request<{ token: string; user_id: string; project_id: string; member_id: string }>("/auth/session", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName, user_id: userId }),
    });
  },
  getProject(_token?: string) {
    void _token;
    return request<FamilyProject>("/projects/current");
  },
  getMembers(_token?: string) {
    void _token;
    return request<Member[]>("/members");
  },
  createMember(_token: string | undefined, payload: { display_name: string }) {
    return request<Member>("/members", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getCategories(_token?: string) {
    void _token;
    return request<Category[]>("/categories");
  },
  createCategory(
    _token: string | undefined,
    payload: { name: string; icon: string; color: string },
  ) {
    return request<Category>(
      "/categories",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },
  deleteCategory(_token: string | undefined, id: string) {
    return request<void>(
      `/categories/${id}`,
      {
        method: "DELETE",
      },
    );
  },
  patchCategory(
    _token: string | undefined,
    id: string,
    payload: Partial<{ name: string; icon: string; color: string; is_archived: boolean }>,
  ) {
    return request<Category>(
      `/categories/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );
  },
  getEvents(
    _token: string | undefined,
    params: { from: string; to: string; category_id?: string; member_id?: string; lens_id?: string },
  ) {
    const search = new URLSearchParams();
    search.set("from", params.from);
    search.set("to", params.to);
    if (params.category_id) search.set("category_id", params.category_id);
    if (params.member_id) search.set("member_id", params.member_id);
    if (params.lens_id) search.set("lens_id", params.lens_id);
    return request<EventItem[]>(`/events?${search.toString()}`);
  },
  createEvent(
    _token: string | undefined,
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
    );
  },
  stopEvent(_token: string | undefined, eventId: string) {
    return request<EventItem>(
      `/events/${eventId}/stop`,
      {
        method: "POST",
      },
    );
  },
  createInviteLink(_token?: string) {
    void _token;
    return request<{ invite_url: string; expires_at: string | null }>(
      "/invites/link",
      {
        method: "POST",
        body: JSON.stringify({ expires_in_hours: 72 }),
      },
    );
  },
  getLenses(_token?: string) {
    void _token;
    return request<CalendarLens[]>("/lenses");
  },
  getLens(_token: string | undefined, lensId: string) {
    return request<CalendarLens>(`/lenses/${lensId}`);
  },
  createLens(
    _token: string | undefined,
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
    );
  },
  patchLens(
    _token: string | undefined,
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
    );
  },
  deleteLens(_token: string | undefined, lensId: string) {
    return request<void>(
      `/lenses/${lensId}`,
      {
        method: "DELETE",
      },
    );
  },
  patchEvent(
    _token: string | undefined,
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
    );
  },
  deleteEvent(_token: string | undefined, eventId: string) {
    return request<void>(
      `/events/${eventId}`,
      {
        method: "DELETE",
      },
    );
  },
};

