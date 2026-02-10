import json
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_project, get_current_user
from app.core.db import get_db
from app.models import CalendarLens, Event, FamilyProject, LensView, User
from app.schemas.common import CalendarLensCreateIn, CalendarLensOut, CalendarLensPatchIn

router = APIRouter(tags=["lenses"])


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


@router.get("/lenses", response_model=list[CalendarLensOut])
def list_lenses(
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> list[CalendarLensOut]:
    lenses = (
        db.query(CalendarLens)
        .filter(CalendarLens.project_id == project.id)
        .order_by(CalendarLens.is_default.desc(), CalendarLens.created_at.asc())
        .all()
    )
    return [_to_out(lens) for lens in lenses]


@router.get("/lenses/{lens_id}", response_model=CalendarLensOut)
def get_lens(
    lens_id: UUID,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> CalendarLensOut:
    lens = db.get(CalendarLens, lens_id)
    if not lens or lens.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lens not found")
    return _to_out(lens)


@router.post("/lenses", response_model=CalendarLensOut, status_code=status.HTTP_201_CREATED)
def create_lens(
    payload: CalendarLensCreateIn,
    project: FamilyProject = Depends(get_current_project),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarLensOut:
    lens = CalendarLens(
        project_id=project.id,
        name=payload.name.strip(),
        view_type=LensView(payload.view_type.value),
        range_preset=payload.range_preset,
        category_ids=_dump_ids(payload.category_ids),
        member_ids=_dump_ids(payload.member_ids),
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
    return _to_out(lens)


@router.patch("/lenses/{lens_id}", response_model=CalendarLensOut)
def patch_lens(
    lens_id: UUID,
    payload: CalendarLensPatchIn,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> CalendarLensOut:
    lens = db.get(CalendarLens, lens_id)
    if not lens or lens.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lens not found")

    updates = payload.model_dump(exclude_unset=True)
    if "is_default" in updates and updates["is_default"]:
        db.query(CalendarLens).filter(CalendarLens.project_id == project.id).update({"is_default": False})

    if "category_ids" in updates:
        updates["category_ids"] = _dump_ids(updates["category_ids"])
    if "member_ids" in updates:
        updates["member_ids"] = _dump_ids(updates["member_ids"])
    if "view_type" in updates and updates["view_type"] is not None:
        updates["view_type"] = LensView(updates["view_type"].value)

    for key, value in updates.items():
        setattr(lens, key, value)
    db.add(lens)
    db.commit()
    db.refresh(lens)
    return _to_out(lens)


@router.delete("/lenses/{lens_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lens(
    lens_id: UUID,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> Response:
    lens = db.get(CalendarLens, lens_id)
    if not lens or lens.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lens not found")

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

    db.delete(lens)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
