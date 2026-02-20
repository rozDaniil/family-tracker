import os
from datetime import UTC, datetime, timedelta
from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit
import uuid

os.environ["DATABASE_URL"] = "sqlite:///./test_family_life_calendar.db"

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import Base, engine
from app.main import app
from app.models import EmailToken, EmailTokenPurpose, Member, RefreshSession, User
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


def _create_lens(c: TestClient, headers: dict[str, str], name: str = "Live Lens") -> dict:
    response = c.post(
        "/api/v1/lenses",
        json={
            "name": name,
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def _next_live_data(ws) -> dict:
    while True:
        data = ws.receive_json()
        if data["type"] == "system.ping":
            continue
        return data


@contextmanager
def _override_google_oauth(
    client_id: str | None,
    client_secret: str | None,
    redirect_uri: str | None,
):
    old_client_id = settings.google_client_id
    old_client_secret = settings.google_client_secret
    old_redirect_uri = settings.google_redirect_uri
    settings.google_client_id = client_id
    settings.google_client_secret = client_secret
    settings.google_redirect_uri = redirect_uri
    try:
        yield
    finally:
        settings.google_client_id = old_client_id
        settings.google_client_secret = old_client_secret
        settings.google_redirect_uri = old_redirect_uri


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
    created = c.post(
        "/api/v1/lenses",
        json={
            "name": "CSRF lens",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=headers,
    )
    assert created.status_code == 201
    assert created.json()["name"] == "CSRF lens"


def test_direct_member_creation_is_forbidden_even_with_csrf() -> None:
    c, headers, _ = _signup_and_auth("member-forbidden")
    created = c.post("/api/v1/members", json={"display_name": "Partner"}, headers=headers)
    assert created.status_code == 403
    assert created.json()["detail"] == "Members can only be added via invite acceptance"


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


def test_google_start_redirects_to_auth_when_not_configured() -> None:
    with _override_google_oauth(None, None, None):
        response = client.get("/api/v1/auth/google/start", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith(f"{settings.frontend_url.rstrip('/')}/auth")
    assert "oauth_error=google_not_configured" in response.headers["location"]


def test_google_start_redirects_to_google_when_configured() -> None:
    with _override_google_oauth(
        "test-client-id.apps.googleusercontent.com",
        "test-client-secret",
        "http://localhost:8000/api/v1/auth/google/callback",
    ):
        response = client.get("/api/v1/auth/google/start", follow_redirects=False)

    assert response.status_code == 307
    location = response.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    query = parse_qs(urlsplit(location).query)
    assert query.get("client_id") == ["test-client-id.apps.googleusercontent.com"]
    assert query.get("redirect_uri") == ["http://localhost:8000/api/v1/auth/google/callback"]
    assert "flc_google_state=" in response.headers.get("set-cookie", "")


def test_google_callback_redirects_to_auth_on_provider_error() -> None:
    with _override_google_oauth(
        "test-client-id.apps.googleusercontent.com",
        "test-client-secret",
        "http://localhost:8000/api/v1/auth/google/callback",
    ):
        response = client.get("/api/v1/auth/google/callback?error=access_denied", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith(f"{settings.frontend_url.rstrip('/')}/auth")
    assert "oauth_error=google_access_denied" in response.headers["location"]


def test_live_ws_rejects_unauthenticated() -> None:
    anonymous = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with anonymous.websocket_connect("/api/v1/live/ws"):
            pass
    assert exc.value.code == 4401


def test_live_ws_rejects_foreign_calendar_subscription() -> None:
    owner, owner_headers, _ = _signup_and_auth("live-owner")
    owner_lens = _create_lens(owner, owner_headers, name="Owner Lens")
    stranger, _, _ = _signup_and_auth("live-stranger")

    with pytest.raises(WebSocketDisconnect) as exc:
        with stranger.websocket_connect(f"/api/v1/live/ws?calendar_id={owner_lens['id']}"):
            pass
    assert exc.value.code == 4403


def test_live_ws_rejects_private_calendar_for_same_project_member() -> None:
    owner, owner_headers, _ = _signup_and_auth("live-private-owner")
    owner_session = owner.get("/api/v1/auth/session")
    assert owner_session.status_code == 200
    owner_member_id = owner_session.json()["member"]["id"]

    invite = owner.post(
        "/api/v1/invites/link",
        json={"expires_in_hours": 24},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    token = parse_qs(urlsplit(invite.json()["invite_url"]).query).get("token", [""])[0]
    guest = TestClient(app)
    accepted = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Guest"})
    assert accepted.status_code == 200

    private_lens = owner.post(
        "/api/v1/lenses",
        json={
            "name": "Private lens",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [owner_member_id],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=owner_headers,
    )
    assert private_lens.status_code == 201
    lens_id = private_lens.json()["id"]

    with pytest.raises(WebSocketDisconnect) as exc:
        with guest.websocket_connect(f"/api/v1/live/ws?calendar_id={lens_id}"):
            pass
    assert exc.value.code == 4403


def test_live_ws_receives_event_lifecycle_updates() -> None:
    c, headers, _ = _signup_and_auth("live-events")
    lens = _create_lens(c, headers, name="Live Events Lens")
    today = datetime.now(UTC).date().isoformat()

    with c.websocket_connect(f"/api/v1/live/ws?calendar_id={lens['id']}") as ws:
        connected = _next_live_data(ws)
        assert connected["type"] == "system.connected"

        created = c.post(
            "/api/v1/events",
            json={
                "title": "Live event",
                "description": "From websocket test",
                "lens_id": lens["id"],
                "kind": "NOTE",
                "date_local": today,
            },
            headers=headers,
        )
        assert created.status_code == 201
        created_event = created.json()
        msg_created = _next_live_data(ws)
        assert msg_created["type"] == "event.created"
        assert msg_created["entityId"] == created_event["id"]
        assert msg_created["calendarId"] == lens["id"]

        patched = c.patch(
            f"/api/v1/events/{created_event['id']}",
            json={"title": "Live event updated"},
            headers=headers,
        )
        assert patched.status_code == 200
        msg_updated = _next_live_data(ws)
        assert msg_updated["type"] == "event.updated"
        assert msg_updated["entityId"] == created_event["id"]

        started = c.post(f"/api/v1/events/{created_event['id']}/start", headers=headers)
        assert started.status_code == 200
        msg_started = _next_live_data(ws)
        assert msg_started["type"] == "event.started"
        assert msg_started["entityId"] == created_event["id"]

        stopped = c.post(f"/api/v1/events/{created_event['id']}/stop", headers=headers)
        assert stopped.status_code == 200
        msg_stopped = _next_live_data(ws)
        assert msg_stopped["type"] == "event.stopped"
        assert msg_stopped["entityId"] == created_event["id"]

        deleted = c.delete(f"/api/v1/events/{created_event['id']}", headers=headers)
        assert deleted.status_code == 204
        msg_deleted = _next_live_data(ws)
        assert msg_deleted["type"] == "event.deleted"
        assert msg_deleted["entityId"] == created_event["id"]


def test_live_ws_receives_calendar_and_member_changes() -> None:
    c, headers, _ = _signup_and_auth("live-meta")
    lens = _create_lens(c, headers, name="Meta Lens")

    with c.websocket_connect(f"/api/v1/live/ws?calendar_id={lens['id']}") as ws:
        connected = _next_live_data(ws)
        assert connected["type"] == "system.connected"

        renamed = c.patch(
            f"/api/v1/lenses/{lens['id']}",
            json={"name": "Meta Lens Renamed"},
            headers=headers,
        )
        assert renamed.status_code == 200
        msg_calendar = _next_live_data(ws)
        assert msg_calendar["type"] == "calendar.updated"
        assert msg_calendar["entityId"] == lens["id"]

        invite = c.post(
            "/api/v1/invites/link",
            json={"expires_in_hours": 24},
            headers=headers,
        )
        assert invite.status_code == 200
        token = parse_qs(urlsplit(invite.json()["invite_url"]).query).get("token", [""])[0]
        assert token

        guest = TestClient(app)
        member = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Live Member"})
        assert member.status_code == 200
        msg_member = _next_live_data(ws)
        assert msg_member["type"] == "member.changed"
        assert msg_member["entityId"] == member.json()["member"]["id"]


def test_invite_link_and_accept_creates_cookie_session() -> None:
    c, headers, _ = _signup_and_auth("invite-session")
    created = c.post(
        "/api/v1/invites/link",
        json={"expires_in_hours": 24, "recipient_email": "guest@example.com"},
        headers=headers,
    )
    assert created.status_code == 200
    invite_url = created.json()["invite_url"]
    assert invite_url.startswith(f"{settings.frontend_url.rstrip('/')}/auth/invite?token=")
    token = parse_qs(urlsplit(invite_url).query).get("token", [""])[0]
    assert token

    guest = TestClient(app)
    accepted = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Guest"})
    assert accepted.status_code == 200
    body = accepted.json()
    assert body["project"]["id"]
    assert body["member"]["id"]
    assert body["user"]["display_name"] == "Guest"
    assert guest.cookies.get("flc_access")
    assert guest.cookies.get("flc_refresh")
    assert guest.cookies.get("flc_csrf")


def test_pending_invites_visible_until_accept() -> None:
    c, headers, _ = _signup_and_auth("pending-invite")
    created = c.post(
        "/api/v1/invites/link",
        json={"recipient_email": "pending@example.com", "recipient_name": "Ожидаем"},
        headers=headers,
    )
    assert created.status_code == 200
    token = parse_qs(urlsplit(created.json()["invite_url"]).query).get("token", [""])[0]
    assert token

    pending = c.get("/api/v1/invites/pending")
    assert pending.status_code == 200
    body = pending.json()
    assert len(body) == 1
    assert body[0]["recipient_email"] == "pending@example.com"
    assert body[0]["display_name"] == "Ожидаем"
    assert body[0]["is_expired"] is False

    guest = TestClient(app)
    accepted = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Guest"})
    assert accepted.status_code == 200

    pending_after = c.get("/api/v1/invites/pending")
    assert pending_after.status_code == 200
    assert pending_after.json() == []


def test_invite_email_validation_rejects_invalid_email() -> None:
    c, headers, _ = _signup_and_auth("invite-email-validate")
    created = c.post(
        "/api/v1/invites/link",
        json={"recipient_email": "bad-email"},
        headers=headers,
    )
    assert created.status_code == 422
    assert created.json()["detail"] == "Invalid recipient email"


def test_lens_visibility_scoped_by_member_ids() -> None:
    owner, owner_headers, _ = _signup_and_auth("lens-scope-owner")
    owner_session = owner.get("/api/v1/auth/session")
    assert owner_session.status_code == 200
    owner_member_id = owner_session.json()["member"]["id"]

    invite = owner.post(
        "/api/v1/invites/link",
        json={"expires_in_hours": 24},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    token = parse_qs(urlsplit(invite.json()["invite_url"]).query).get("token", [""])[0]
    guest = TestClient(app)
    accepted = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Guest"})
    assert accepted.status_code == 200

    created_lens = owner.post(
        "/api/v1/lenses",
        json={
            "name": "Private Lens",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [owner_member_id],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=owner_headers,
    )
    assert created_lens.status_code == 201
    lens_id = created_lens.json()["id"]

    guest_lenses = guest.get("/api/v1/lenses")
    assert guest_lenses.status_code == 200
    assert all(item["id"] != lens_id for item in guest_lenses.json())


def test_events_list_hides_private_lens_events_from_other_members() -> None:
    owner, owner_headers, _ = _signup_and_auth("event-scope-owner")
    owner_session = owner.get("/api/v1/auth/session")
    assert owner_session.status_code == 200
    owner_member_id = owner_session.json()["member"]["id"]

    invite = owner.post(
        "/api/v1/invites/link",
        json={"expires_in_hours": 24},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    token = parse_qs(urlsplit(invite.json()["invite_url"]).query).get("token", [""])[0]
    guest = TestClient(app)
    accepted = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Guest"})
    assert accepted.status_code == 200

    lens = owner.post(
        "/api/v1/lenses",
        json={
            "name": "Owner only",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [owner_member_id],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=owner_headers,
    )
    assert lens.status_code == 201
    lens_id = lens.json()["id"]

    today = datetime.now(UTC).date().isoformat()
    created = owner.post(
        "/api/v1/events",
        json={
            "title": "Private event",
            "lens_id": lens_id,
            "kind": "NOTE",
            "date_local": today,
        },
        headers=owner_headers,
    )
    assert created.status_code == 201
    event_id = created.json()["id"]

    guest_events = guest.get(f"/api/v1/events?from={today}&to={today}")
    assert guest_events.status_code == 200
    assert all(item["id"] != event_id for item in guest_events.json())


def test_profile_patch_and_local_circle_nickname() -> None:
    c, headers, _ = _signup_and_auth("profile")

    invite = c.post(
        "/api/v1/invites/link",
        json={"expires_in_hours": 24},
        headers=headers,
    )
    assert invite.status_code == 200
    token = parse_qs(urlsplit(invite.json()["invite_url"]).query).get("token", [""])[0]
    assert token

    guest = TestClient(app)
    added = guest.post("/api/v1/invites/accept", json={"token": token, "display_name": "Бабушка"})
    assert added.status_code == 200
    member_id = added.json()["member"]["id"]

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


def test_lens_patch_owner_permissions_for_rename_and_member_removal() -> None:
    owner, owner_headers, _ = _signup_and_auth("lens-owner-rules")
    owner_session = owner.get("/api/v1/auth/session")
    assert owner_session.status_code == 200
    owner_member_id = owner_session.json()["member"]["id"]

    invite_guest = owner.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=owner_headers)
    assert invite_guest.status_code == 200
    guest_token = parse_qs(urlsplit(invite_guest.json()["invite_url"]).query).get("token", [""])[0]
    guest = TestClient(app)
    guest_accept = guest.post("/api/v1/invites/accept", json={"token": guest_token, "display_name": "Guest"})
    assert guest_accept.status_code == 200
    guest_member_id = guest_accept.json()["member"]["id"]

    invite_extra = owner.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=owner_headers)
    assert invite_extra.status_code == 200
    extra_token = parse_qs(urlsplit(invite_extra.json()["invite_url"]).query).get("token", [""])[0]
    extra = TestClient(app)
    extra_accept = extra.post("/api/v1/invites/accept", json={"token": extra_token, "display_name": "Extra"})
    assert extra_accept.status_code == 200
    extra_member_id = extra_accept.json()["member"]["id"]

    created_lens = owner.post(
        "/api/v1/lenses",
        json={
            "name": "Shared Lens",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [owner_member_id, guest_member_id],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=owner_headers,
    )
    assert created_lens.status_code == 201
    lens_id = created_lens.json()["id"]

    guest_csrf = guest.cookies.get("flc_csrf")
    assert guest_csrf
    guest_headers = {"X-CSRF-Token": guest_csrf}

    rename_attempt = guest.patch(
        f"/api/v1/lenses/{lens_id}",
        json={"name": "Guest rename"},
        headers=guest_headers,
    )
    assert rename_attempt.status_code == 403
    assert rename_attempt.json()["detail"] == "Only calendar owner can rename this calendar"

    remove_attempt = guest.patch(
        f"/api/v1/lenses/{lens_id}",
        json={"member_ids": [owner_member_id]},
        headers=guest_headers,
    )
    assert remove_attempt.status_code == 403
    assert remove_attempt.json()["detail"] == "Only calendar owner can remove members"

    add_attempt = guest.patch(
        f"/api/v1/lenses/{lens_id}",
        json={"member_ids": [owner_member_id, guest_member_id, extra_member_id]},
        headers=guest_headers,
    )
    assert add_attempt.status_code == 200
    assert set(add_attempt.json()["member_ids"]) == {owner_member_id, guest_member_id, extra_member_id}


def test_invited_member_can_send_invites_and_invited_by_is_stored() -> None:
    owner, owner_headers, _ = _signup_and_auth("invite-by-member-owner")

    invite_guest = owner.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=owner_headers)
    assert invite_guest.status_code == 200
    guest_token = parse_qs(urlsplit(invite_guest.json()["invite_url"]).query).get("token", [""])[0]
    guest = TestClient(app)
    guest_accept = guest.post("/api/v1/invites/accept", json={"token": guest_token, "display_name": "Guest"})
    assert guest_accept.status_code == 200
    guest_user_id = guest_accept.json()["user"]["id"]

    guest_csrf = guest.cookies.get("flc_csrf")
    assert guest_csrf
    guest_headers = {"X-CSRF-Token": guest_csrf}

    invite_from_guest = guest.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=guest_headers)
    assert invite_from_guest.status_code == 200
    member_token = parse_qs(urlsplit(invite_from_guest.json()["invite_url"]).query).get("token", [""])[0]
    newcomer = TestClient(app)
    newcomer_accept = newcomer.post("/api/v1/invites/accept", json={"token": member_token, "display_name": "Newcomer"})
    assert newcomer_accept.status_code == 200
    newcomer_member_id = newcomer_accept.json()["member"]["id"]

    with Session(engine) as db:
        member = db.get(Member, uuid.UUID(newcomer_member_id))
        assert member is not None
        assert str(member.invited_by) == guest_user_id


def test_invite_link_rate_limited_per_user() -> None:
    c, headers, _ = _signup_and_auth("invite-rate-per-user")
    old_limit = settings.invite_rate_limit_per_minute
    settings.invite_rate_limit_per_minute = 1
    try:
        first = c.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=headers)
        assert first.status_code == 200
        second = c.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=headers)
        assert second.status_code == 429
        assert second.json()["detail"] == "Too many requests"
    finally:
        settings.invite_rate_limit_per_minute = old_limit


def test_lens_delete_is_owner_only() -> None:
    owner, owner_headers, _ = _signup_and_auth("lens-delete-owner")
    owner_session = owner.get("/api/v1/auth/session")
    assert owner_session.status_code == 200
    owner_member_id = owner_session.json()["member"]["id"]

    invite_guest = owner.post("/api/v1/invites/link", json={"expires_in_hours": 24}, headers=owner_headers)
    assert invite_guest.status_code == 200
    guest_token = parse_qs(urlsplit(invite_guest.json()["invite_url"]).query).get("token", [""])[0]
    guest = TestClient(app)
    guest_accept = guest.post("/api/v1/invites/accept", json={"token": guest_token, "display_name": "Guest"})
    assert guest_accept.status_code == 200
    guest_member_id = guest_accept.json()["member"]["id"]

    created_lens = owner.post(
        "/api/v1/lenses",
        json={
            "name": "Owner Delete Lens",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [],
            "member_ids": [owner_member_id, guest_member_id],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=owner_headers,
    )
    assert created_lens.status_code == 201
    lens_id = created_lens.json()["id"]

    guest_csrf = guest.cookies.get("flc_csrf")
    assert guest_csrf
    guest_headers = {"X-CSRF-Token": guest_csrf}

    denied = guest.delete(f"/api/v1/lenses/{lens_id}", headers=guest_headers)
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Only calendar owner can delete this calendar"
