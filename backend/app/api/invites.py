from datetime import UTC, datetime, timedelta
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.auth import _build_session_out, _issue_refresh_session, _set_auth_cookies
from app.api.deps import get_current_member, get_current_project
from app.core.config import settings
from app.core.db import get_db
from app.models import FamilyProject, InviteLink, Member, MemberStatus, User
from app.schemas.common import InviteAcceptIn, InviteCreateIn, InviteCreateOut, InvitePendingOut, SessionOut
from app.services.email import send_invite_email
from app.services.live import live_broker, make_live_message, project_meta_channel
from app.services.rate_limiter import InMemoryRateLimiter
from app.services.security import generate_invite_token, hash_invite_token

router = APIRouter(prefix="/invites", tags=["invites"])
rate_limiter = InMemoryRateLimiter()
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_rate_limit(request: Request, key_suffix: str, *, actor_id: str | None = None) -> None:
    if actor_id:
        key = f"user:{actor_id}:{key_suffix}"
    else:
        key = f"{request.client.host}:{key_suffix}" if request.client else key_suffix
    allowed = rate_limiter.allow(key, settings.invite_rate_limit_per_minute, 60)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")


def _build_invite_url(raw_token: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/auth/invite?token={raw_token}"


def _normalize_invite_email(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip().lower()
    if not value:
        return None
    if not EMAIL_RE.fullmatch(value):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid recipient email")
    return value


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@router.get("/pending", response_model=list[InvitePendingOut])
def list_pending_invites(
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> list[InvitePendingOut]:
    now = datetime.now(UTC)
    invites = (
        db.query(InviteLink)
        .filter(
            InviteLink.project_id == project.id,
            InviteLink.is_revoked.is_(False),
            InviteLink.accepted_at.is_(None),
            InviteLink.recipient_email.is_not(None),
        )
        .order_by(InviteLink.created_at.desc())
        .all()
    )
    items: list[InvitePendingOut] = []
    for invite in invites:
        expires_at_utc = _as_utc(invite.expires_at)
        raw_display = (invite.recipient_name or invite.recipient_email or "").strip()
        display_name = raw_display or (invite.recipient_email or "Invited member")
        items.append(
            InvitePendingOut(
                id=invite.id,
                recipient_email=invite.recipient_email or "",
                display_name=display_name,
                invite_url=None,
                expires_at=invite.expires_at,
                created_at=invite.created_at,
                is_expired=bool(expires_at_utc and expires_at_utc < now),
            )
        )
    return items


@router.post("/link", response_model=InviteCreateOut)
def create_invite_link(
    payload: InviteCreateIn,
    request: Request,
    member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> InviteCreateOut:
    _check_rate_limit(request, "invite_create", actor_id=str(member.user_id))
    raw_token = generate_invite_token()
    normalized_email = _normalize_invite_email(payload.recipient_email)
    normalized_name = payload.recipient_name.strip() if payload.recipient_name else None
    if normalized_name == "":
        normalized_name = None
    expires_at = None
    if payload.expires_in_hours:
        expires_at = datetime.now(UTC) + timedelta(hours=payload.expires_in_hours)
    invite = InviteLink(
        project_id=project.id,
        token_hash=hash_invite_token(raw_token),
        recipient_email=normalized_email,
        recipient_name=normalized_name,
        expires_at=expires_at,
        created_by=member.user_id,
    )
    db.add(invite)
    db.commit()
    invite_url = _build_invite_url(raw_token)
    if normalized_email:
        send_invite_email(
            to_email=normalized_email,
            inviter_name=member.display_name,
            project_name=project.name,
            invite_url=invite_url,
        )
    return InviteCreateOut(invite_url=invite_url, expires_at=expires_at)


@router.post("/accept", response_model=SessionOut)
def accept_invite(
    payload: InviteAcceptIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> SessionOut:
    _check_rate_limit(request, "invite_accept")
    token_hash = hash_invite_token(payload.token)
    invite = db.query(InviteLink).filter(InviteLink.token_hash == token_hash).first()
    if not invite or invite.is_revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invite already used")
    expires_at_utc = _as_utc(invite.expires_at)
    if expires_at_utc and expires_at_utc < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite expired")

    project = db.get(FamilyProject, invite.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    display_name = payload.display_name.strip() or invite.recipient_name or invite.recipient_email or "Member"
    normalized_email = _normalize_invite_email(invite.recipient_email)
    if normalized_email:
        existing_user = db.query(User).filter(User.email == normalized_email).first()
        if existing_user:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(display_name=display_name)
    if normalized_email:
        user.email = normalized_email
        user.email_verified = True
        user.auth_provider = "local"
    db.add(user)
    db.flush()

    member = Member(
        project_id=project.id,
        user_id=user.id,
        invited_by=invite.created_by,
        display_name=display_name,
        status=MemberStatus.active,
    )
    db.add(member)
    invite.accepted_at = datetime.now(UTC)
    invite.accepted_member_id = member.id
    db.add(invite)
    refresh_raw, refresh_session = _issue_refresh_session(db, user.id, remember_me=True)
    db.commit()
    _set_auth_cookies(response, user, refresh_raw, True, refresh_session.expires_at)
    message = make_live_message(
        project_id=project.id,
        calendar_id=None,
        message_type="member.changed",
        entity_id=member.id,
        payload={
            "id": str(member.id),
            "project_id": str(member.project_id),
            "display_name": member.display_name,
            "avatar_url": member.avatar_url,
            "status": member.status.value,
            "invited_by": str(member.invited_by) if member.invited_by else None,
        },
        updated_at=member.created_at,
    )
    live_broker.publish(project_meta_channel(project.id), message)
    return _build_session_out(user, member, project)
