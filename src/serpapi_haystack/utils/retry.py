"""Retry helper (used by client; exposed for components)."""
from __future__ import annotations

import time
from typing import Callable, TypeVar

T = TypeVar("T")


def with_retry(
    fn: Callable[[], T],
    max_retries: int = 3,
    backoff_factor: float = 0.5,
    retry_on: tuple[type[BaseException], ...] = (Exception,),
) -> T:
    last: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except retry_on as exc:
            last = exc
            if attempt < max_retries:
                time.sleep(backoff_factor * (2**attempt))
                continue
            raise
    assert last is not None
    raise last
