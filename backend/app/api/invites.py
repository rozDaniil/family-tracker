from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_project
from app.core.config import settings
from app.core.db import get_db
from app.models import FamilyProject, InviteLink, Member, MemberStatus, User
from app.schemas.common import InviteAcceptIn, InviteAcceptOut, InviteCreateIn, InviteCreateOut
from app.services.rate_limiter import InMemoryRateLimiter
from app.services.security import generate_invite_token, hash_invite_token

router = APIRouter(prefix="/invites", tags=["invites"])
rate_limiter = InMemoryRateLimiter()


def _check_rate_limit(request: Request, key_suffix: str) -> None:
    key = f"{request.client.host}:{key_suffix}" if request.client else key_suffix
    allowed = rate_limiter.allow(key, settings.invite_rate_limit_per_minute, 60)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")


@router.post("/link", response_model=InviteCreateOut)
def create_invite_link(
    payload: InviteCreateIn,
    request: Request,
    member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> InviteCreateOut:
    _check_rate_limit(request, "invite_create")
    raw_token = generate_invite_token()
    expires_at = None
    if payload.expires_in_hours:
        expires_at = datetime.now(UTC) + timedelta(hours=payload.expires_in_hours)
    invite = InviteLink(
        project_id=project.id,
        token_hash=hash_invite_token(raw_token),
        expires_at=expires_at,
        created_by=member.user_id,
    )
    db.add(invite)
    db.commit()
    return InviteCreateOut(invite_url=f"family-life://invite/{raw_token}", expires_at=expires_at)


@router.post("/accept", response_model=InviteAcceptOut)
def accept_invite(
    payload: InviteAcceptIn,
    request: Request,
    db: Session = Depends(get_db),
) -> InviteAcceptOut:
    _check_rate_limit(request, "invite_accept")
    token_hash = hash_invite_token(payload.token)
    invite = db.query(InviteLink).filter(InviteLink.token_hash == token_hash).first()
    if not invite or invite.is_revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    if invite.expires_at and invite.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite expired")

    project = db.get(FamilyProject, invite.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    user = User(display_name=payload.display_name)
    db.add(user)
    db.flush()

    member = Member(
        project_id=project.id,
        user_id=user.id,
        display_name=payload.display_name,
        status=MemberStatus.active,
    )
    db.add(member)
    db.commit()
    return InviteAcceptOut(token=str(user.id), user_id=user.id, project_id=project.id, member_id=member.id)
