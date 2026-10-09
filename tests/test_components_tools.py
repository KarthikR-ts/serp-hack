"""Phase 2 + 3 tests: components normalize; tools wrap; toolsets select; agent helpers."""
from haystack.tools import ComponentTool, Toolset

from serpapi_haystack.agents import build_plan, classify_query, select_tools, synthesis_input
from serpapi_haystack.components import SerpApiGoogleJobs, SerpApiGoogleSearch, SerpApiGoogleShopping
from serpapi_haystack.tools import (
    JOBS_DESCRIPTION,
    SEARCH_DESCRIPTION,
    SHOPPING_DESCRIPTION,
    create_jobs_tool,
    create_search_tool,
    create_shopping_tool,
)
from serpapi_haystack.toolsets import careers_toolset, shopping_toolset, toolset_for_analysis, universal_toolset
from tests.conftest import JOBS_JSON, SEARCH_JSON, SHOPPING_JSON, FakeResponse


def _patch(comp, payload):
    comp._client = type("C", (), {"search": lambda self, e, q, **k: payload})()


def test_search_component_normalizes():
    c = SerpApiGoogleSearch(api_key="k")
    _patch(c, SEARCH_JSON)
    out = c.run("laptops", num_results=10)
    assert out["metadata"]["engine"] == "google"
    # duplicate URL collapsed
    assert out["metadata"]["result_count"] == 1
    assert out["evidence"] and out["evidence"][0]["tool_used"] == "google_search"


def test_jobs_component_normalizes():
    c = SerpApiGoogleJobs(api_key="k")
    _patch(c, JOBS_JSON)
    out = c.run("internships", location="Bengaluru")
    assert len(out["results"]) == 2
    assert out["results"][0]["company"] == "Company A"
    assert out["evidence"][0]["source_type"] == "job"


def test_shopping_component_normalizes():
    c = SerpApiGoogleShopping(api_key="k")
    _patch(c, SHOPPING_JSON)
    out = c.run("OLED monitor")
    assert out["results"][0]["numeric_price"] == 449.0
    assert out["evidence"][0]["source_type"] == "product"


def test_component_serialization_roundtrip():
    for cls in (SerpApiGoogleSearch, SerpApiGoogleJobs, SerpApiGoogleShopping):
        c = cls(api_key="k", hl="en", gl="us")
        d = c.to_dict()
        c2 = cls.from_dict(d)
        assert c2.hl == "en"


def test_tool_wrapping_schema_and_descriptions():
    t = create_search_tool(api_key="k")
    assert isinstance(t, ComponentTool)
    assert t.name == "google_search"
    assert "live Google" in t.description
    assert SEARCH_DESCRIPTION and JOBS_DESCRIPTION and SHOPPING_DESCRIPTION
    assert create_jobs_tool(api_key="k").name == "google_jobs"
    assert create_shopping_tool(api_key="k").name == "google_shopping"


def test_toolsets_and_dynamic_selection():
    assert isinstance(universal_toolset(api_key="k"), Toolset)
    assert isinstance(shopping_toolset(api_key="k"), Toolset)
    assert isinstance(careers_toolset(api_key="k"), Toolset)
    a = classify_query("Find software engineering internships in Bengaluru")
    assert "JOB_SEARCH" in a.intent
    assert select_tools(a) == ["google_jobs", "google_search"]
    ts = toolset_for_analysis(a, api_key="k")
    assert isinstance(ts, Toolset)


def test_golden_cases_tool_selection():
    # PRD Sec 118 golden cases
    assert "google_shopping" in classify_query("Find laptops under $800").tools
    assert "google_jobs" in classify_query("Find software engineering internships.").tools
    assert "google_search" in classify_query("Teach me CRISPR.").tools


def test_planner_and_synthesis_contract():
    a = classify_query("Should I buy this laptop for programming?")
    plan = build_plan(a, "Should I buy this laptop for programming?")
    assert len(plan) >= 1 and len(plan) <= 8
    synth = synthesis_input("q", a, [{"results": [{"title": "T"}], "evidence": []}])
    assert set(synth) == {"user_request", "structured_intent", "results", "evidence", "constraints"}


def test_async_component(monkeypatch=None):
    import asyncio

    c = SerpApiGoogleSearch(api_key="k")
    _patch(c, SEARCH_JSON)
    out = asyncio.run(c.run_async("x"))
    assert "results" in out
