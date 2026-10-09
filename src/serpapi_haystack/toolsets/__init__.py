"""Logical toolsets (PRD Sec 26) + dynamic selection (Sec 27)."""

from __future__ import annotations

from haystack.tools import Toolset

from ..agents.intents import QueryAnalysis, select_tools
from ..tools import (
    create_events_tool,
    create_finance_tool,
    create_flights_tool,
    create_forums_tool,
    create_hotels_tool,
    create_images_tool,
    create_jobs_tool,
    create_maps_tool,
    create_news_tool,
    create_patents_tool,
    create_scholar_tool,
    create_search_tool,
    create_shopping_tool,
    create_trends_tool,
    create_youtube_tool,
)


def research_toolset(**kwargs) -> Toolset:
    """Research Toolset: Search, News, Scholar, Patents, Forums."""
    return Toolset(
        tools=[
            create_search_tool(**kwargs),
            create_news_tool(**kwargs),
            create_scholar_tool(**kwargs),
            create_patents_tool(**kwargs),
            create_forums_tool(**kwargs),
        ]
    )


def media_toolset(**kwargs) -> Toolset:
    """Media & Visual Toolset: News, Images, YouTube, Search."""
    return Toolset(
        tools=[
            create_news_tool(**kwargs),
            create_images_tool(**kwargs),
            create_youtube_tool(**kwargs),
            create_search_tool(**kwargs),
        ]
    )


def academic_toolset(**kwargs) -> Toolset:
    """Academic & IP Toolset: Scholar, Patents, Search."""
    return Toolset(
        tools=[
            create_scholar_tool(**kwargs),
            create_patents_tool(**kwargs),
            create_search_tool(**kwargs),
        ]
    )


def shopping_toolset(**kwargs) -> Toolset:
    """Shopping Toolset: Shopping, Search, Images, Forums."""
    return Toolset(
        tools=[
            create_shopping_tool(**kwargs),
            create_search_tool(**kwargs),
            create_images_tool(**kwargs),
            create_forums_tool(**kwargs),
        ]
    )


def careers_toolset(**kwargs) -> Toolset:
    """Career Toolset: Jobs, Search, News."""
    return Toolset(
        tools=[
            create_jobs_tool(**kwargs),
            create_search_tool(**kwargs),
            create_news_tool(**kwargs),
        ]
    )


def travel_toolset(**kwargs) -> Toolset:
    """Travel & Stay Toolset: Flights, Hotels, Maps, Events, Search."""
    return Toolset(
        tools=[
            create_flights_tool(**kwargs),
            create_hotels_tool(**kwargs),
            create_maps_tool(**kwargs),
            create_events_tool(**kwargs),
            create_search_tool(**kwargs),
        ]
    )


def finance_toolset(**kwargs) -> Toolset:
    """Finance & Market Toolset: Finance, Trends, News, Search."""
    return Toolset(
        tools=[
            create_finance_tool(**kwargs),
            create_trends_tool(**kwargs),
            create_news_tool(**kwargs),
            create_search_tool(**kwargs),
        ]
    )


def local_toolset(**kwargs) -> Toolset:
    """Local Discovery Toolset: Maps, Events, Search."""
    return Toolset(
        tools=[
            create_maps_tool(**kwargs),
            create_events_tool(**kwargs),
            create_search_tool(**kwargs),
        ]
    )


def universal_toolset(**kwargs) -> Toolset:
    """All registered tools across all 14 verticals."""
    return Toolset(
        tools=[
            create_search_tool(**kwargs),
            create_jobs_tool(**kwargs),
            create_shopping_tool(**kwargs),
            create_news_tool(**kwargs),
            create_scholar_tool(**kwargs),
            create_patents_tool(**kwargs),
            create_forums_tool(**kwargs),
            create_images_tool(**kwargs),
            create_maps_tool(**kwargs),
            create_flights_tool(**kwargs),
            create_hotels_tool(**kwargs),
            create_finance_tool(**kwargs),
            create_trends_tool(**kwargs),
            create_events_tool(**kwargs),
            create_youtube_tool(**kwargs),
        ]
    )


TOOL_FACTORIES = {
    "google_search": create_search_tool,
    "google_jobs": create_jobs_tool,
    "google_shopping": create_shopping_tool,
    "google_news": create_news_tool,
    "google_scholar": create_scholar_tool,
    "google_patents": create_patents_tool,
    "google_forums": create_forums_tool,
    "google_images": create_images_tool,
    "google_maps": create_maps_tool,
    "google_flights": create_flights_tool,
    "google_hotels": create_hotels_tool,
    "google_finance": create_finance_tool,
    "google_trends": create_trends_tool,
    "google_events": create_events_tool,
    "youtube": create_youtube_tool,
}


def toolset_for_analysis(analysis: QueryAnalysis, **kwargs) -> Toolset:
    """Build a minimal Toolset containing only the tools the query needs."""
    wanted = select_tools(analysis, available=list(TOOL_FACTORIES.keys()))
    tools = []
    for tool_name in wanted:
        if tool_name in TOOL_FACTORIES:
            tools.append(TOOL_FACTORIES[tool_name](**kwargs))
    return Toolset(tools=tools or [create_search_tool(**kwargs)])


__all__ = [
    "research_toolset",
    "media_toolset",
    "academic_toolset",
    "shopping_toolset",
    "careers_toolset",
    "travel_toolset",
    "finance_toolset",
    "local_toolset",
    "universal_toolset",
    "toolset_for_analysis",
    "TOOL_FACTORIES",
]
