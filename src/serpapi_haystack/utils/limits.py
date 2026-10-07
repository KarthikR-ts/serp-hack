"""Cost control + parallel execution (PRD Sec 78-79)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class BudgetLimits:
    """MVP limits (PRD Sec 78)."""

    max_planning_steps: int = 8
    max_serpapi_calls: int = 12
    max_results_per_call: int = 10
    max_execution_time_seconds: float = 45.0

    def clamp_num_results(self, requested: int | None) -> int:
        if requested is None:
            return self.max_results_per_call
        return max(1, min(int(requested), self.max_results_per_call))


class BudgetExceededError(RuntimeError):
    pass


class BudgetTracker:
    """Counts SerpApi calls; raises when the budget is exhausted."""

    def __init__(self, limits: BudgetLimits | None = None):
        self.limits = limits or BudgetLimits()
        self.calls = 0

    def consume(self, n: int = 1) -> None:
        self.calls += n
        if self.calls > self.limits.max_serpapi_calls:
            raise BudgetExceededError(
                f"SerpApi call budget exceeded ({self.calls} > {self.limits.max_serpapi_calls})."
            )


def run_parallel(
    tasks: dict[str, Callable[[], Any]],
    max_workers: int = 4,
) -> dict[str, Any]:
    """Execute independent searches concurrently (PRD Sec 79).

    Returns mapping name -> result. Failures are captured as exceptions
    in the dict (caller decides whether to continue — PRD Sec 80).
    """
    results: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_to_name = {pool.submit(fn): name for name, fn in tasks.items()}
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            try:
                results[name] = future.result()
            except Exception as exc:  # noqa: BLE001
                results[name] = exc
    return results
