from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi.encoders import jsonable_encoder

LiveType = Literal[
    "event.created",
    "event.updated",
    "event.deleted",
    "event.started",
    "event.stopped",
    "comment.added",
    "calendar.updated",
    "calendar.deleted",
    "member.changed",
    "project.updated",
    "system.connected",
    "system.resync_required",
    "system.ping",
]

DEFAULT_QUEUE_MAXSIZE = 200


def _to_iso(value: datetime | str | None = None) -> str:
    if value is None:
        return datetime.now(UTC).isoformat()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC).isoformat()
        return value.astimezone(UTC).isoformat()
    return value


def project_events_channel(project_id: UUID | str) -> str:
    return f"project-events:{project_id}"


def project_meta_channel(project_id: UUID | str) -> str:
    return f"project-meta:{project_id}"


def calendar_channel(calendar_id: UUID | str) -> str:
    return f"calendar:{calendar_id}"


def make_live_message(
    *,
    project_id: UUID | str,
    message_type: LiveType,
    entity_id: UUID | str,
    updated_at: datetime | str | None = None,
    calendar_id: UUID | str | None = None,
    payload: Any = None,
) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "projectId": str(project_id),
        "calendarId": str(calendar_id) if calendar_id is not None else None,
        "type": message_type,
        "entityId": str(entity_id),
        "payload": jsonable_encoder(payload),
        "updatedAt": _to_iso(updated_at),
    }


class LiveBroker:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscriptions: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        if loop.is_closed():
            return
        self._loop = loop

    def subscribe(self, channel: str, maxsize: int = DEFAULT_QUEUE_MAXSIZE) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=maxsize)
        self._subscriptions[channel].add(queue)
        return queue

    def unsubscribe(self, channel: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        subscriptions = self._subscriptions.get(channel)
        if not subscriptions:
            return
        subscriptions.discard(queue)
        if not subscriptions:
            self._subscriptions.pop(channel, None)

    def publish(self, channel: str, message: dict[str, Any]) -> None:
        if not self._loop:
            return
        if self._loop.is_closed():
            self._loop = None
            return
        try:
            self._loop.call_soon_threadsafe(self._publish_in_loop, channel, message)
        except RuntimeError:
            self._loop = None

    def _publish_in_loop(self, channel: str, message: dict[str, Any]) -> None:
        queues = self._subscriptions.get(channel)
        if not queues:
            return
        for queue in list(queues):
            self._push_or_resync(queue, message)

    def _push_or_resync(self, queue: asyncio.Queue[dict[str, Any]], message: dict[str, Any]) -> None:
        try:
            queue.put_nowait(message)
            return
        except asyncio.QueueFull:
            pass

        while queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        resync = make_live_message(
            project_id=message.get("projectId", ""),
            calendar_id=message.get("calendarId"),
            message_type="system.resync_required",
            entity_id=message.get("entityId", ""),
            updated_at=datetime.now(UTC),
            payload=None,
        )
        try:
            queue.put_nowait(resync)
        except asyncio.QueueFull:
            # Connection still cannot keep up; keep going without blocking publisher.
            pass


live_broker = LiveBroker()


def publish_to_channels(channels: Iterable[str], message: dict[str, Any]) -> None:
    for channel in channels:
        live_broker.publish(channel, message)
