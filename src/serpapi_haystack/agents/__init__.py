"""Agents package (Phase 3: single universal agent; specialists in Phase 6)."""
from .intents import INTENTS, QueryAnalysis, classify_query, select_tools
from .universal import SYSTEM_PROMPT, build_plan, create_universal_agent, synthesis_input

__all__ = [
    "INTENTS",
    "QueryAnalysis",
    "classify_query",
    "select_tools",
    "build_plan",
    "create_universal_agent",
    "synthesis_input",
    "SYSTEM_PROMPT",
]
