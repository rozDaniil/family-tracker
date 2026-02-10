import os
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite:///./test_family_life_calendar.db"

from fastapi.testclient import TestClient

from app.core.db import Base, engine
from app.main import app

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
client = TestClient(app)


def _auth_headers(display_name: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/session", json={"display_name": display_name})
    assert response.status_code == 200
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_event_without_time_is_supported() -> None:
    headers = _auth_headers("Parent A")
    categories = client.get("/api/v1/categories", headers=headers).json()
    category_id = categories[0]["id"]

    payload = {
        "title": "Спокойный вечер дома",
        "category_id": category_id,
        "kind": "NOTE",
        "date_local": str(date.today()),
    }
    response = client.post("/api/v1/events", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["start_at"] is None
    assert data["end_at"] is None
    assert data["date_local"] == data["end_date_local"]


def test_multi_day_event_supported_and_range_intersection_works() -> None:
    headers = _auth_headers("Parent A2")
    categories = client.get("/api/v1/categories", headers=headers).json()
    category_id = categories[0]["id"]

    response = client.post(
        "/api/v1/events",
        json={
            "title": "Ребенок у бабушки",
            "category_id": category_id,
            "kind": "RANGE",
            "date_local": "2026-02-07",
            "start_at": "2026-02-07T10:30:00Z",
            "end_at": "2026-02-08T15:00:00Z",
        },
        headers=headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["date_local"] == "2026-02-07"
    assert data["end_date_local"] == "2026-02-08"

    in_first_day = client.get("/api/v1/events?from=2026-02-07&to=2026-02-07", headers=headers)
    assert in_first_day.status_code == 200
    assert any(item["id"] == data["id"] for item in in_first_day.json())

    in_second_day = client.get("/api/v1/events?from=2026-02-08&to=2026-02-08", headers=headers)
    assert in_second_day.status_code == 200
    assert any(item["id"] == data["id"] for item in in_second_day.json())

    outside_range = client.get("/api/v1/events?from=2026-02-09&to=2026-02-09", headers=headers)
    assert outside_range.status_code == 200
    assert all(item["id"] != data["id"] for item in outside_range.json())


def test_patch_event_updates_multi_day_range() -> None:
    headers = _auth_headers("Parent A3")
    category_id = client.get("/api/v1/categories", headers=headers).json()[0]["id"]
    created = client.post(
        "/api/v1/events",
        json={
            "title": "Ночевка",
            "category_id": category_id,
            "kind": "NOTE",
            "date_local": "2026-02-07",
        },
        headers=headers,
    )
    assert created.status_code == 201
    event_id = created.json()["id"]

    patched = client.patch(
        f"/api/v1/events/{event_id}",
        json={
            "date_local": "2026-02-07",
            "end_date_local": "2026-02-09",
        },
        headers=headers,
    )
    assert patched.status_code == 200
    assert patched.json()["end_date_local"] == "2026-02-09"


def test_invalid_event_range_rejected() -> None:
    headers = _auth_headers("Parent A4")
    category_id = client.get("/api/v1/categories", headers=headers).json()[0]["id"]
    response = client.post(
        "/api/v1/events",
        json={
            "title": "Ошибка диапазона",
            "category_id": category_id,
            "kind": "RANGE",
            "date_local": "2026-02-08",
            "end_date_local": "2026-02-07",
        },
        headers=headers,
    )
    assert response.status_code == 422


def test_multiple_active_events_allowed_for_same_member() -> None:
    headers = _auth_headers("Parent B")
    categories = client.get("/api/v1/categories", headers=headers).json()
    category_id = categories[0]["id"]
    members = client.get("/api/v1/members", headers=headers).json()
    member_id = members[0]["id"]

    first = client.post(
        "/api/v1/events",
        json={
            "title": "Прогулка",
            "category_id": category_id,
            "member_id": member_id,
            "kind": "ACTIVE",
            "date_local": str(date.today()),
        },
        headers=headers,
    )
    second = client.post(
        "/api/v1/events",
        json={
            "title": "Готовка",
            "category_id": category_id,
            "member_id": member_id,
            "kind": "ACTIVE",
            "date_local": str(date.today()),
        },
        headers=headers,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["is_active"] is True
    assert second.json()["is_active"] is True

    stop_response = client.post(f"/api/v1/events/{first.json()['id']}/stop", headers=headers)
    assert stop_response.status_code == 200
    assert stop_response.json()["is_active"] is False


def test_event_range_limited_to_90_days() -> None:
    headers = _auth_headers("Parent C")
    from_date = date.today() - timedelta(days=100)
    to_date = date.today()
    response = client.get(f"/api/v1/events?from={from_date}&to={to_date}", headers=headers)
    assert response.status_code == 422


def test_project_membership_enforced() -> None:
    headers_a = _auth_headers("Parent D")
    headers_b = _auth_headers("Parent E")

    category_id = client.get("/api/v1/categories", headers=headers_a).json()[0]["id"]
    event_response = client.post(
        "/api/v1/events",
        json={
            "title": "Семейный ужин",
            "category_id": category_id,
            "kind": "NOTE",
            "date_local": str(date.today()),
        },
        headers=headers_a,
    )
    assert event_response.status_code == 201
    event_id = event_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/events/{event_id}",
        json={"title": "Попытка редактирования"},
        headers=headers_b,
    )
    assert patch_response.status_code == 404


def test_lenses_can_be_created_and_filtered() -> None:
    headers = _auth_headers("Parent F")
    categories = client.get("/api/v1/categories", headers=headers).json()
    category_id = categories[0]["id"]
    member_id = client.get("/api/v1/members", headers=headers).json()[0]["id"]

    create_lens = client.post(
        "/api/v1/lenses",
        json={
            "name": "Ребенок",
            "view_type": "week",
            "range_preset": "week",
            "category_ids": [category_id],
            "member_ids": [member_id],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": True,
        },
        headers=headers,
    )
    assert create_lens.status_code == 201
    lens_data = create_lens.json()
    assert lens_data["name"] == "Ребенок"
    assert lens_data["category_ids"] == [category_id]

    list_lenses = client.get("/api/v1/lenses", headers=headers)
    assert list_lenses.status_code == 200
    assert len(list_lenses.json()) >= 1

    get_lens = client.get(f"/api/v1/lenses/{lens_data['id']}", headers=headers)
    assert get_lens.status_code == 200
    assert get_lens.json()["id"] == lens_data["id"]

    delete_lens = client.delete(f"/api/v1/lenses/{lens_data['id']}", headers=headers)
    assert delete_lens.status_code == 204


def test_deleting_default_lens_reassigns_default() -> None:
    headers = _auth_headers("Parent F2")
    categories = client.get("/api/v1/categories", headers=headers).json()
    category_id = categories[0]["id"]

    created = client.post(
        "/api/v1/lenses",
        json={
            "name": "Второй",
            "view_type": "month",
            "range_preset": "month",
            "category_ids": [category_id],
            "member_ids": [],
            "sort_order": "recent",
            "density": "comfortable",
            "is_default": False,
        },
        headers=headers,
    )
    assert created.status_code == 201

    lenses_before = client.get("/api/v1/lenses", headers=headers).json()
    default_before = next(item for item in lenses_before if item["is_default"])
    delete_default = client.delete(f"/api/v1/lenses/{default_before['id']}", headers=headers)
    assert delete_default.status_code == 204

    lenses_after = client.get("/api/v1/lenses", headers=headers).json()
    defaults_after = [item for item in lenses_after if item["is_default"]]
    assert len(defaults_after) == 1


def test_lens_delete_does_not_delete_events() -> None:
    headers = _auth_headers("Parent H")
    category_id = client.get("/api/v1/categories", headers=headers).json()[0]["id"]
    create_event = client.post(
        "/api/v1/events",
        json={
            "title": "Останется после удаления линзы",
            "category_id": category_id,
            "kind": "NOTE",
            "date_local": "2026-02-07",
        },
        headers=headers,
    )
    assert create_event.status_code == 201
    event_id = create_event.json()["id"]

    create_lens = client.post(
        "/api/v1/lenses",
        json={
            "name": "Временная линза",
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
    assert create_lens.status_code == 201
    delete_lens = client.delete(f"/api/v1/lenses/{create_lens.json()['id']}", headers=headers)
    assert delete_lens.status_code == 204

    events = client.get("/api/v1/events?from=2026-02-07&to=2026-02-07", headers=headers)
    assert events.status_code == 200
    assert any(item["id"] == event_id for item in events.json())


def test_last_lens_can_be_deleted() -> None:
    headers = _auth_headers("Parent I")
    lenses = client.get("/api/v1/lenses", headers=headers).json()
    assert len(lenses) == 1
    response = client.delete(f"/api/v1/lenses/{lenses[0]['id']}", headers=headers)
    assert response.status_code == 204


def test_member_can_be_added_directly() -> None:
    headers = _auth_headers("Parent G")
    create_member = client.post("/api/v1/members", json={"display_name": "Partner"}, headers=headers)
    assert create_member.status_code == 201
    assert create_member.json()["display_name"] == "Partner"


def test_immutable_base_categories_cannot_be_archived_or_deleted() -> None:
    headers = _auth_headers("Parent J")
    categories = client.get("/api/v1/categories", headers=headers).json()
    immutable_names = {"Дом", "Быт", "Дети", "Прогулки"}
    immutable = next(item for item in categories if item["name"] in immutable_names)

    patch_response = client.patch(
        f"/api/v1/categories/{immutable['id']}",
        json={"is_archived": True},
        headers=headers,
    )
    assert patch_response.status_code == 409

    delete_response = client.delete(f"/api/v1/categories/{immutable['id']}", headers=headers)
    assert delete_response.status_code == 409


def test_non_base_category_can_be_archived_and_deleted() -> None:
    headers = _auth_headers("Parent K")
    created = client.post(
        "/api/v1/categories",
        json={"name": "Разное", "icon": "NotebookText", "color": "#C8B7AA"},
        headers=headers,
    )
    assert created.status_code == 201
    category_id = created.json()["id"]

    patch_response = client.patch(
        f"/api/v1/categories/{category_id}",
        json={"is_archived": True},
        headers=headers,
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["is_archived"] is True

    delete_response = client.delete(f"/api/v1/categories/{category_id}", headers=headers)
    assert delete_response.status_code == 204


def test_create_event_without_category_is_supported() -> None:
    headers = _auth_headers("Parent L")
    response = client.post(
        "/api/v1/events",
        json={
            "title": "Без категории",
            "kind": "NOTE",
            "date_local": str(date.today()),
        },
        headers=headers,
    )
    assert response.status_code == 201
    assert response.json()["category_id"] is None


def test_patch_event_category_to_null_is_supported() -> None:
    headers = _auth_headers("Parent M")
    category_id = client.get("/api/v1/categories", headers=headers).json()[0]["id"]
    created = client.post(
        "/api/v1/events",
        json={
            "title": "Событие с категорией",
            "kind": "NOTE",
            "date_local": str(date.today()),
            "category_id": category_id,
        },
        headers=headers,
    )
    assert created.status_code == 201
    event_id = created.json()["id"]

    patched = client.patch(
        f"/api/v1/events/{event_id}",
        json={"category_id": None},
        headers=headers,
    )
    assert patched.status_code == 200
    assert patched.json()["category_id"] is None


def test_events_are_isolated_by_lens_and_main_query_sees_all() -> None:
    headers = _auth_headers("Parent N")
    created_a = client.post(
        "/api/v1/lenses",
        json={
            "name": "Календарь A",
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
    created_b = client.post(
        "/api/v1/lenses",
        json={
            "name": "Календарь B",
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
    assert created_a.status_code == 201
    assert created_b.status_code == 201
    lens_a = created_a.json()["id"]
    lens_b = created_b.json()["id"]

    event_a = client.post(
        "/api/v1/events",
        json={
            "title": "Событие A",
            "kind": "NOTE",
            "date_local": "2026-02-07",
            "lens_id": lens_a,
        },
        headers=headers,
    )
    event_b = client.post(
        "/api/v1/events",
        json={
            "title": "Событие B",
            "kind": "NOTE",
            "date_local": "2026-02-07",
            "lens_id": lens_b,
        },
        headers=headers,
    )
    assert event_a.status_code == 201
    assert event_b.status_code == 201
    id_a = event_a.json()["id"]
    id_b = event_b.json()["id"]

    only_a = client.get(f"/api/v1/events?from=2026-02-07&to=2026-02-07&lens_id={lens_a}", headers=headers)
    assert only_a.status_code == 200
    assert {item["id"] for item in only_a.json()} == {id_a}

    only_b = client.get(f"/api/v1/events?from=2026-02-07&to=2026-02-07&lens_id={lens_b}", headers=headers)
    assert only_b.status_code == 200
    assert {item["id"] for item in only_b.json()} == {id_b}

    all_events = client.get("/api/v1/events?from=2026-02-07&to=2026-02-07", headers=headers)
    assert all_events.status_code == 200
    assert {item["id"] for item in all_events.json()} >= {id_a, id_b}


def test_events_from_deleted_lens_are_not_returned_in_main_feed() -> None:
    headers = _auth_headers("Parent O")
    created_lens = client.post(
        "/api/v1/lenses",
        json={
            "name": "Удаляемый календарь",
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
    assert created_lens.status_code == 201
    lens_id = created_lens.json()["id"]

    created_event = client.post(
        "/api/v1/events",
        json={
            "title": "Старое событие удаленного календаря",
            "kind": "NOTE",
            "date_local": "2026-02-11",
            "lens_id": lens_id,
        },
        headers=headers,
    )
    assert created_event.status_code == 201
    event_id = created_event.json()["id"]

    deleted = client.delete(f"/api/v1/lenses/{lens_id}", headers=headers)
    assert deleted.status_code == 204

    listed = client.get("/api/v1/events?from=2026-02-11&to=2026-02-11", headers=headers)
    assert listed.status_code == 200
    assert all(item["id"] != event_id for item in listed.json())
