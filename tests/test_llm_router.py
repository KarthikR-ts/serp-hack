"""Tests for the LLM autonomous router + YouTube vertical (mocked, no keys)."""
import pytest
from fastapi.testclient import TestClient

from serpapi_haystack.agents.llm_router import (
    ENGINE_REGISTRY,
    LLMKeyMissing,
    build_presentation,
    classify_with_llm,
    rank_with_llm,
    resolve_llm_key,
    run_agent,
)
from serpapi_haystack.client import SerpApiClient
from serpapi_haystack.components import SerpApiYouTube
from serpapi_haystack.models import VideoResult
from tests.conftest import FakeResponse

client = TestClient(__import__("serpapi_haystack.server", fromlist=["app"]).app)

YOUTUBE_JSON = {
    "search_metadata": {"id": "yt1"},
    "search_information": {"total_results": 100},
    "video_results": [
        {
            "position_on_page": 1,
            "title": "CRISPR Gene Editing Explained for Beginners",
            "link": "https://www.youtube.com/watch?v=abc123",
            "video_id": "abc123",
            "channel": {"name": "AI Channel", "link": "https://www.youtube.com/@ai", "verified": True},
            "published_date": "2 weeks ago",
            "views": 150000,
            "length": "18:24",
            "description": "Gentle intro to CRISPR.",
            "thumbnail": {"static": "https://i.ytimg.com/vi/abc123/hq720.jpg", "rich": "https://example.com/r.webp"},
        },
        {
            "position_on_page": 2,
            "title": "Advanced CRISPR Research Seminar",
            "link": "https://www.youtube.com/watch?v=def456",
            "video_id": "def456",
            "channel": {"name": "Lab Talks", "link": "https://www.youtube.com/@lab"},
            "views": 8000,
            "length": "55:00",
            "description": "Deep dive into score matching.",
            "thumbnail": {"static": "https://i.ytimg.com/vi/def456/hq720.jpg"},
        },
    ],
}


def test_client_uses_search_query_for_youtube(monkeypatch):
    seen = {}

    class Cap:
        def get(self, url, params=None, timeout=None):
            seen.update(params or {})
            return FakeResponse(YOUTUBE_JSON, 200)

    c = SerpApiClient(api_key="k")
    monkeypatch.setattr(c, "session", Cap())
    c.search("youtube", "crispr", query_param="search_query")
    assert seen.get("search_query") == "crispr"
    assert "q" not in seen


def test_video_result_normalization():
    v = VideoResult.from_serpapi(YOUTUBE_JSON["video_results"][0])
    assert v.video_id == "abc123"
    assert v.thumbnail == "https://i.ytimg.com/vi/abc123/hq720.jpg"
    assert v.channel == "AI Channel" and v.views == 150000


def test_youtube_component_end_to_end():
    comp = SerpApiYouTube(api_key="k")
    comp._client = type("C", (), {"search": lambda self, e, q, **k: YOUTUBE_JSON})()
    out = comp.run("crispr tutorials")
    assert out["metadata"]["engine"] == "youtube"
    assert len(out["results"]) == 2
    assert out["evidence"][0]["tool_used"] == "youtube"
    assert out["evidence"][0]["source_type"] == "video"


def test_youtube_tool_registered():
    from serpapi_haystack.toolsets import TOOL_FACTORIES, universal_toolset

    assert "youtube" in TOOL_FACTORIES
    assert "youtube" in ENGINE_REGISTRY
    assert "youtube" in [t.name for t in universal_toolset(api_key="k")]


def _stub_complete(plan):
    def _fn(system, user):
        return plan

    return _fn


def test_classify_validates_against_registry():
    plan = classify_with_llm(
        "buy headphones",
        complete=_stub_complete(
            {
                "use_case": "shopping",
                "steps": [
                    {"engine": "google_shopping", "query": "headphones", "num_results": 8},
                    {"engine": "fake_engine", "query": "x"},
                ],
                "presentation": "shopping_top2",
                "needs_clarification": False,
                "clarifying_question": "",
                "confidence": "high",
                "reasoning": "buy intent",
            }
        ),
    )
    assert plan.presentation == "shopping_top2"
    assert [s.engine for s in plan.steps] == ["google_shopping"]


def test_classify_fallback_on_empty():
    plan = classify_with_llm("???", complete=_stub_complete({}))
    assert plan.steps[0].engine == "google_search"


def test_run_agent_clarifies(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    out = run_agent(
        "plan a trip",
        complete=_stub_complete(
            {
                "use_case": "travel",
                "steps": [],
                "presentation": "travel_choices",
                "needs_clarification": True,
                "clarifying_question": "Where from and where to?",
                "confidence": "low",
                "reasoning": "missing route",
            }
        ),
    )
    assert out["status"] == "clarify"
    assert out["clarifying_question"] == "Where from and where to?"


def test_rank_fallback_and_presenters():
    results = [
        {"title": "B", "url": "https://b.example", "price": "$20", "image": "https://img.example/b.jpg", "score": 0.5},
        {"title": "A", "url": "https://a.example", "price": "$10", "image": "https://img.example/a.jpg", "score": 0.9},
    ]
    ranking = rank_with_llm("q", results, complete=lambda s, u: {})
    assert ranking["order"] == [0, 1]  # fallback preserves order
    from serpapi_haystack.agents.llm_router import RouterPlan

    pres = build_presentation(
        RouterPlan(use_case="shopping", presentation="shopping_top2"), [{"results": results}], ranking
    )
    assert pres["type"] == "shopping_top2"
    assert len(pres["picks"]) == 2
    assert pres["picks"][0]["image"] and pres["picks"][0]["url"]

    vids = [
        {"title": "Intro 101 basics", "url": "https://yt.example/1", "thumbnail": "https://img.example/1.jpg", "channel": "C"},
        {"title": "Advanced PhD seminar", "url": "https://yt.example/2", "thumbnail": "https://img.example/2.jpg", "channel": "D"},
    ]
    pres2 = build_presentation(
        RouterPlan(use_case="youtube_learning", presentation="youtube_path"),
        [{"results": vids}],
        {"order": [0, 1], "reasons": {}, "summary": "s"},
    )
    assert pres2["levels"]["beginner"] and pres2["levels"]["advanced"]


def test_agent_endpoint_missing_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    r = client.post("/api/agent", json={"query": "buy headphones"})
    assert r.status_code == 503
    assert "OPENROUTER_API_KEY" in r.json()["detail"]


def test_agent_endpoint_ok(monkeypatch):
    import serpapi_haystack.server as server

    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    monkeypatch.setattr(
        server,
        "run_llm_agent",
        lambda q, num_results=8, **kw: {"status": "ok", "query": q, "presentation": {"type": "generic", "results": []}},
    )
    r = client.post("/api/agent", json={"query": "buy headphones"})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_resolve_llm_key_missing(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with pytest.raises(LLMKeyMissing):
        resolve_llm_key()


def test_classifier_prompt_has_strict_guardrails():
    seen = {}

    def cap(system, user):
        seen["system"] = system
        return {}

    classify_with_llm("best wireless keyboard under $100", complete=cap)
    sys_prompt = seen["system"]
    assert "BUY INTENT always means shopping" in sys_prompt
    assert "Never label buy-intent queries" in sys_prompt
    assert "FEW-SHOT" in sys_prompt
    assert "google_shopping" in sys_prompt
    assert "youtube" in sys_prompt


def test_model_selection_via_env(monkeypatch):
    import serpapi_haystack.agents.llm_router as router

    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    monkeypatch.setenv("LLM_MODEL", "google/gemini-2.0-flash-001")
    assert router.resolve_model() == "google/gemini-2.0-flash-001"
    monkeypatch.setattr(
        router,
        "execute_plan",
        lambda plan, budget=None: ([{"engine": "google_search", "results": [], "evidence": []}], router.RunTrace()),
    )
    out = router.run_agent(
        "test query",
        complete=lambda s, u: {"use_case": "research", "steps": [], "presentation": "research_brief"},
    )
    assert out["status"] == "ok"
    assert out["model"] == "google/gemini-2.0-flash-001"


def test_model_default_when_unset(monkeypatch):
    import serpapi_haystack.agents.llm_router as router

    monkeypatch.delenv("LLM_MODEL", raising=False)
    assert router.resolve_model() == router.DEFAULT_MODEL


def test_hard_rules_override_weak_llm_plan():
    bad = {
        "use_case": "research",
        "steps": [{"engine": "google_search", "query": "best wireless keyboard under $100"}],
        "presentation": "research_brief",
        "needs_clarification": False,
        "clarifying_question": "",
        "confidence": "high",
        "reasoning": "weak model missed buy intent",
    }
    plan = classify_with_llm("best wireless keyboard under $100", complete=lambda s, u: bad)
    assert plan.steps[0].engine == "google_shopping"
    assert plan.use_case == "shopping"
    assert plan.presentation == "shopping_top2"


def test_hard_rules_leave_good_plan_alone():
    good = {
        "use_case": "shopping",
        "steps": [{"engine": "google_shopping", "query": "headphones"}],
        "presentation": "shopping_top2",
        "needs_clarification": False,
        "clarifying_question": "",
        "confidence": "high",
        "reasoning": "ok",
    }
    plan = classify_with_llm("buy headphones", complete=lambda s, u: good)
    assert [s.engine for s in plan.steps] == ["google_shopping"]


def test_hard_rules_video_learning():
    bad = {
        "use_case": "research",
        "steps": [{"engine": "google_search", "query": "crispr gene editing"}],
        "presentation": "research_brief",
        "needs_clarification": False,
        "clarifying_question": "",
        "confidence": "high",
        "reasoning": "weak model missed video intent",
    }
    plan = classify_with_llm("teach me crispr with video tutorials", complete=lambda s, u: bad)
    assert plan.steps[0].engine == "youtube"
    assert plan.presentation == "youtube_path"
