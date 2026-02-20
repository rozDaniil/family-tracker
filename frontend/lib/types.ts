export type UUID = string;

export type EventKind = "NOTE" | "RANGE" | "ACTIVE";
export type LensView = "day" | "week" | "month" | "timeline" | "list";

export interface SessionPayload {
  token: string;
  user_id: UUID;
  project_id: UUID;
  member_id: UUID;
}

export interface SessionUser {
  id: UUID;
  display_name: string;
  email: string | null;
  email_verified: boolean;
  avatar_url?: string | null;
}

export interface SessionStatePayload {
  user: SessionUser;
  project: FamilyProject;
  member: Member;
  email_verified: boolean;
}

export interface ProfileItem {
  user_id: UUID;
  display_name: string;
  email: string | null;
  email_verified: boolean;
  avatar_url: string | null;
  birthday: string | null;
  can_change_password: boolean;
}

export interface CircleContact {
  member_id: UUID;
  user_id: UUID;
  display_name: string;
  avatar_url: string | null;
  nickname: string | null;
}

export interface FamilyProject {
  id: UUID;
  name: string;
  timezone: string;
  created_at: string;
}

export interface Member {
  id: UUID;
  project_id: UUID;
  user_id: UUID;
  display_name: string;
  avatar_url?: string | null;
  status: "active" | "invited";
}

export interface EventComment {
  id: UUID;
  event_id: UUID;
  project_id: UUID;
  author_member_id: UUID;
  text: string;
  created_at: string;
}

export interface PendingInvite {
  id: UUID;
  recipient_email: string;
  display_name: string;
  invite_url: string | null;
  expires_at: string | null;
  created_at: string;
  is_expired: boolean;
}

export interface Category {
  id: UUID;
  project_id: UUID;
  name: string;
  icon: string;
  color: string;
  is_default: boolean;
  is_archived: boolean;
}

export interface EventItem {
  id: UUID;
  project_id: UUID;
  title: string;
  description?: string | null;
  category_id: UUID | null;
  lens_id?: UUID | null;
  member_id?: UUID | null;
  member_ids?: UUID[];
  kind: EventKind;
  date_local: string;
  end_date_local?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  is_active: boolean;
  created_by: UUID;
  created_at: string;
  updated_at: string;
}

export interface CalendarLens {
  id: UUID;
  project_id: UUID;
  name: string;
  view_type: LensView;
  range_preset: string;
  category_ids: UUID[];
  member_ids: UUID[];
  sort_order: string;
  density: string;
  is_default: boolean;
  created_by: UUID;
  created_at: string;
  updated_at: string;
}

export type LiveType =
  | "event.created"
  | "event.updated"
  | "event.deleted"
  | "event.started"
  | "event.stopped"
  | "comment.added"
  | "calendar.updated"
  | "calendar.deleted"
  | "member.changed"
  | "project.updated"
  | "system.connected"
  | "system.resync_required"
  | "system.ping";

export type LiveConnectionState = "connecting" | "connected" | "disconnected";

export interface LiveMessage<T = unknown> {
  id: string;
  projectId: UUID;
  calendarId: UUID | null;
  type: LiveType;
  entityId: string;
  payload: T | null;
  updatedAt: string;
}
