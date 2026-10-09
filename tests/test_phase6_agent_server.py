"""Unit tests for Phase 6 router, toolsets, universal agent planner, and FastAPI server."""

import pytest
from fastapi.testclient import TestClient

from serpapi_haystack.agents.intents import classify_query, select_tools
from serpapi_haystack.agents.universal import build_plan, synthesis_input
from serpapi_haystack.server import app
from serpapi_haystack.toolsets import (
    academic_toolset,
    careers_toolset,
    finance_toolset,
    local_toolset,
    media_toolset,
    research_toolset,
    shopping_toolset,
    toolset_for_analysis,
    travel_toolset,
    universal_toolset,
)

client = TestClient(app)


def test_intent_classification_rules():
    res1 = classify_query("Find recent papers on CRISPR gene editing")
    assert "ACADEMIC_RESEARCH" in res1.intent
    assert "google_scholar" in res1.tools

    res2 = classify_query("Buy OLED monitor under $500")
    assert "SHOPPING" in res2.intent
    assert res2.constraints.get("budget") == 500.0
    assert "google_shopping" in res2.tools

    res3 = classify_query("Flight from JFK to LAX and hotel booking in Tokyo")
    assert "TRAVEL" in res3.intent
    assert "google_flights" in res3.tools or "google_hotels" in res3.tools

    res4 = classify_query("Apple stock price GOOGL market trend")
    assert "FINANCE" in res4.intent
    assert "google_finance" in res4.tools


def test_toolsets_construction():
    assert len(research_toolset(api_key="test").tools) == 5
    assert len(travel_toolset(api_key="test").tools) == 5
    assert len(academic_toolset(api_key="test").tools) == 3
    assert len(universal_toolset(api_key="test").tools) == 15


def test_toolset_for_analysis():
    analysis = classify_query("Tesla stock price and recent news")
    ts = toolset_for_analysis(analysis, api_key="test")
    names = [t.name for t in ts.tools]
    assert "google_finance" in names or "google_news" in names or "google_search" in names


def test_universal_planner():
    analysis = classify_query("Find ML internships in Bengaluru and compare top companies")
    plan = build_plan(analysis, "Find ML internships in Bengaluru")
    assert len(plan) >= 2
    assert plan[-1].action == "compare"


def test_fastapi_server_endpoints(monkeypatch):
    res_health = client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "ok"

    res_tools = client.get("/api/tools")
    assert res_tools.status_code == 200
    tools = res_tools.json()
    assert len(tools) == 15

    res_intents = client.post("/api/intents", json={"query": "Find software engineer jobs"})
    assert res_intents.status_code == 200
    body = res_intents.json()
    assert "analysis" in body
    assert "plan" in body
