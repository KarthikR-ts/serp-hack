"""Laya System 1 Decision Router for SerpApi Haystack.

Non-autoregressive decision layer replacing LLM PASS 1.
Laya is an open-source alternative to TypeSafe Jev (a pure decision-based model
with no text generation, only calibrated probabilities over typed criteria).
Computes probability distributions over ENGINE_REGISTRY and PRESENTATIONS
in a single forward pass without autoregressive token generation.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any, Literal

# Fix for Windows systems without symlink privilege in huggingface_hub
try:
    import huggingface_hub.file_download as _hf_fd
    _hf_fd.are_symlinks_supported = lambda cache_dir=None: False
except Exception:
    pass

from .intents import _BUDGET_RE, _FLIGHT_RE, _HOTEL_RE, _SHOP_RE, _LEARN_RE
from ..utils.travel import flight_dates, parse_trip_dates, resolve_airport
from .llm_router import (
    ENGINE_REGISTRY,
    PRESENTATIONS,
    RouterPlan,
    RouterStep,
    SubTask,
    _enforce_hard_rules,
    _regex_subtasks,
)


class LayaRouter:
    """Non-autoregressive System 1 Router using Laya."""

    def __init__(self, preload: bool = False, device: str | None = None) -> None:
        from laya import Router

        self._device = device or ("cuda" if os.getenv("USE_CUDA") else "auto")
        self.router = Router(preload=preload, device=self._device)

        # Precompile choice questions from engine registry and presentations
        criteria = {eng: info["use_when"] for eng, info in ENGINE_REGISTRY.items()}
        self.questions = {
            "engine": {
                "type": "choice",
                "instructions": "Which specialized search engine endpoint should answer this query?",
                "criteria": criteria,
            },
            "presentation": {
                "type": "choice",
                "instructions": "Which result presentation layout is best for this user intent?",
                "criteria": {p: p.replace("_", " ") for p in PRESENTATIONS},
            },
            "needs_clarification": {
                "type": "noul",
                "instructions": "Is the query ambiguous, missing essential travel dates/places, or incomplete?",
            },
        }

    def predict(self, query: str) -> dict[str, Any]:
        """Run Laya forward pass on query."""
        return self.router.predict(query.strip(), self.questions)

    def route(self, query: str, min_confidence: float = 0.50) -> RouterPlan:
        """Route a user search query into a structured RouterPlan.

        Args:
            query: The user prompt.
            min_confidence: Threshold below which confidence is marked 'low'.

        Returns:
            A populated RouterPlan compatible with the SerpApi execution pipeline.
        """
        q = query.strip()
        t0 = time.perf_counter()
        res = self.predict(q)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        ans = res.get("answers", {})
        engine_res = ans.get("engine", {})
        chosen_engine = engine_res.get("choice", "google_search")
        engine_conf = float(engine_res.get("confidence", 0.5))

        pres_res = ans.get("presentation", {})
        chosen_pres = pres_res.get("choice", "research_brief")
        if chosen_pres not in PRESENTATIONS:
            chosen_pres = "generic"

        clar_res = ans.get("needs_clarification", {})
        needs_clar = float(clar_res.get("noul", 0.0)) > 0.65

        # Slot extraction (deterministic fast extractors)
        slots: dict[str, Any] = {}
        missing_slots: list[str] = []

        # Budget extraction
        m_budget = _BUDGET_RE.search(q)
        if m_budget:
            slots["budget"] = m_budget.group(1).replace(",", "")

        # Airport / location extraction
        if "to" in q.lower():
            parts = re.split(r"\bto\b", q, maxsplit=1, flags=re.I)
            if len(parts) == 2:
                orig = resolve_airport(parts[0].strip())
                dest = resolve_airport(parts[1].strip())
                if orig:
                    slots["origin"] = orig
                if dest:
                    slots["destination"] = dest
        else:
            cand_airport = resolve_airport(q)
            if cand_airport:
                slots["destination"] = cand_airport

        # Dates extraction
        dates = parse_trip_dates(q)
        if dates and dates[0]:
            slots["dates"] = f"{dates[0]} to {dates[1]}" if dates[1] else dates[0]

        # Check required missing slots for travel
        if chosen_engine in ("google_flights", "google_hotels"):
            if not slots.get("origin") and chosen_engine == "google_flights":
                missing_slots.append("origin")
            if not slots.get("destination"):
                missing_slots.append("destination")

        if missing_slots:
            needs_clar = True

        # Confidence rating
        confidence: Literal["high", "medium", "low"]
        if engine_conf >= 0.85:
            confidence = "high"
        elif engine_conf >= min_confidence:
            confidence = "medium"
        else:
            confidence = "low"

        # Determine use case
        use_case = chosen_engine.replace("google_", "")
        if use_case == "flights" or use_case == "hotels":
            use_case = "travel"
        elif use_case == "youtube":
            use_case = "youtube_learning"

        # Multi-task check via regex decomposition
        subtasks = _regex_subtasks(q)

        step = RouterStep(engine=chosen_engine, query=q)

        plan = RouterPlan(
            use_case=use_case,
            presentation=chosen_pres,
            steps=[step],
            needs_clarification=needs_clar,
            clarifying_question=(
                "Where are you traveling from and to, and on what dates?"
                if needs_clar and use_case == "travel"
                else ""
            ),
            confidence=confidence,
            reasoning=f"Laya System 1: {chosen_engine} (p={engine_conf:.2f}, {latency_ms:.1f}ms)",
            slots=slots,
            missing_slots=missing_slots,
            tasks=subtasks if len(subtasks) > 1 else [],
        )

        # Enforce safety net hard rules (travel booking, buy intent, video learning overrides)
        return _enforce_hard_rules(q, plan)


_GLOBAL_LAYA_ROUTER: LayaRouter | None = None


def get_laya_router(preload: bool = False) -> LayaRouter:
    """Singleton getter for the Laya router instance."""
    global _GLOBAL_LAYA_ROUTER
    if _GLOBAL_LAYA_ROUTER is None:
        _GLOBAL_LAYA_ROUTER = LayaRouter(preload=preload)
    return _GLOBAL_LAYA_ROUTER


def classify_with_laya(query: str, preload: bool = False) -> RouterPlan:
    """Drop-in replacement for classify_with_llm using Laya."""
    router = get_laya_router(preload=preload)
    return router.route(query)
