from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_project
from app.core.db import get_db
from app.models import FamilyProject
from app.schemas.common import FamilyProjectOut, ProjectPatchIn
from app.services.live import live_broker, make_live_message, project_meta_channel

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/current", response_model=FamilyProjectOut)
def get_project(project: FamilyProject = Depends(get_current_project)) -> FamilyProjectOut:
    return FamilyProjectOut.model_validate(project, from_attributes=True)


@router.patch("/current", response_model=FamilyProjectOut)
def patch_project(
    payload: ProjectPatchIn,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> FamilyProjectOut:
    if payload.name is not None:
        project.name = payload.name
    if payload.timezone is not None:
        project.timezone = payload.timezone
    db.add(project)
    db.commit()
    db.refresh(project)
    out = FamilyProjectOut.model_validate(project, from_attributes=True)
    message = make_live_message(
        project_id=out.id,
        calendar_id=None,
        message_type="project.updated",
        entity_id=out.id,
        payload=out.model_dump(mode="json"),
        updated_at=None,
    )
    live_broker.publish(project_meta_channel(out.id), message)
    return out
