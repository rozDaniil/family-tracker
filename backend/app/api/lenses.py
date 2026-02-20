import json
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_project, get_current_user
from app.core.db import get_db
from app.models import CalendarLens, Event, FamilyProject, LensView, Member, MemberStatus, User
from app.schemas.common import CalendarLensCreateIn, CalendarLensOut, CalendarLensPatchIn
from app.services.live import LiveType, live_broker, make_live_message, project_meta_channel

router = APIRouter(tags=["lenses"])


def _publish_calendar_message(message_type: LiveType, lens: CalendarLensOut) -> None:
    message = make_live_message(
        project_id=lens.project_id,
        calendar_id=lens.id,
        message_type=message_type,
        entity_id=lens.id,
        payload=lens.model_dump(mode="json"),
        updated_at=lens.updated_at,
    )
    live_broker.publish(project_meta_channel(lens.project_id), message)


def _serialize_ids(raw: str | None) -> list[UUID]:
    if not raw:
        return []
    return [UUID(value) for value in json.loads(raw)]


def _dump_ids(values: list[UUID] | None) -> str | None:
    if values is None:
        return None
    return json.dumps([str(value) for value in values], ensure_ascii=False)


def _to_out(lens: CalendarLens) -> CalendarLensOut:
    return CalendarLensOut(
        id=lens.id,
        project_id=lens.project_id,
        name=lens.name,
        view_type=lens.view_type.value,
        range_preset=lens.range_preset,
        category_ids=_serialize_ids(lens.category_ids),
        member_ids=_serialize_ids(lens.member_ids),
        sort_order=lens.sort_order,
        density=lens.density,
        is_default=lens.is_default,
        created_by=lens.created_by,
        created_at=lens.created_at,
        updated_at=lens.updated_at,
    )


def _lens_member_id_set(lens: CalendarLens) -> set[UUID]:
    return set(_serialize_ids(lens.member_ids))


def _member_can_access_lens(lens: CalendarLens, member: Member) -> bool:
    member_ids = _lens_member_id_set(lens)
    if member.id in member_ids:
        return True
    return lens.created_by == member.user_id


def _is_lens_owner(lens: CalendarLens, member: Member) -> bool:
    return lens.created_by == member.user_id


def _assert_lens_access(lens: CalendarLens | None, project_id: UUID, member: Member) -> CalendarLens:
    if not lens or lens.project_id != project_id or not _member_can_access_lens(lens, member):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lens not found")
    return lens


def _active_member_ids(db: Session, project_id: UUID) -> set[UUID]:
    rows = (
        db.query(Member.id)
        .filter(
            Member.project_id == project_id,
            Member.status == MemberStatus.active,
        )
        .all()
    )
    return {row[0] for row in rows}


def _normalize_lens_member_ids(
    db: Session,
    *,
    project_id: UUID,
    requested_ids: list[UUID],
) -> list[UUID]:
    deduped = list(dict.fromkeys(requested_ids))
    available = _active_member_ids(db, project_id)
    for member_id in deduped:
        if member_id not in available:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return deduped


@router.get("/lenses", response_model=list[CalendarLensOut])
def list_lenses(
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> list[CalendarLensOut]:
    lenses = (
        db.query(CalendarLens)
        .filter(CalendarLens.project_id == project.id)
        .order_by(CalendarLens.is_default.desc(), CalendarLens.created_at.asc())
        .all()
    )
    visible = [lens for lens in lenses if _member_can_access_lens(lens, current_member)]
    return [_to_out(lens) for lens in visible]


@router.get("/lenses/{lens_id}", response_model=CalendarLensOut)
def get_lens(
    lens_id: UUID,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> CalendarLensOut:
    lens = _assert_lens_access(db.get(CalendarLens, lens_id), project.id, current_member)
    return _to_out(lens)


@router.post("/lenses", response_model=CalendarLensOut, status_code=status.HTTP_201_CREATED)
def create_lens(
    payload: CalendarLensCreateIn,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarLensOut:
    member_ids = _normalize_lens_member_ids(
        db,
        project_id=project.id,
        requested_ids=payload.member_ids,
    )
    lens = CalendarLens(
        project_id=project.id,
        name=payload.name.strip(),
        view_type=LensView(payload.view_type.value),
        range_preset=payload.range_preset,
        category_ids=_dump_ids(payload.category_ids),
        member_ids=_dump_ids(member_ids),
        sort_order=payload.sort_order,
        density=payload.density,
        is_default=payload.is_default,
        created_by=user.id,
    )
    if payload.is_default:
        db.query(CalendarLens).filter(CalendarLens.project_id == project.id).update({"is_default": False})
    db.add(lens)
    db.commit()
    db.refresh(lens)
    out = _to_out(lens)
    _publish_calendar_message("calendar.updated", out)
    return out


@router.patch("/lenses/{lens_id}", response_model=CalendarLensOut)
def patch_lens(
    lens_id: UUID,
    payload: CalendarLensPatchIn,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarLensOut:
    lens = _assert_lens_access(db.get(CalendarLens, lens_id), project.id, current_member)
    is_owner = lens.created_by == current_user.id

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None and not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only calendar owner can rename this calendar",
        )
    if "is_default" in updates and updates["is_default"]:
        db.query(CalendarLens).filter(CalendarLens.project_id == project.id).update({"is_default": False})

    if "category_ids" in updates:
        updates["category_ids"] = _dump_ids(updates["category_ids"])
    if "member_ids" in updates and updates["member_ids"] is not None:
        member_ids = _normalize_lens_member_ids(
            db,
            project_id=project.id,
            requested_ids=updates["member_ids"],
        )
        if not is_owner:
            before = _lens_member_id_set(lens)
            after = set(member_ids)
            removed_member_ids = before - after
            if removed_member_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only calendar owner can remove members",
                )
        updates["member_ids"] = _dump_ids(member_ids)
    if "view_type" in updates and updates["view_type"] is not None:
        updates["view_type"] = LensView(updates["view_type"].value)

    for key, value in updates.items():
        setattr(lens, key, value)
    db.add(lens)
    db.commit()
    db.refresh(lens)
    out = _to_out(lens)
    _publish_calendar_message("calendar.updated", out)
    return out


@router.delete("/lenses/{lens_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lens(
    lens_id: UUID,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    lens = _assert_lens_access(db.get(CalendarLens, lens_id), project.id, current_member)
    if lens.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only calendar owner can delete this calendar",
        )

    if lens.is_default:
        replacement = (
            db.query(CalendarLens)
            .filter(CalendarLens.project_id == project.id, CalendarLens.id != lens.id)
            .order_by(CalendarLens.created_at.asc())
            .first()
        )
        if replacement:
            replacement.is_default = True
            db.add(replacement)

    # Hide historical events of a removed lens from all feeds.
    db.query(Event).filter(
        Event.project_id == project.id,
        Event.lens_id == lens.id,
        Event.deleted_at.is_(None),
    ).update({"deleted_at": datetime.now(UTC)})

    deleted_at = datetime.now(UTC)
    message = make_live_message(
        project_id=project.id,
        calendar_id=lens.id,
        message_type="calendar.deleted",
        entity_id=lens.id,
        payload={"id": str(lens.id), "project_id": str(project.id)},
        updated_at=deleted_at,
    )
    live_broker.publish(project_meta_channel(project.id), message)

    db.delete(lens)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
