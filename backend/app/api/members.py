from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_project
from app.core.db import get_db
from app.models import FamilyProject, Member, MemberStatus
from app.schemas.common import MemberCreateIn, MemberOut

router = APIRouter(tags=["members"])


@router.get("/members", response_model=list[MemberOut])
def get_members(
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> list[MemberOut]:
    members = (
        db.query(Member)
        .filter(
            Member.project_id == project.id,
            Member.status == MemberStatus.active,
        )
        .order_by(Member.created_at.asc())
        .all()
    )
    return [MemberOut.model_validate(m, from_attributes=True) for m in members]


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def create_member(
    payload: MemberCreateIn,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> MemberOut:
    # Keep endpoint shape for backwards compatibility, but block direct member creation.
    # In MVP participants are added only via invite acceptance.
    _ = payload, project, db
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Members can only be added via invite acceptance",
    )
