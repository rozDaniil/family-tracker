import os
from datetime import UTC, datetime, timedelta
import uuid

os.environ["DATABASE_URL"] = "sqlite:///./test_family_life_calendar.db"

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.db import Base, engine
from app.main import app
from app.models import EmailToken, EmailTokenPurpose, RefreshSession, User
from app.services.security import hash_token

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _email(seed: str) -> str:
    return f"{seed}-{uuid.uuid4()}@example.com"


def _signup_and_auth(seed: str = "user") -> tuple[TestClient, dict[str, str], str]:
    c = TestClient(app)
    email = _email(seed)
    response = c.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "StrongPass123",
            "display_name": "Parent",
        },
    )
    assert response.status_code == 201
    csrf = c.cookies.get("flc_csrf")
    assert csrf
    headers = {"X-CSRF-Token": csrf}
    return c, headers, email


def test_signup_sets_cookies_and_session_unverified() -> None:
    c, _, _ = _signup_and_auth("signup")
    assert c.cookies.get("flc_access")
    assert c.cookies.get("flc_refresh")
    assert c.cookies.get("flc_csrf")

    session = c.get("/api/v1/auth/session")
    assert session.status_code == 200
    assert session.json()["email_verified"] is False


def test_login_and_logout_flow() -> None:
    c, headers, email = _signup_and_auth("login")
    logout = c.post("/api/v1/auth/logout", headers=headers)
    assert logout.status_code == 204

    session_after_logout = c.get("/api/v1/auth/session")
    assert session_after_logout.status_code == 401

    login = c.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123"},
    )
    assert login.status_code == 200
    assert c.cookies.get("flc_access")
    assert c.cookies.get("flc_refresh")


def test_refresh_rotation_invalidates_old_refresh_token() -> None:
    c, _, _ = _signup_and_auth("refresh")
    old_refresh = c.cookies.get("flc_refresh")
    assert old_refresh

    refreshed = c.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200
    new_refresh = c.cookies.get("flc_refresh")
    assert new_refresh and new_refresh != old_refresh

    attacker = TestClient(app)
    attacker.cookies.set("flc_refresh", old_refresh)
    denied = attacker.post("/api/v1/auth/refresh")
    assert denied.status_code == 401


def test_csrf_required_for_mutating_project_endpoints() -> None:
    c, _, _ = _signup_and_auth("csrf")
    no_csrf = c.post("/api/v1/members", json={"display_name": "New member"})
    assert no_csrf.status_code == 403


def test_mutating_with_csrf_works() -> None:
    c, headers, _ = _signup_and_auth("member")
    created = c.post("/api/v1/members", json={"display_name": "Partner"}, headers=headers)
    assert created.status_code == 201
    assert created.json()["display_name"] == "Partner"


def test_create_event_with_cookie_session_and_csrf() -> None:
    c, headers, _ = _signup_and_auth("event")
    categories = c.get("/api/v1/categories")
    assert categories.status_code == 200
    category_id = categories.json()[0]["id"]

    created = c.post(
        "/api/v1/events",
        json={
            "title": "Тестовое событие",
            "category_id": category_id,
            "kind": "NOTE",
            "date_local": datetime.now(UTC).date().isoformat(),
        },
        headers=headers,
    )
    assert created.status_code == 201


def test_verify_email_confirm_marks_user_verified() -> None:
    c, _, email = _signup_and_auth("verify")
    with Session(engine) as db:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        raw = "verify-token-fixed"
        db.add(
            EmailToken(
                user_id=user.id,
                purpose=EmailTokenPurpose.verify_email,
                token_hash=hash_token(raw),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()

    confirmed = c.post("/api/v1/auth/verify-email/confirm", json={"token": "verify-token-fixed"})
    assert confirmed.status_code == 204

    session = c.get("/api/v1/auth/session")
    assert session.status_code == 200
    assert session.json()["email_verified"] is True


def test_password_reset_revokes_all_refresh_sessions() -> None:
    c, _, email = _signup_and_auth("reset")
    # create additional refresh session
    second_refresh = c.post("/api/v1/auth/refresh")
    assert second_refresh.status_code == 200

    with Session(engine) as db:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        raw = "reset-token-fixed"
        db.add(
            EmailToken(
                user_id=user.id,
                purpose=EmailTokenPurpose.password_reset,
                token_hash=hash_token(raw),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        db.commit()

    reset = c.post(
        "/api/v1/auth/password/reset",
        json={"token": "reset-token-fixed", "password": "NewStrongPass123"},
    )
    assert reset.status_code == 204

    with Session(engine) as db:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        active_refresh = (
            db.query(RefreshSession)
            .filter(
                RefreshSession.user_id == user.id,
                RefreshSession.revoked_at.is_(None),
                RefreshSession.expires_at > datetime.now(UTC),
            )
            .all()
        )
        assert len(active_refresh) == 0


def test_profile_change_password_forces_relogin() -> None:
    c, headers, email = _signup_and_auth("profile-change-password")
    changed = c.post(
        "/api/v1/profile/change-password",
        json={"current_password": "StrongPass123", "new_password": "NewStrongPass123"},
        headers=headers,
    )
    assert changed.status_code == 204

    assert c.cookies.get("flc_access") is None
    assert c.cookies.get("flc_refresh") is None
    assert c.cookies.get("flc_csrf") is None

    session_after = c.get("/api/v1/auth/session")
    assert session_after.status_code == 401

    old_login = c.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123"},
    )
    assert old_login.status_code == 401

    new_login = c.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "NewStrongPass123"},
    )
    assert new_login.status_code == 200


def test_google_start_returns_501_without_config() -> None:
    response = client.get("/api/v1/auth/google/start")
    assert response.status_code == 501


def test_profile_patch_and_local_circle_nickname() -> None:
    c, headers, _ = _signup_and_auth("profile")

    added = c.post("/api/v1/members", json={"display_name": "Бабушка"}, headers=headers)
    assert added.status_code == 201
    member_id = added.json()["id"]

    profile_before = c.get("/api/v1/profile")
    assert profile_before.status_code == 200
    assert profile_before.json()["display_name"] == "Parent"

    profile_updated = c.patch(
        "/api/v1/profile",
        json={"display_name": "Родитель", "birthday": "1990-05-10"},
        headers=headers,
    )
    assert profile_updated.status_code == 200
    assert profile_updated.json()["display_name"] == "Родитель"
    assert profile_updated.json()["birthday"] == "1990-05-10"

    circle = c.get("/api/v1/profile/circle")
    assert circle.status_code == 200
    assert any(item["member_id"] == member_id for item in circle.json())

    nick = c.patch(
        f"/api/v1/profile/circle/{member_id}/nickname",
        json={"nickname": "Мама"},
        headers=headers,
    )
    assert nick.status_code == 200
    assert nick.json()["nickname"] == "Мама"


def test_profile_avatar_upload_updates_avatar_url() -> None:
    c, headers, _ = _signup_and_auth("avatar")
    uploaded = c.post(
        "/api/v1/profile/avatar",
        files={"file": ("avatar.png", b"\x89PNG\r\n\x1a\navatar", "image/png")},
        headers=headers,
    )
    assert uploaded.status_code == 200
    body = uploaded.json()
    assert "/uploads/avatars/" in (body["avatar_url"] or "")


def test_signup_does_not_create_default_lens() -> None:
    c, _, _ = _signup_and_auth("nolens")
    lenses = c.get("/api/v1/lenses")
    assert lenses.status_code == 200
    assert lenses.json() == []
