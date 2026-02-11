from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_project, get_current_user
from app.core.config import settings
from app.core.db import get_db
from app.models import EmailToken, EmailTokenPurpose, FamilyProject, LocalNickname, Member, RefreshSession, User
from app.schemas.common import (
    CircleContactOut,
    CircleNicknamePatchIn,
    PasswordChangeIn,
    ProfileOut,
    ProfilePatchIn,
)
from app.services.rate_limiter import InMemoryRateLimiter
from app.services.security import generate_opaque_token, hash_password, hash_token, verify_password

router = APIRouter(prefix="/profile", tags=["profile"])
rate_limiter = InMemoryRateLimiter()


def _now():
    from datetime import datetime

    return datetime.utcnow()


def _issue_email_verify_token(db: Session, user_id: UUID) -> None:
    from datetime import timedelta

    token = EmailToken(
        user_id=user_id,
        purpose=EmailTokenPurpose.verify_email,
        token_hash=hash_token(generate_opaque_token()),
        expires_at=_now() + timedelta(hours=24),
    )
    db.add(token)


def _build_profile(user: User) -> ProfileOut:
    return ProfileOut(
        user_id=user.id,
        display_name=user.display_name,
        email=user.email,
        email_verified=user.email_verified,
        avatar_url=user.avatar_url,
        birthday=user.birthday,
        can_change_password=bool(user.password_hash),
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.access_cookie_name, path="/")
    response.delete_cookie(settings.refresh_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


def _avatar_upload_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "uploads" / "avatars"


def _avatar_public_url(request: Request, filename: str) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/uploads/avatars/{filename}"


@router.get("", response_model=ProfileOut)
def get_profile(user: User = Depends(get_current_user)) -> ProfileOut:
    return _build_profile(user)


@router.patch("", response_model=ProfileOut)
def patch_profile(
    payload: ProfilePatchIn,
    user: User = Depends(get_current_user),
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> ProfileOut:
    if "display_name" in payload.model_fields_set and payload.display_name is not None:
        value = payload.display_name.strip()
        if not value:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Display name cannot be empty")
        user.display_name = value
        member.display_name = value
        db.add(member)
    if "avatar_url" in payload.model_fields_set:
        user.avatar_url = payload.avatar_url.strip() if payload.avatar_url else None
        member.avatar_url = user.avatar_url
        db.add(member)
    if "birthday" in payload.model_fields_set:
        user.birthday = payload.birthday

    db.add(user)
    db.commit()
    db.refresh(user)
    return _build_profile(user)


@router.post("/avatar", response_model=ProfileOut)
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> ProfileOut:
    content_type = (file.content_type or "").lower()
    extension_map = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    if content_type not in extension_map:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image files are allowed",
        )

    data = await file.read()
    await file.close()
    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Image file is empty",
        )
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image is too large (max 5MB)",
        )

    upload_dir = _avatar_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{user.id}_{int(_now().timestamp())}.{extension_map[content_type]}"
    (upload_dir / filename).write_bytes(data)

    public_url = _avatar_public_url(request, filename)
    user.avatar_url = public_url
    member.avatar_url = public_url
    db.add_all([user, member])
    db.commit()
    db.refresh(user)
    return _build_profile(user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    request: Request,
    response: Response,
    payload: PasswordChangeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    key = f"{request.client.host}:{user.id}:profile_change_password" if request.client else f"{user.id}:profile_change_password"
    if not rate_limiter.allow(key, 8, 300):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many password change attempts")

    if not user.password_hash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password auth is not enabled for this account")
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")

    user.password_hash = hash_password(payload.new_password)
    user.auth_provider = "both" if user.auth_provider == "google" else "local"
    db.add(user)

    sessions = (
        db.query(RefreshSession)
        .filter(
            RefreshSession.user_id == user.id,
            RefreshSession.revoked_at.is_(None),
        )
        .all()
    )
    now = _now()
    for item in sessions:
        item.revoked_at = now
        db.add(item)

    db.commit()
    _clear_auth_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
def resend_verification(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    key = f"{request.client.host}:profile_resend" if request.client else "profile_resend"
    if not rate_limiter.allow(key, 10, 60):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")

    if user.email and not user.email_verified:
        _issue_email_verify_token(db, user.id)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/circle", response_model=list[CircleContactOut])
def get_circle(
    user: User = Depends(get_current_user),
    member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> list[CircleContactOut]:
    members = (
        db.query(Member)
        .filter(Member.project_id == project.id)
        .order_by(Member.created_at.asc())
        .all()
    )
    visible = [m for m in members if m.id != member.id]
    nicknames = (
        db.query(LocalNickname)
        .filter(LocalNickname.owner_user_id == user.id)
        .all()
    )
    nickname_map = {item.member_id: item.nickname for item in nicknames}

    return [
        CircleContactOut(
            member_id=item.id,
            user_id=item.user_id,
            display_name=item.display_name,
            avatar_url=item.avatar_url,
            nickname=nickname_map.get(item.id),
        )
        for item in visible
    ]


@router.patch("/circle/{member_id}/nickname", response_model=CircleContactOut)
def patch_circle_nickname(
    member_id: UUID,
    payload: CircleNicknamePatchIn,
    user: User = Depends(get_current_user),
    me: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> CircleContactOut:
    target = db.get(Member, member_id)
    if not target or target.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    if target.id == me.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot set nickname for yourself")

    row = (
        db.query(LocalNickname)
        .filter(LocalNickname.owner_user_id == user.id, LocalNickname.member_id == member_id)
        .first()
    )
    nick = payload.nickname.strip() if payload.nickname else ""
    if not nick:
        if row:
            db.delete(row)
            db.commit()
        return CircleContactOut(
            member_id=target.id,
            user_id=target.user_id,
            display_name=target.display_name,
            avatar_url=target.avatar_url,
            nickname=None,
        )

    if row:
        row.nickname = nick
        db.add(row)
    else:
        db.add(LocalNickname(owner_user_id=user.id, member_id=member_id, nickname=nick))
    db.commit()

    return CircleContactOut(
        member_id=target.id,
        user_id=target.user_id,
        display_name=target.display_name,
        avatar_url=target.avatar_url,
        nickname=nick,
    )
