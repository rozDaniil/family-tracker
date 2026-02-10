from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import CalendarLens, Category, FamilyProject, LensView, Member, MemberStatus, User
from app.schemas.common import AuthSessionIn, AuthSessionOut

router = APIRouter(prefix="/auth", tags=["auth"])

DEFAULT_CATEGORIES = [
    ("Дом", "Home", "#D7BFA8"),
    ("Быт", "Sparkles", "#E0C8A8"),
    ("Дети", "Users", "#B8C6A3"),
    ("Прогулки", "Trees", "#AFC7B4"),
]


@router.post("/session", response_model=AuthSessionOut)
def create_session(payload: AuthSessionIn, db: Session = Depends(get_db)) -> AuthSessionOut:
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
    project = FamilyProject(name="Наша семья")
    db.add_all([user, project])
    db.flush()

    member = Member(
        project_id=project.id,
        user_id=user.id,
        display_name=payload.display_name,
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
    db.add(
        CalendarLens(
            project_id=project.id,
            name="Неделя семьи",
            view_type=LensView.week,
            range_preset="week",
            sort_order="recent",
            density="comfortable",
            is_default=True,
            created_by=user.id,
        )
    )
    db.commit()
    return AuthSessionOut(token=str(user.id), user_id=user.id, project_id=project.id, member_id=member.id)
