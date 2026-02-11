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
  display_name: string;
  avatar_url?: string | null;
  status: "active" | "invited";
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
