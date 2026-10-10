"""Tests for multi-task decomposition, sections shape, reasoning fallback (mocked, no keys)."""
import pytest

import serpapi_haystack.agents.llm_router as router
from serpapi_haystack.agents.intents import split_tasks_regex
from serpapi_haystack.agents.llm_router import (
    RouterPlan,
    build_presentation,
    reasoning_line,
    run_agent,
    run_agent_stream,
)
from serpapi_haystack.utils.observability import RunTrace, ToolCallRecord


def test_split_tasks_multi():
    parts = split_tasks_regex("papers about CRISPR and plan a Goa trip")
    assert len(parts) == 2
    assert [p["id"] for p in parts] == ["task-1", "task-2"]
    assert all(p["label"] and p["query"] for p in parts)
    assert "CRISPR" in parts[0]["query"] and "Goa" in parts[1]["query"]


def test_split_tasks_separators():
    assert len(split_tasks_regex("NVDA stock news; concerts in Bengaluru")) == 2
    assert len(split_tasks_regex("buy a keyboard plus plan a Goa trip")) == 2
    assert len(split_tasks_regex("papers on transformers as well as hotels in Goa")) == 2


def test_split_tasks_single_fallback():
    single = split_tasks_regex("best wireless keyboard under $100")
    assert len(single) == 1
    assert single[0]["query"] == "best wireless keyboard under $100"
    # Same intent family on both sides ("flights and hotels") stays single.
    assert len(split_tasks_regex("flights and hotels in Goa")) == 1
    assert len(split_tasks_regex("")) == 1


def test_split_tasks_caps_at_three():
    parts = split_tasks_regex(
        "papers about CRISPR and NVDA stock news and concerts in Bengaluru and buy a keyboard"
    )
    assert 2 <= len(parts) <= 3


def _canned_execute(plan, budget=None):
    trace = RunTrace()
    outs = []
    for step in plan.steps:
        outs.append(
            {
                "engine": step.engine,
                "results": [{"title": f"{step.engine} hit", "url": "https://example.com/x"}],
                "evidence": [],
            }
        )
        trace.add(ToolCallRecord(tool=step.engine, query=step.query, result_count=1))
    return outs, trace


def _multi_complete(system, user):
    if "classifier" in system:
        return {
            "use_case": "deep_dive",
            "steps": [{"engine": "google_scholar", "query": "CRISPR papers"}],
            "presentation": "deep_dive",
            "needs_clarification": False,
            "clarifying_question": "",
            "confidence": "high",
            "reasoning": "two needs",
            "tasks": [
                {
                    "id": "task-1",
                    "label": "academic",
                    "query": "CRISPR papers",
                    "use_case": "academic",
                    "presentation": "deep_dive",
                    "steps": [{"engine": "google_scholar", "query": "CRISPR papers"}],
                },
                {
                    "id": "task-2",
                    "label": "travel",
                    "query": "Goa trip",
                    "use_case": "travel",
                    "presentation": "travel_choices",
                    "steps": [{"engine": "google_hotels", "query": "hotels Goa"}],
                },
            ],
        }
    return {"order": [0], "reasons": {}, "summary": "ranked"}


@pytest.fixture
def offline_env(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    # Refuse fast so reasoning_line hits the deterministic fallback.
    monkeypatch.setenv("REASONING_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.setattr(router, "execute_plan", _canned_execute)


def test_multitask_sections_shape(offline_env):
    out = run_agent("papers about CRISPR and plan a Goa trip", complete=_multi_complete)
    assert out["status"] == "ok"
    assert [t["id"] for t in out["tasks"]] == ["task-1", "task-2"]
    assert all(set(t) == {"id", "label", "use_case", "status"} for t in out["tasks"])
    assert len(out["sections"]) == 2
    sec = out["sections"][0]
    assert set(sec) == {"task_id", "title", "use_case", "presentation", "results_count", "sources", "route"}
    assert sec["results_count"] == 1
    # Travel backfill guarantees maps alongside hotels: 1 academic + 2 travel.
    assert out["results_count"] == 3
    travel_sec = out["sections"][1]
    assert travel_sec["use_case"] == "travel"
    assert {line["vertical"] for line in travel_sec["route"]} >= {"google_hotels", "google_maps"}
    assert out["presentation"]["type"] == "multi_task"
    assert isinstance(out["reasoning"], list) and len(out["reasoning"]) >= 3
    assert all(isinstance(line, str) and line for line in out["reasoning"])


def test_multitask_regex_fallback_sections(offline_env):
    def _no_tasks(system, user):
        if "classifier" in system:
            return {
                "use_case": "travel",
                "steps": [{"engine": "google_search", "query": "CRISPR Goa"}],
                "presentation": "research_brief",
                "needs_clarification": False,
                "clarifying_question": "",
                "confidence": "low",
                "reasoning": "single",
            }
        return {"order": [0], "reasons": {}, "summary": "ranked"}

    out = run_agent("papers about CRISPR and plan a Goa trip", complete=_no_tasks)
    assert out["status"] == "ok"
    assert len(out["sections"]) == 2  # regex fallback decomposed
    assert len(out["tasks"]) == 2


def test_single_task_sections_uniform(offline_env):
    def _single(system, user):
        if "classifier" in system:
            return {
                "use_case": "shopping",
                "steps": [{"engine": "google_shopping", "query": "wireless keyboard under $100"}],
                "presentation": "shopping_top2",
                "needs_clarification": False,
                "clarifying_question": "",
                "confidence": "high",
                "reasoning": "buy intent",
            }
        return {"order": [0], "reasons": {}, "summary": "ranked"}

    out = run_agent("best wireless keyboard under $100", complete=_single)
    assert out["status"] == "ok"
    assert len(out["sections"]) == 1
    assert len(out["tasks"]) == 1
    assert out["presentation"]["type"] == "shopping_top2"
    assert "deals_note" in out["presentation"]


def test_stream_events_shape(offline_env):
    events = list(run_agent_stream("papers about CRISPR and plan a Goa trip", complete=_multi_complete))
    kinds = [e["event"] for e in events]
    assert kinds[0] == "reasoning"
    assert kinds[-1] == "answer_complete"
    assert kinds.count("task_started") == 2
    assert kinds.count("task_done") == 2
    started = [e["data"] for e in events if e["event"] == "task_started"]
    assert {d["id"] for d in started} == {"task-1", "task-2"}
    assert all("label" in d for d in started)
    tools = [e["data"] for e in events if e["event"] == "tool_completed"]
    assert all(set(d) == {"tool", "status", "count"} for d in tools)
    payload = events[-1]["data"]
    assert payload["status"] == "ok" and len(payload["sections"]) == 2


def test_reasoning_fallback_no_key(monkeypatch):
    monkeypatch.delenv("REASONING_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert reasoning_line("summarize this", "fallback-template") == "fallback-template"


def test_reasoning_fallback_on_error(monkeypatch):
    monkeypatch.setenv("REASONING_API_KEY", "bogus")
    monkeypatch.setenv("REASONING_BASE_URL", "http://127.0.0.1:9")
    assert reasoning_line("summarize this", "fallback-template") == "fallback-template"


def test_shopping_deals_note():
    results = [
        {"title": f"Item {i}", "url": f"https://s.example/{i}", "price": f"${10 * i}", "score": 1.0 - i / 10}
        for i in range(1, 7)
    ]
    pres = build_presentation(
        RouterPlan(use_case="shopping", presentation="shopping_top2"),
        [{"results": results}],
        {"order": list(range(6)), "reasons": {}, "summary": "s"},
    )
    assert pres["type"] == "shopping_top2"
    assert len(pres["picks"]) == 5
    assert pres["deals_note"]


def test_travel_itinerary_fallback():
    places = [
        {"title": f"Place {i}", "url": f"https://m.example/{i}", "_engine": "google_maps"}
        for i in range(5)
    ]
    pres = build_presentation(
        RouterPlan(use_case="travel", presentation="travel_choices"),
        [{"engine": "google_maps", "results": places}],
        {"order": list(range(5)), "reasons": {}, "summary": "s"},
    )
    assert len(pres["top_places"]) == 5
    assert all("why" in p for p in pres["top_places"])
    assert len(pres["itinerary"]) == 2  # 5 places, 3 per day
    assert pres["itinerary"][0]["items"]
    assert pres["places"]  # old key kept


def test_deep_dive_top_picks_sorted():
    papers = [
        {"title": "Low", "url": "https://a.example/1", "citations": 3, "_engine": "google_scholar"},
        {"title": "High", "url": "https://a.example/2", "citations": 300, "_engine": "google_scholar"},
        {"title": "Mid", "url": "https://a.example/3", "citations": 40, "_engine": "google_scholar"},
        {"title": "None", "url": "https://a.example/4", "_engine": "google_scholar"},
    ]
    pres = build_presentation(
        RouterPlan(use_case="academic", presentation="deep_dive"),
        [{"engine": "google_scholar", "results": papers}],
        {"order": [0, 1, 2, 3], "reasons": {}, "summary": "s"},
    )
    assert [p["title"] for p in pres["papers"]][:3] == ["High", "Mid", "Low"]
    assert len(pres["top_picks"]) == 3
    assert pres["top_picks"][0]["citations"] == 300
    assert all(set(p) == {"title", "url", "citations", "pick_reason"} for p in pres["top_picks"])
    assert pres["findings"]  # old key kept


def test_split_injects_context_into_fragment():
    parts = split_tasks_regex(
        "Find me the best sources to learn Bitcoin. Include the white paper "
        "as well as some good explainer YouTube videos as well."
    )
    assert len(parts) == 2
    frag = parts[1]
    assert "bitcoin" in frag["query"].lower()
    assert "youtube" in frag["query"].lower()
    assert "YouTube" in frag["label"]


def test_split_leaves_complete_clauses_alone():
    parts = split_tasks_regex(
        "Find me research papers about CRISPR and also plan a 4-day trip to Goa as well"
    )
    assert [p["query"] for p in parts] == [
        "Find me research papers about CRISPR",
        "plan a 4-day trip to Goa",
    ]


def test_regex_subtasks_video_engine():
    from serpapi_haystack.agents.llm_router import _regex_subtasks

    tasks = _regex_subtasks(
        "Find me the best sources to learn Bitcoin. Include the white paper "
        "as well as some good explainer YouTube videos as well."
    )
    by_id = {t.id: t for t in tasks}
    assert by_id["task-2"].use_case == "youtube_learning"
    assert by_id["task-2"].presentation == "youtube_path"
    assert [s.engine for s in by_id["task-2"].steps] == ["youtube"]
    assert "bitcoin" in by_id["task-2"].query.lower()


def _demo_sections():
    return [
        {
            "task_id": "task-1",
            "title": "Papers",
            "use_case": "academic",
            "presentation": {
                "type": "deep_dive",
                "papers": [
                    {"title": "CRISPR screens", "url": "https://a.example/1", "citations": 120},
                    {"title": "Base editing", "url": "https://a.example/2", "citations": 45},
                ],
                "top_picks": [
                    {"title": "CRISPR screens", "url": "https://a.example/1", "citations": 120, "pick_reason": "most cited"}
                ],
                "findings": [{"claim": "Screens scale well", "url": "https://a.example/1"}],
            },
            "results_count": 2,
            "sources": [],
            "route": [{"vertical": "google_scholar", "status": "ok"}],
        }
    ]


def test_digest_fallback_has_all_headings():
    from serpapi_haystack.agents.llm_router import _DIGEST_HEADINGS, _digest_fallback

    text = _digest_fallback("CRISPR papers?", _demo_sections(), [{"vertical": "google_scholar", "status": "ok"}], ["Planned."])
    for h in _DIGEST_HEADINGS:
        assert f"[{h}]" in text


def test_digest_rejects_headingless_llm_output():
    from serpapi_haystack.agents.llm_router import build_digest_summary

    text = build_digest_summary(
        "CRISPR papers?",
        _demo_sections(),
        [{"vertical": "google_scholar", "status": "ok"}],
        ["Planned."],
        text_fn=lambda prompt, fb: "Some prose without any headings at all.",
    )
    assert "[What I found]" in text  # fell back


def test_digest_humanizes_engine_ids():
    from serpapi_haystack.agents.llm_router import _humanize

    assert "google_scholar" not in _humanize("via google_search, google_scholar and youtube")
    assert "Scholar" in _humanize("via google_scholar")
    assert "newspaper" in _humanize("the newspaper")  # no substring mangling


def test_short_verdict_is_plain():
    from serpapi_haystack.agents.llm_router import _short_verdict

    v = _short_verdict("Explain JEV model?", _demo_sections())
    assert "google_" not in v and "[" not in v
    assert "2 result" in v and "CRISPR" in v


def test_digest_uses_llm_when_structured():
    from serpapi_haystack.agents.llm_router import build_digest_summary

    llm = "[What you asked]\nYou want CRISPR papers.\n[What I found]\nTwo papers."
    text = build_digest_summary(
        "CRISPR papers?",
        _demo_sections(),
        [{"vertical": "google_scholar", "status": "ok"}],
        ["Planned."],
        text_fn=lambda prompt, fb: llm,
    )
    assert text.startswith("[What you asked]")
