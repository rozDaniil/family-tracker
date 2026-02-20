from datetime import datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_project, get_current_user, get_current_user_optional
from app.core.config import settings
from app.core.db import get_db
from app.models import (
    Category,
    EmailToken,
    EmailTokenPurpose,
    FamilyProject,
    Member,
    MemberStatus,
    RefreshSession,
    User,
)
from app.schemas.common import (
    AuthSessionIn,
    AuthSessionOut,
    AuthUserOut,
    FamilyProjectOut,
    LoginIn,
    MemberOut,
    PasswordForgotIn,
    PasswordResetIn,
    SessionOut,
    SignupIn,
    VerifyEmailConfirmIn,
    VerifyEmailResendIn,
)
from app.services.rate_limiter import InMemoryRateLimiter
from app.services.email import send_verify_email
from app.services.security import (
    create_access_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    sign_csrf_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

DEFAULT_CATEGORIES = [
    ("Дом", "Home", "#D7BFA8"),
    ("Быт", "Sparkles", "#E0C8A8"),
    ("Дети", "Users", "#B8C6A3"),
    ("Прогулки", "Trees", "#AFC7B4"),
]

rate_limiter = InMemoryRateLimiter()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _now_utc() -> datetime:
    return datetime.utcnow()


def _check_rate_limit(request: Request, key_suffix: str, limit: int = 20) -> None:
    key = f"{request.client.host}:{key_suffix}" if request.client else key_suffix
    allowed = rate_limiter.allow(key, limit, 60)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")


def _create_user_project_graph(db: Session, user: User, display_name: str) -> tuple[FamilyProject, Member]:
    project = FamilyProject(name="Наша семья")
    db.add(project)
    db.flush()

    member = Member(
        project_id=project.id,
        user_id=user.id,
        display_name=display_name,
        status=MemberStatus.active,
    )
    db.add(member)

    for name, icon, color in DEFAULT_CATEGORIES:
        db.add(
            Category(
                project_id=project.id,
                name=name,
                icon=icon,
                color=color,
                is_default=True,
            )
        )

    db.flush()
    return project, member


def _issue_refresh_session(
    db: Session,
    user_id: UUID,
    remember_me: bool,
    rotated_from_id: UUID | None = None,
) -> tuple[str, RefreshSession]:
    raw_refresh = generate_opaque_token()
    refresh_days = settings.refresh_ttl_days if remember_me else 1
    refresh = RefreshSession(
        user_id=user_id,
        token_hash=hash_token(raw_refresh),
        expires_at=_now_utc() + timedelta(days=refresh_days),
        remember_me=remember_me,
        rotated_from_id=rotated_from_id,
    )
    db.add(refresh)
    db.flush()
    return raw_refresh, refresh


def _revoke_user_refresh_tokens(db: Session, user_id: UUID) -> None:
    active = (
        db.query(RefreshSession)
        .filter(
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > _now_utc(),
        )
        .all()
    )
    now = _now_utc()
    for item in active:
        item.revoked_at = now
        db.add(item)


def _set_auth_cookies(
    response: Response,
    user: User,
    refresh_token: str,
    remember_me: bool,
    refresh_expires_at: datetime,
) -> None:
    access_token = create_access_token({"sub": str(user.id)}, settings.jwt_secret, settings.access_ttl_minutes)
    csrf_raw = generate_opaque_token()
    csrf_signed = sign_csrf_token(csrf_raw, settings.csrf_secret)
    secure = settings.frontend_url.startswith("https://")

    refresh_seconds = max(int((refresh_expires_at - _now_utc()).total_seconds()), 60)
    refresh_max_age = refresh_seconds if remember_me else None

    response.set_cookie(
        key=settings.access_cookie_name,
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=settings.access_ttl_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=refresh_max_age,
        path="/",
    )
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_signed,
        httponly=False,
        secure=secure,
        samesite="lax",
        max_age=refresh_max_age,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.access_cookie_name, path="/")
    response.delete_cookie(settings.refresh_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


def _build_session_out(user: User, member: Member, project: FamilyProject) -> SessionOut:
    return SessionOut(
        user=AuthUserOut(
            id=user.id,
            display_name=user.display_name,
            email=user.email,
            email_verified=user.email_verified,
            avatar_url=user.avatar_url,
        ),
        project=FamilyProjectOut.model_validate(project, from_attributes=True),
        member=MemberOut.model_validate(member, from_attributes=True),
        email_verified=user.email_verified,
    )


def _issue_email_token(db: Session, user_id: UUID, purpose: EmailTokenPurpose, ttl_hours: int = 24) -> str:
    raw = generate_opaque_token()
    token = EmailToken(
        user_id=user_id,
        purpose=purpose,
        token_hash=hash_token(raw),
        expires_at=_now_utc() + timedelta(hours=ttl_hours),
    )
    db.add(token)
    db.flush()
    return raw


def _build_frontend_url(path: str = "", query: dict[str, str] | None = None) -> str:
    base = settings.frontend_url.rstrip("/")
    target = f"{base}/{path.lstrip('/')}" if path else base
    if not query:
        return target

    parsed = urlsplit(target)
    current_query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    current_query.update({key: value for key, value in query.items() if value})
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(current_query), parsed.fragment))


def _redirect_to_auth_error(error_code: str) -> RedirectResponse:
    redirect = RedirectResponse(url=_build_frontend_url("/auth", {"oauth_error": error_code}))
    redirect.delete_cookie("flc_google_state", path="/")
    return redirect


@router.post("/signup", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupIn, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    email = _normalize_email(payload.email)
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        display_name=payload.display_name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
        email_verified=False,
        auth_provider="local",
    )
    db.add(user)
    db.flush()

    project, member = _create_user_project_graph(db, user, payload.display_name.strip())
    refresh_raw, refresh_session = _issue_refresh_session(db, user.id, payload.remember_me)

    verify_token = _issue_email_token(db, user.id, EmailTokenPurpose.verify_email, ttl_hours=24)

    db.commit()
    if user.email:
        verify_url = _build_frontend_url("/auth/verify", {"token": verify_token})
        send_verify_email(to_email=user.email, display_name=user.display_name, verify_url=verify_url)
    _set_auth_cookies(response, user, refresh_raw, payload.remember_me, refresh_session.expires_at)
    return _build_session_out(user, member, project)


@router.post("/login", response_model=SessionOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    email = _normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    member = db.query(Member).filter(Member.user_id == user.id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No project membership")
    project = db.get(FamilyProject, member.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    refresh_raw, refresh_session = _issue_refresh_session(db, user.id, payload.remember_me)
    db.commit()
    _set_auth_cookies(response, user, refresh_raw, payload.remember_me, refresh_session.expires_at)
    return _build_session_out(user, member, project)


@router.get("/session", response_model=SessionOut)
def read_session(
    user: User = Depends(get_current_user),
    member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
) -> SessionOut:
    return _build_session_out(user, member, project)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    request: Request,
    user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> Response:
    refresh_raw = request.cookies.get(settings.refresh_cookie_name)
    if refresh_raw:
        token_hash = hash_token(refresh_raw)
        existing = db.query(RefreshSession).filter(RefreshSession.token_hash == token_hash).first()
        if existing and existing.revoked_at is None:
            existing.revoked_at = _now_utc()
            db.add(existing)
    if user:
        pass
    db.commit()
    _clear_auth_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/refresh", response_model=SessionOut)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    refresh_raw = request.cookies.get(settings.refresh_cookie_name)
    if not refresh_raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    token_hash = hash_token(refresh_raw)
    session = db.query(RefreshSession).filter(RefreshSession.token_hash == token_hash).first()
    if not session or session.revoked_at is not None or session.expires_at <= _now_utc():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    member = db.query(Member).filter(Member.user_id == user.id).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No project membership")
    project = db.get(FamilyProject, member.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    session.revoked_at = _now_utc()
    db.add(session)
    refresh_raw_new, new_session = _issue_refresh_session(
        db,
        user.id,
        session.remember_me,
        rotated_from_id=session.id,
    )
    db.commit()

    _set_auth_cookies(response, user, refresh_raw_new, session.remember_me, new_session.expires_at)
    return _build_session_out(user, member, project)


@router.post("/verify-email/resend", status_code=status.HTTP_204_NO_CONTENT)
def resend_verify_email(
    payload: VerifyEmailResendIn,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    _check_rate_limit(request, "verify_resend", limit=10)
    email = _normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()
    if user and not user.email_verified:
        verify_token = _issue_email_token(db, user.id, EmailTokenPurpose.verify_email, ttl_hours=24)
        db.commit()
        verify_url = _build_frontend_url("/auth/verify", {"token": verify_token})
        send_verify_email(to_email=user.email, display_name=user.display_name, verify_url=verify_url)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/verify-email/confirm", status_code=status.HTTP_204_NO_CONTENT)
def confirm_verify_email(payload: VerifyEmailConfirmIn, db: Session = Depends(get_db)) -> Response:
    token_hash = hash_token(payload.token)
    row = (
        db.query(EmailToken)
        .filter(
            EmailToken.token_hash == token_hash,
            EmailToken.purpose == EmailTokenPurpose.verify_email,
            EmailToken.used_at.is_(None),
        )
        .first()
    )
    if not row or row.expires_at <= _now_utc():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Token expired or invalid")
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    row.used_at = _now_utc()
    user.email_verified = True
    db.add_all([row, user])
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(payload: PasswordForgotIn, request: Request, db: Session = Depends(get_db)) -> Response:
    _check_rate_limit(request, "password_forgot", limit=10)
    email = _normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()
    if user:
        _issue_email_token(db, user.id, EmailTokenPurpose.password_reset, ttl_hours=1)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: PasswordResetIn, db: Session = Depends(get_db)) -> Response:
    token_hash = hash_token(payload.token)
    row = (
        db.query(EmailToken)
        .filter(
            EmailToken.token_hash == token_hash,
            EmailToken.purpose == EmailTokenPurpose.password_reset,
            EmailToken.used_at.is_(None),
        )
        .first()
    )
    if not row or row.expires_at <= _now_utc():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Token expired or invalid")

    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.password_hash = hash_password(payload.password)
    user.auth_provider = "both" if user.auth_provider == "google" else "local"
    row.used_at = _now_utc()
    _revoke_user_refresh_tokens(db, user.id)
    db.add_all([user, row])
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/google/start")
def google_start() -> RedirectResponse:
    if not settings.google_client_id or not settings.google_redirect_uri:
        return _redirect_to_auth_error("google_not_configured")
    state_raw = generate_opaque_token()
    state_signed = sign_csrf_token(state_raw, settings.csrf_secret)
    secure = settings.frontend_url.startswith("https://")

    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state_signed,
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    redirect = RedirectResponse(url=f"https://accounts.google.com/o/oauth2/v2/auth?{query}")
    redirect.set_cookie(
        key="flc_google_state",
        value=state_signed,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=600,
        path="/",
    )
    return redirect


@router.get("/google/callback")
def google_callback(
    request: Request,
    db: Session = Depends(get_db),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    if not settings.google_client_id or not settings.google_client_secret or not settings.google_redirect_uri:
        return _redirect_to_auth_error("google_not_configured")
    if error:
        return _redirect_to_auth_error("google_access_denied")
    if not code or not state:
        return _redirect_to_auth_error("google_invalid_callback")
    cookie_state = request.cookies.get("flc_google_state")
    if not cookie_state or cookie_state != state:
        return _redirect_to_auth_error("google_invalid_state")

    try:
        with httpx.Client(timeout=10) as client:
            token_res = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            if token_res.status_code >= 400:
                return _redirect_to_auth_error("google_token_exchange_failed")
            token_payload = token_res.json()
            id_token = token_payload.get("id_token")
            if not id_token:
                return _redirect_to_auth_error("google_missing_id_token")

            userinfo_res = client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {token_payload.get('access_token', '')}"},
            )
            if userinfo_res.status_code >= 400:
                return _redirect_to_auth_error("google_userinfo_failed")
            info = userinfo_res.json()
    except httpx.HTTPError:
        return _redirect_to_auth_error("google_network_error")

    email = _normalize_email(info.get("email", ""))
    if not email:
        return _redirect_to_auth_error("google_email_unavailable")
    display_name = (info.get("name") or "Пользователь").strip()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            display_name=display_name,
            email=email,
            password_hash=None,
            email_verified=bool(info.get("email_verified", True)),
            auth_provider="google",
            avatar_url=info.get("picture"),
        )
        db.add(user)
        db.flush()
        _create_user_project_graph(db, user, display_name)
    else:
        if user.auth_provider == "local":
            user.auth_provider = "both"
        elif user.auth_provider != "both":
            user.auth_provider = "google"
        if info.get("email_verified"):
            user.email_verified = True
        if info.get("picture") and not user.avatar_url:
            user.avatar_url = info.get("picture")
        member = db.query(Member).filter(Member.user_id == user.id).first()
        if not member:
            _create_user_project_graph(db, user, user.display_name)

    refresh_raw, refresh_session = _issue_refresh_session(db, user.id, remember_me=True)
    db.commit()

    redirect = RedirectResponse(url=settings.frontend_url)
    _set_auth_cookies(redirect, user, refresh_raw, True, refresh_session.expires_at)
    redirect.delete_cookie("flc_google_state", path="/")
    return redirect


# Optional temporary legacy endpoint.
@router.post("/session", response_model=AuthSessionOut)
def create_session(payload: AuthSessionIn, db: Session = Depends(get_db)) -> AuthSessionOut:
    if not settings.auth_allow_legacy_session:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Legacy session endpoint is disabled")

    if payload.user_id:
        existing = db.get(User, payload.user_id)
        if existing:
            member = db.query(Member).filter(Member.user_id == existing.id).first()
            return AuthSessionOut(
                token=str(existing.id),
                user_id=existing.id,
                project_id=member.project_id,
                member_id=member.id,
            )

    user = User(display_name=payload.display_name)
    db.add(user)
    db.flush()
    project, member = _create_user_project_graph(db, user, payload.display_name)
    db.commit()
    return AuthSessionOut(token=str(user.id), user_id=user.id, project_id=project.id, member_id=member.id)
