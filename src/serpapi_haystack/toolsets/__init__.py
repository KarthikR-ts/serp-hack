"""Logical toolsets (PRD Sec 26) + dynamic selection (Sec 27)."""
from __future__ import annotations

from haystack.tools import Toolset

from ..tools import create_jobs_tool, create_search_tool, create_shopping_tool
from ..agents.intents import QueryAnalysis, select_tools


def research_toolset(**kwargs) -> Toolset:
    """Research Toolset (Phase 0-3 subset: Search; News/Scholar/Patents/Forums land in Phase 4)."""
    return Toolset(tools=[create_search_tool(**kwargs)])


def shopping_toolset(**kwargs) -> Toolset:
    """Shopping Toolset: Shopping + Search (+ Images in Phase 4)."""
    return Toolset(tools=[create_shopping_tool(**kwargs), create_search_tool(**kwargs)])


def careers_toolset(**kwargs) -> Toolset:
    """Career Toolset: Jobs + Search (+ News in Phase 4)."""
    return Toolset(tools=[create_jobs_tool(**kwargs), create_search_tool(**kwargs)])


def universal_toolset(**kwargs) -> Toolset:
    """All Phase 0-3 tools (used when intent is ambiguous)."""
    return Toolset(
        tools=[
            create_search_tool(**kwargs),
            create_jobs_tool(**kwargs),
            create_shopping_tool(**kwargs),
        ]
    )


def toolset_for_analysis(analysis: QueryAnalysis, **kwargs) -> Toolset:
    """Build a minimal Toolset containing only the tools the query needs."""
    wanted = select_tools(analysis)
    tools = []
    if "google_search" in wanted:
        tools.append(create_search_tool(**kwargs))
    if "google_jobs" in wanted:
        tools.append(create_jobs_tool(**kwargs))
    if "google_shopping" in wanted:
        tools.append(create_shopping_tool(**kwargs))
    return Toolset(tools=tools or [create_search_tool(**kwargs)])


__all__ = [
    "research_toolset",
    "shopping_toolset",
    "careers_toolset",
    "universal_toolset",
    "toolset_for_analysis",
]
