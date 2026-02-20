import json
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_current_project, get_current_user
from app.core.db import get_db
from app.models import CalendarLens, Category, Event, EventComment, EventKind, FamilyProject, Member, User
from app.schemas.common import EventCommentCreateIn, EventCommentOut, EventCreateIn, EventOut, EventPatchIn
from app.services.live import LiveType, calendar_channel, live_broker, make_live_message, project_events_channel

router = APIRouter(tags=["events"])


def _publish_event_message(message_type: LiveType, event_out: EventOut) -> None:
    message = make_live_message(
        project_id=event_out.project_id,
        calendar_id=event_out.lens_id,
        message_type=message_type,
        entity_id=event_out.id,
        payload=event_out.model_dump(mode="json"),
        updated_at=event_out.updated_at,
    )
    if event_out.lens_id is None:
        live_broker.publish(project_events_channel(event_out.project_id), message)
    else:
        live_broker.publish(calendar_channel(event_out.lens_id), message)


def _publish_event_deleted(event: Event) -> None:
    updated_at = event.deleted_at or datetime.now(UTC)
    message = make_live_message(
        project_id=event.project_id,
        calendar_id=event.lens_id,
        message_type="event.deleted",
        entity_id=event.id,
        payload={
            "id": str(event.id),
            "project_id": str(event.project_id),
            "lens_id": str(event.lens_id) if event.lens_id else None,
            "deleted_at": updated_at.isoformat(),
        },
        updated_at=updated_at,
    )
    if event.lens_id is None:
        live_broker.publish(project_events_channel(event.project_id), message)
    else:
        live_broker.publish(calendar_channel(event.lens_id), message)


def _to_out(event: Event) -> EventOut:
    member_ids = []
    if event.member_ids:
        member_ids = [UUID(value) for value in json.loads(event.member_ids)]
    elif event.member_id:
        member_ids = [event.member_id]
    return EventOut(
        id=event.id,
        project_id=event.project_id,
        title=event.title,
        description=event.description,
        category_id=event.category_id,
        lens_id=event.lens_id,
        member_id=event.member_id,
        member_ids=member_ids,
        kind=event.kind,
        date_local=event.date_local,
        end_date_local=event.end_date_local,
        start_at=event.start_at,
        end_at=event.end_at,
        is_active=event.is_active,
        created_by=event.created_by,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


def _validate_range(start_at: datetime | None, end_at: datetime | None) -> None:
    if start_at and end_at and end_at < start_at:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="end_at must be >= start_at")


def _validate_date_range(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date_local must be >= date_local",
        )


def _verify_category(db: Session, project_id: UUID, category_id: UUID) -> None:
    category = db.get(Category, category_id)
    if not category or category.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")


def _verify_member(db: Session, project_id: UUID, member_id: UUID | None) -> None:
    if not member_id:
        return
    member = db.get(Member, member_id)
    if not member or member.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")


def _verify_members(db: Session, project_id: UUID, member_ids: list[UUID]) -> None:
    for member_id in member_ids:
        _verify_member(db, project_id, member_id)


def _lens_member_id_set(lens: CalendarLens) -> set[UUID]:
    if not lens.member_ids:
        return set()
    return {UUID(value) for value in json.loads(lens.member_ids)}


def _member_can_access_lens(lens: CalendarLens, member: Member) -> bool:
    lens_member_ids = _lens_member_id_set(lens)
    if member.id in lens_member_ids:
        return True
    return lens.created_by == member.user_id


def _verify_lens(db: Session, project_id: UUID, lens_id: UUID | None, member: Member) -> None:
    if lens_id is None:
        return
    lens = db.get(CalendarLens, lens_id)
    if not lens or lens.project_id != project_id or not _member_can_access_lens(lens, member):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lens not found")


def _require_event_author(event: Event, current_member: Member) -> None:
    if event.created_by != current_member.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only event author can edit this event")


def _to_comment_out(comment: EventComment) -> EventCommentOut:
    return EventCommentOut(
        id=comment.id,
        event_id=comment.event_id,
        project_id=comment.project_id,
        author_member_id=comment.author_member_id,
        text=comment.text,
        created_at=comment.created_at,
    )


def _publish_comment_added(comment: EventComment, event: Event) -> None:
    message = make_live_message(
        project_id=event.project_id,
        calendar_id=event.lens_id,
        message_type="comment.added",
        entity_id=comment.id,
        payload=_to_comment_out(comment).model_dump(mode="json"),
        updated_at=comment.created_at,
    )
    if event.lens_id is None:
        live_broker.publish(project_events_channel(event.project_id), message)
    else:
        live_broker.publish(calendar_channel(event.lens_id), message)


@router.get("/events", response_model=list[EventOut])
def list_events(
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
    category_id: UUID | None = Query(default=None),
    member_id: UUID | None = Query(default=None),
    lens_id: UUID | None = Query(default=None),
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    if (to_date - from_date).days > 90:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Range is limited to 90 days")
    query = (
        db.query(Event)
        .outerjoin(CalendarLens, CalendarLens.id == Event.lens_id)
        .filter(
            Event.project_id == project.id,
            Event.deleted_at.is_(None),
            Event.end_date_local >= from_date,
            Event.date_local <= to_date,
            or_(Event.lens_id.is_(None), CalendarLens.id.is_not(None)),
        )
    )
    if category_id:
        query = query.filter(Event.category_id == category_id)
    if member_id:
        query = query.filter(Event.member_id == member_id)
    if lens_id:
        _verify_lens(db, project.id, lens_id, current_member)
        query = query.filter(Event.lens_id == lens_id)
    events = query.order_by(Event.date_local.desc(), Event.created_at.desc()).all()
    lenses = (
        db.query(CalendarLens)
        .filter(CalendarLens.project_id == project.id)
        .all()
    )
    lens_map = {lens.id: lens for lens in lenses}
    visible_events = []
    for event in events:
        if event.lens_id is None:
            visible_events.append(event)
            continue
        lens = lens_map.get(event.lens_id)
        if lens and _member_can_access_lens(lens, current_member):
            visible_events.append(event)
    return [_to_out(event) for event in visible_events]


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreateIn,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventOut:
    start_at = payload.start_at
    end_at = payload.end_at
    start_date = payload.date_local
    end_date = payload.end_date_local or payload.date_local

    _validate_range(start_at, end_at)
    if start_at:
        start_date = start_at.date()
    if end_at:
        end_date = end_at.date()
    _validate_date_range(start_date, end_date)
    if payload.category_id:
        _verify_category(db, project.id, payload.category_id)
    _verify_lens(db, project.id, payload.lens_id, current_member)
    effective_member_ids = payload.member_ids.copy()
    if payload.member_id and payload.member_id not in effective_member_ids:
        effective_member_ids.insert(0, payload.member_id)
    _verify_members(db, project.id, effective_member_ids)

    if payload.kind == EventKind.active and not start_at:
        start_at = datetime.now(UTC)
        start_date = start_at.date()
        if not end_at:
            end_date = start_date
    is_active = payload.kind == EventKind.active and end_at is None

    event = Event(
        project_id=project.id,
        title=payload.title.strip(),
        description=payload.description,
        category_id=payload.category_id,
        lens_id=payload.lens_id,
        member_id=effective_member_ids[0] if effective_member_ids else None,
        member_ids=json.dumps([str(item) for item in effective_member_ids], ensure_ascii=False),
        kind=EventKind(payload.kind.value),
        date_local=start_date,
        end_date_local=end_date,
        start_at=start_at,
        end_at=end_at,
        is_active=is_active,
        created_by=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    out = _to_out(event)
    _publish_event_message("event.created", out)
    return out


@router.patch("/events/{event_id}", response_model=EventOut)
def patch_event(
    event_id: UUID,
    payload: EventPatchIn,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> EventOut:
    event = db.get(Event, event_id)
    if not event or event.project_id != project.id or event.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    _verify_lens(db, project.id, event.lens_id, current_member)
    _require_event_author(event, current_member)

    updates = payload.model_dump(exclude_unset=True)
    if "category_id" in updates and updates["category_id"]:
        _verify_category(db, project.id, updates["category_id"])
    if "lens_id" in updates:
        _verify_lens(db, project.id, updates["lens_id"], current_member)
    if "member_id" in updates:
        _verify_member(db, project.id, updates["member_id"])
    if "member_ids" in updates and updates["member_ids"] is not None:
        _verify_members(db, project.id, updates["member_ids"])

    kind = updates.get("kind")
    if kind:
        updates["kind"] = EventKind(kind.value)
    if "member_ids" in updates and updates["member_ids"] is not None:
        serialized_member_ids = updates["member_ids"]
        updates["member_ids"] = json.dumps([str(item) for item in serialized_member_ids], ensure_ascii=False)
        updates["member_id"] = serialized_member_ids[0] if serialized_member_ids else None
    elif "member_id" in updates:
        single = updates["member_id"]
        updates["member_ids"] = json.dumps([str(single)], ensure_ascii=False) if single else json.dumps([], ensure_ascii=False)
    start_at = updates.get("start_at", event.start_at)
    end_at = updates.get("end_at", event.end_at)
    _validate_range(start_at, end_at)

    start_date = updates.get("date_local", event.date_local)
    end_date = updates.get("end_date_local", event.end_date_local)
    if start_at:
        start_date = start_at.date()
        updates["date_local"] = start_date
    if end_at:
        end_date = end_at.date()
        updates["end_date_local"] = end_date
    _validate_date_range(start_date, end_date)

    for key, value in updates.items():
        setattr(event, key, value)
    db.add(event)
    db.commit()
    db.refresh(event)
    out = _to_out(event)
    _publish_event_message("event.updated", out)
    return out


@router.post("/events/{event_id}/start", response_model=EventOut)
def start_event(
    event_id: UUID,
    current_member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> EventOut:
    event = db.get(Event, event_id)
    if not event or event.project_id != project.id or event.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    _verify_lens(db, project.id, event.lens_id, current_member)
    if event.is_active:
        return _to_out(event)
    if event.member_id is None:
        event.member_id = current_member.id
    if not event.member_ids:
        event.member_ids = json.dumps([str(current_member.id)], ensure_ascii=False)
    if event.member_id != current_member.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot start event for another member")

    event.kind = EventKind.active
    event.start_at = event.start_at or datetime.now(UTC)
    event.date_local = event.start_at.date()
    event.end_date_local = event.end_date_local or event.date_local
    event.end_at = None
    event.is_active = True
    db.add(event)
    db.commit()
    db.refresh(event)
    out = _to_out(event)
    _publish_event_message("event.started", out)
    return out


@router.post("/events/{event_id}/stop", response_model=EventOut)
def stop_event(
    event_id: UUID,
    current_member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> EventOut:
    event = db.get(Event, event_id)
    if not event or event.project_id != project.id or event.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    _verify_lens(db, project.id, event.lens_id, current_member)
    if not event.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event already stopped")

    event.end_at = datetime.now(UTC)
    event.end_date_local = event.end_at.date()
    event.is_active = False
    db.add(event)
    db.commit()
    db.refresh(event)
    out = _to_out(event)
    _publish_event_message("event.stopped", out)
    return out


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: UUID,
    current_member: Member = Depends(get_current_member),
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> None:
    event = db.get(Event, event_id)
    if not event or event.project_id != project.id or event.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    _verify_lens(db, project.id, event.lens_id, current_member)
    _require_event_author(event, current_member)
    event.deleted_at = datetime.now(UTC)
    db.add(event)
    db.commit()
    _publish_event_deleted(event)


@router.get("/events/{event_id}/comments", response_model=list[EventCommentOut])
def list_event_comments(
    event_id: UUID,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> list[EventCommentOut]:
    event = db.get(Event, event_id)
    if not event or event.project_id != project.id or event.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    _verify_lens(db, project.id, event.lens_id, current_member)
    comments = (
        db.query(EventComment)
        .filter(
            EventComment.project_id == project.id,
            EventComment.event_id == event.id,
        )
        .order_by(EventComment.created_at.asc())
        .all()
    )
    return [_to_comment_out(comment) for comment in comments]


@router.post("/events/{event_id}/comments", response_model=EventCommentOut, status_code=status.HTTP_201_CREATED)
def create_event_comment(
    event_id: UUID,
    payload: EventCommentCreateIn,
    project: FamilyProject = Depends(get_current_project),
    current_member: Member = Depends(get_current_member),
    db: Session = Depends(get_db),
) -> EventCommentOut:
    event = db.get(Event, event_id)
    if not event or event.project_id != project.id or event.deleted_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    _verify_lens(db, project.id, event.lens_id, current_member)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Comment cannot be empty")

    comment = EventComment(
        event_id=event.id,
        project_id=project.id,
        author_member_id=current_member.id,
        text=text,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    _publish_comment_added(comment, event)
    return _to_comment_out(comment)
