from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_project
from app.core.db import get_db
from app.models import FamilyProject, Member, MemberStatus, User
from app.schemas.common import MemberCreateIn, MemberOut

router = APIRouter(tags=["members"])


@router.get("/members", response_model=list[MemberOut])
def get_members(
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> list[MemberOut]:
    members = db.query(Member).filter(Member.project_id == project.id).order_by(Member.created_at.asc()).all()
    return [MemberOut.model_validate(m, from_attributes=True) for m in members]


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def create_member(
    payload: MemberCreateIn,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> MemberOut:
    user = User(display_name=payload.display_name.strip())
    db.add(user)
    db.flush()

    member = Member(
        project_id=project.id,
        user_id=user.id,
        display_name=payload.display_name.strip(),
        status=MemberStatus.active,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return MemberOut.model_validate(member, from_attributes=True)
