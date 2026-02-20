import asyncio
import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.models import CalendarLens, Member, User
from app.services.live import (
    calendar_channel,
    live_broker,
    make_live_message,
    project_events_channel,
    project_meta_channel,
)
from app.services.security import decode_access_token

router = APIRouter(tags=["live"])


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _resolve_subscription_scope(websocket: WebSocket) -> tuple[uuid.UUID | None, bool]:
    raw_calendar_id = websocket.query_params.get("calendar_id")
    project_feed = _parse_bool(websocket.query_params.get("project_feed"), True)
    if not raw_calendar_id:
        return None, project_feed
    return uuid.UUID(raw_calendar_id), project_feed


def _resolve_user_and_project(
    db: Session,
    websocket: WebSocket,
) -> tuple[User, Member]:
    token = websocket.cookies.get(settings.access_cookie_name)
    if not token:
        raise PermissionError("missing_token")
    payload = decode_access_token(token, settings.jwt_secret)
    if not payload:
        raise PermissionError("invalid_token")
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise PermissionError("invalid_subject")
    try:
        user_id = uuid.UUID(subject)
    except ValueError as exc:
        raise PermissionError("invalid_subject") from exc

    user = db.get(User, user_id)
    if not user:
        raise PermissionError("unknown_user")

    member = db.query(Member).filter(Member.user_id == user.id).first()
    if not member:
        raise PermissionError("no_membership")
    return user, member


def _member_can_access_lens(lens: CalendarLens, member: Member) -> bool:
    if not lens.member_ids:
        return lens.created_by == member.user_id
    try:
        allowed = {uuid.UUID(value) for value in json.loads(lens.member_ids)}
    except (ValueError, TypeError, json.JSONDecodeError):
        return lens.created_by == member.user_id
    if member.id in allowed:
        return True
    return lens.created_by == member.user_id


async def _forward_messages(
    websocket: WebSocket,
    queues: list[asyncio.Queue[dict[str, object]]],
) -> None:
    pending = {asyncio.create_task(queue.get()): queue for queue in queues}
    try:
        while True:
            done, _ = await asyncio.wait(pending.keys(), return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                queue = pending.pop(task)
                payload = task.result()
                await websocket.send_json(payload)
                pending[asyncio.create_task(queue.get())] = queue
    finally:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


async def _keepalive_ping(websocket: WebSocket, project_id: uuid.UUID, calendar_id: uuid.UUID | None) -> None:
    while True:
        await asyncio.sleep(25)
        await websocket.send_json(
            make_live_message(
                project_id=project_id,
                calendar_id=calendar_id,
                message_type="system.ping",
                entity_id=project_id,
                updated_at=datetime.now(UTC),
                payload=None,
            )
        )


@router.websocket("/live/ws")
async def live_ws(websocket: WebSocket) -> None:
    try:
        calendar_id, project_feed = _resolve_subscription_scope(websocket)
    except ValueError:
        await websocket.close(code=4403)
        return

    with SessionLocal() as db:
        try:
            _, member = _resolve_user_and_project(db, websocket)
        except PermissionError as exc:
            if str(exc) == "no_membership":
                await websocket.close(code=4403)
            else:
                await websocket.close(code=4401)
            return

        if calendar_id is not None:
            lens = db.get(CalendarLens, calendar_id)
            if (
                not lens
                or lens.project_id != member.project_id
                or not _member_can_access_lens(lens, member)
            ):
                await websocket.close(code=4403)
                return

        project_id = member.project_id

        visible_calendar_ids: list[uuid.UUID] = []
        if calendar_id is None:
            lenses = db.query(CalendarLens).filter(CalendarLens.project_id == project_id).all()
            visible_calendar_ids = [
                lens.id for lens in lenses if _member_can_access_lens(lens, member)
            ]

    channels: list[str] = []
    if calendar_id is not None:
        channels.append(calendar_channel(calendar_id))
    else:
        channels.append(project_events_channel(project_id))
        channels.extend(calendar_channel(item) for item in visible_calendar_ids)
    if project_feed:
        channels.append(project_meta_channel(project_id))
    channels = list(dict.fromkeys(channels))

    await websocket.accept()
    live_broker.set_loop(asyncio.get_running_loop())

    queue_map = {channel: live_broker.subscribe(channel) for channel in channels}

    await websocket.send_json(
        make_live_message(
            project_id=project_id,
            calendar_id=calendar_id,
            message_type="system.connected",
            entity_id=project_id,
            updated_at=datetime.now(UTC),
            payload={"channels": channels},
        )
    )

    forward_task = asyncio.create_task(_forward_messages(websocket, list(queue_map.values())))
    ping_task = asyncio.create_task(_keepalive_ping(websocket, project_id, calendar_id))
    try:
        done, pending = await asyncio.wait(
            {forward_task, ping_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                raise exc
    finally:
        for channel, queue in queue_map.items():
            live_broker.unsubscribe(channel, queue)
