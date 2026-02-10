from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.api.deps import get_current_project
from app.core.db import get_db
from app.models import Category, Event, FamilyProject
from app.schemas.common import CategoryCreateIn, CategoryOut, CategoryPatchIn

router = APIRouter(tags=["categories"])
IMMUTABLE_BASE_CATEGORIES = {"Дом", "Быт", "Дети", "Прогулки"}


def _is_immutable_base(category: Category) -> bool:
    return category.is_default and category.name in IMMUTABLE_BASE_CATEGORIES


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> list[CategoryOut]:
    categories = (
        db.query(Category)
        .filter(Category.project_id == project.id)
        .order_by(Category.is_archived.asc(), Category.name.asc())
        .all()
    )
    return [CategoryOut.model_validate(c, from_attributes=True) for c in categories]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreateIn,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> CategoryOut:
    category = Category(
        project_id=project.id,
        name=payload.name.strip(),
        icon=payload.icon.strip(),
        color=payload.color.strip(),
        is_default=False,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return CategoryOut.model_validate(category, from_attributes=True)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def patch_category(
    category_id: UUID,
    payload: CategoryPatchIn,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> CategoryOut:
    category = db.get(Category, category_id)
    if not category or category.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    updates = payload.model_dump(exclude_unset=True)
    if _is_immutable_base(category):
        locked_keys = {"name", "icon", "color", "is_archived"}
        if any(key in updates for key in locked_keys):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Base category is immutable",
            )
    for key, value in updates.items():
        setattr(category, key, value)
    db.add(category)
    db.commit()
    db.refresh(category)
    return CategoryOut.model_validate(category, from_attributes=True)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: UUID,
    project: FamilyProject = Depends(get_current_project),
    db: Session = Depends(get_db),
) -> None:
    category = db.get(Category, category_id)
    if not category or category.project_id != project.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    if _is_immutable_base(category):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Base category is immutable")

    db.query(Event).filter(
        Event.project_id == project.id,
        Event.category_id == category.id,
    ).update({"category_id": None})
    db.delete(category)
    db.commit()
