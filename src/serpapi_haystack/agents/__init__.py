"""Agents package: regex intents + LLM autonomous router."""
from .intents import INTENTS, QueryAnalysis, classify_query, select_tools
from .llm_router import RouterPlan, run_agent
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
    "RouterPlan",
    "run_agent",
]
