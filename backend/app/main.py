from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.api import auth, categories, events, invites, lenses, members, projects
from app.core.config import settings
from app.core.db import Base, engine
from app.models import Category, FamilyProject

app = FastAPI(title=settings.app_name)
BASE_CATEGORIES = [
    ("Дом", "Home", "#D7BFA8"),
    ("Быт", "Sparkles", "#E0C8A8"),
    ("Дети", "Users", "#B8C6A3"),
    ("Прогулки", "Trees", "#AFC7B4"),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if "events" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("events")}
        if "end_date_local" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE events ADD COLUMN end_date_local DATE"))
                connection.execute(text("UPDATE events SET end_date_local = date_local WHERE end_date_local IS NULL"))
        if "member_ids" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE events ADD COLUMN member_ids TEXT"))
                connection.execute(
                    text(
                        "UPDATE events SET member_ids = CASE "
                        "WHEN member_id IS NULL THEN '[]' "
                        "ELSE '[\"' || member_id || '\"]' END "
                        "WHERE member_ids IS NULL"
                    )
                )
        if "lens_id" not in columns:
            if engine.dialect.name == "postgresql":
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS lens_id UUID"))
                    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_events_lens_id ON events(lens_id)"))
            elif engine.dialect.name == "sqlite":
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE events ADD COLUMN lens_id TEXT"))
                    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_events_lens_id ON events(lens_id)"))
        if engine.dialect.name == "postgresql":
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE events ALTER COLUMN category_id DROP NOT NULL"))
        elif engine.dialect.name == "sqlite":
            with engine.begin() as connection:
                table_info = connection.execute(text("PRAGMA table_info(events)")).fetchall()
                category_col = next((row for row in table_info if row[1] == "category_id"), None)
                if category_col and category_col[3] == 1:
                    connection.execute(
                        text(
                            """
                            CREATE TABLE events_new (
                                id TEXT PRIMARY KEY,
                                project_id TEXT NOT NULL,
                                title VARCHAR(160) NOT NULL,
                                description TEXT NULL,
                                category_id TEXT NULL,
                                lens_id TEXT NULL,
                                member_id TEXT NULL,
                                member_ids TEXT NULL,
                                kind VARCHAR(6) NOT NULL,
                                date_local DATE NOT NULL,
                                end_date_local DATE NOT NULL,
                                start_at DATETIME NULL,
                                end_at DATETIME NULL,
                                is_active BOOLEAN NOT NULL,
                                created_by TEXT NOT NULL,
                                created_at DATETIME NOT NULL,
                                updated_at DATETIME NOT NULL,
                                deleted_at DATETIME NULL
                            )
                            """
                        )
                    )
                    connection.execute(
                        text(
                            """
                            INSERT INTO events_new
                            (id, project_id, title, description, category_id, lens_id, member_id, member_ids, kind,
                             date_local, end_date_local, start_at, end_at, is_active, created_by, created_at, updated_at, deleted_at)
                            SELECT
                             id, project_id, title, description, category_id, lens_id, member_id, member_ids, kind,
                             date_local, end_date_local, start_at, end_at, is_active, created_by, created_at, updated_at, deleted_at
                            FROM events
                            """
                        )
                    )
                    connection.execute(text("DROP TABLE events"))
                    connection.execute(text("ALTER TABLE events_new RENAME TO events"))
                    connection.execute(text("CREATE INDEX ix_events_project_id ON events(project_id)"))
                    connection.execute(text("CREATE INDEX ix_events_category_id ON events(category_id)"))
                    connection.execute(text("CREATE INDEX ix_events_lens_id ON events(lens_id)"))
                    connection.execute(text("CREATE INDEX ix_events_date_local ON events(date_local)"))
                    connection.execute(text("CREATE INDEX ix_events_end_date_local ON events(end_date_local)"))

    with Session(engine) as db:
        projects = db.query(FamilyProject).all()
        for project in projects:
            for name, icon, color in BASE_CATEGORIES:
                existing = (
                    db.query(Category)
                    .filter(Category.project_id == project.id, Category.name == name)
                    .first()
                )
                if existing:
                    if not existing.is_default:
                        existing.is_default = True
                        db.add(existing)
                    continue
                db.add(
                    Category(
                        project_id=project.id,
                        name=name,
                        icon=icon,
                        color=color,
                        is_default=True,
                    )
                )
        db.commit()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(projects.router, prefix=settings.api_prefix)
app.include_router(members.router, prefix=settings.api_prefix)
app.include_router(invites.router, prefix=settings.api_prefix)
app.include_router(categories.router, prefix=settings.api_prefix)
app.include_router(events.router, prefix=settings.api_prefix)
app.include_router(lenses.router, prefix=settings.api_prefix)
