from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[datetime]] = defaultdict(deque)

    def allow(self, key: str, limit: int, per_seconds: int) -> bool:
        now = datetime.now(UTC)
        threshold = now - timedelta(seconds=per_seconds)
        queue = self._events[key]
        while queue and queue[0] < threshold:
            queue.popleft()
        if len(queue) >= limit:
            return False
        queue.append(now)
        return True
