from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class EventKindSchema(str, Enum):
    NOTE = "NOTE"
    RANGE = "RANGE"
    ACTIVE = "ACTIVE"


class LensViewSchema(str, Enum):
    day = "day"
    week = "week"
    month = "month"
    timeline = "timeline"
    list = "list"


class MemberStatusSchema(str, Enum):
    active = "active"
    invited = "invited"


class FamilyProjectOut(BaseModel):
    id: UUID
    name: str
    timezone: str
    created_at: datetime


class ProjectPatchIn(BaseModel):
    name: str | None = None
    timezone: str | None = None


class MemberOut(BaseModel):
    id: UUID
    project_id: UUID
    display_name: str
    avatar_url: str | None
    status: MemberStatusSchema


class MemberCreateIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class CategoryOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    icon: str
    color: str
    is_default: bool
    is_archived: bool


class CategoryCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(min_length=1, max_length=80)
    color: str = Field(min_length=4, max_length=20)


class CategoryPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = Field(default=None, min_length=4, max_length=20)
    is_archived: bool | None = None


class EventOut(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str | None
    category_id: UUID | None
    lens_id: UUID | None
    member_id: UUID | None
    member_ids: list[UUID]
    kind: EventKindSchema
    date_local: date
    end_date_local: date
    start_at: datetime | None
    end_at: datetime | None
    is_active: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class EventCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str | None = None
    category_id: UUID | None = None
    lens_id: UUID | None = None
    member_id: UUID | None = None
    member_ids: list[UUID] = Field(default_factory=list)
    kind: EventKindSchema = EventKindSchema.NOTE
    date_local: date
    end_date_local: date | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None


class EventPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    category_id: UUID | None = None
    lens_id: UUID | None = None
    member_id: UUID | None = None
    member_ids: list[UUID] | None = None
    kind: EventKindSchema | None = None
    date_local: date | None = None
    end_date_local: date | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None


class AuthSessionIn(BaseModel):
    display_name: str = Field(default="Новый участник", min_length=1, max_length=120)
    user_id: UUID | None = None


class AuthSessionOut(BaseModel):
    token: str
    user_id: UUID
    project_id: UUID
    member_id: UUID


class InviteCreateIn(BaseModel):
    expires_in_hours: int | None = Field(default=72, ge=1, le=720)


class InviteCreateOut(BaseModel):
    invite_url: str
    expires_at: datetime | None


class InviteAcceptIn(BaseModel):
    token: str
    display_name: str = Field(default="Новый участник", min_length=1, max_length=120)


class InviteAcceptOut(BaseModel):
    token: str
    user_id: UUID
    project_id: UUID
    member_id: UUID


class CalendarLensOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    view_type: LensViewSchema
    range_preset: str
    category_ids: list[UUID]
    member_ids: list[UUID]
    sort_order: str
    density: str
    is_default: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class CalendarLensCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    view_type: LensViewSchema = LensViewSchema.week
    range_preset: str = Field(default="week", min_length=1, max_length=24)
    category_ids: list[UUID] = Field(default_factory=list)
    member_ids: list[UUID] = Field(default_factory=list)
    sort_order: str = Field(default="recent", min_length=1, max_length=24)
    density: str = Field(default="comfortable", min_length=1, max_length=24)
    is_default: bool = False


class CalendarLensPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    view_type: LensViewSchema | None = None
    range_preset: str | None = Field(default=None, min_length=1, max_length=24)
    category_ids: list[UUID] | None = None
    member_ids: list[UUID] | None = None
    sort_order: str | None = Field(default=None, min_length=1, max_length=24)
    density: str | None = Field(default=None, min_length=1, max_length=24)
    is_default: bool | None = None
