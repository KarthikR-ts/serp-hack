"""Minimal observability (PRD Sec 85-86). Never logs secrets."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCallRecord:
    tool: str
    query: str
    latency_ms: float = 0.0
    result_count: int = 0
    error: str | None = None


@dataclass
class RunTrace:
    request_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    intent: list[str] = field(default_factory=list)
    tools_selected: list[str] = field(default_factory=list)
    calls: list[ToolCallRecord] = field(default_factory=list)
    started_at: float = field(default_factory=time.monotonic)
    token_usage: dict[str, int] = field(default_factory=dict)

    def add(self, record: ToolCallRecord) -> None:
        self.calls.append(record)

    @property
    def total_latency_ms(self) -> float:
        return (time.monotonic() - self.started_at) * 1000.0

    @property
    def serpapi_calls(self) -> int:
        return len(self.calls)

    def summary(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "intent": self.intent,
            "tools_selected": self.tools_selected,
            "serpapi_calls": self.serpapi_calls,
            "result_count": sum(c.result_count for c in self.calls),
            "total_latency_ms": round(self.total_latency_ms, 1),
            "errors": [c.error for c in self.calls if c.error],
        }
