from datetime import UTC, datetime
import uuid

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.models import FamilyProject, Member, User
from app.services.security import decode_access_token, verify_csrf_token

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _extract_access_token(request: Request, authorization: str | None) -> str:
    cookie_token = request.cookies.get(settings.access_cookie_name)
    if cookie_token:
        return cookie_token
    if authorization and authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token")


def _ensure_csrf(request: Request, csrf_cookie: str | None, csrf_header: str | None) -> None:
    if request.method.upper() not in MUTATING_METHODS:
        return
    if not csrf_cookie or not csrf_header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token is required")
    if csrf_cookie != csrf_header:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token mismatch")
    if not verify_csrf_token(csrf_cookie, settings.csrf_secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    csrf_cookie: str | None = Cookie(default=None),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
    db: Session = Depends(get_db),
) -> User:
    token = _extract_access_token(request, authorization)
    payload = decode_access_token(token, settings.jwt_secret)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")

    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token")
    try:
        user_id = uuid.UUID(subject)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token") from exc

    csrf_value = csrf_cookie or request.cookies.get(settings.csrf_cookie_name)
    _ensure_csrf(request, csrf_value, csrf_header)

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    return user


def get_current_member(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Member:
    member = db.query(Member).filter(Member.user_id == user.id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No project membership")
    return member


def get_current_project(
    member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> FamilyProject:
    project = db.get(FamilyProject, member.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def get_current_user_optional(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    try:
        token = _extract_access_token(request, authorization)
    except HTTPException:
        return None
    payload = decode_access_token(token, settings.jwt_secret)
    if not payload:
        return None
    subject = payload.get("sub")
    if not isinstance(subject, str):
        return None
    try:
        user_id = uuid.UUID(subject)
    except ValueError:
        return None
    return db.get(User, user_id)
