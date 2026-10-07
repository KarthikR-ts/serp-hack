"""TTL cache with per-engine policies (PRD Sec 77)."""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class _Entry:
    value: object
    expires_at: float


class InMemoryCache:
    """Thread-unsafe-but-simple in-memory TTL cache with hook interface.

    Cache key (PRD Sec 77): engine + query + location + language +
    country + filters (built by ``SerpApiClient._cache_key``).
    """

    def __init__(self, default_ttl: float = 900.0, ttl_by_engine: dict[str, float] | None = None):
        self.default_ttl = default_ttl
        self.ttl_by_engine = ttl_by_engine or {}
        self._store: dict[str, _Entry] = {}

    def _ttl_for_key(self, key: str) -> float:
        engine = key.split("|", 1)[0]
        return self.ttl_by_engine.get(engine, self.default_ttl)

    def get(self, key: str) -> object | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if time.monotonic() >= entry.expires_at:
            self._store.pop(key, None)
            return None
        return entry.value

    def set(self, key: str, value: object, ttl: float | None = None) -> None:
        resolved = ttl if ttl is not None else self._ttl_for_key(key)
        self._store[key] = _Entry(value=value, expires_at=time.monotonic() + resolved)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)


def ttl_for_engine(engine: str) -> float:
    """Suggested TTLs (PRD Sec 77)."""
    from ..client.client import DEFAULT_TTL_BY_ENGINE

    return float(DEFAULT_TTL_BY_ENGINE.get(engine, DEFAULT_TTL_BY_ENGINE["default"]))


def build_default_cache() -> InMemoryCache:
    from ..client.client import DEFAULT_TTL_BY_ENGINE

    return InMemoryCache(
        default_ttl=float(DEFAULT_TTL_BY_ENGINE["default"]),
        ttl_by_engine={k: float(v) for k, v in DEFAULT_TTL_BY_ENGINE.items()},
    )
