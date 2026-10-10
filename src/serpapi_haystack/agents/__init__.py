"""Agents package: regex intents + LLM autonomous router + Laya System 1 decision engine."""
from .intents import INTENTS, QueryAnalysis, classify_query, select_tools
from .laya_router import LayaRouter, classify_with_laya
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
    "LayaRouter",
    "classify_with_laya",
]

