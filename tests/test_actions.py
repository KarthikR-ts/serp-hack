"""Tests for agentic handoff: Action model, slots, and presentation wiring (mocked)."""
import re

from serpapi_haystack.agents.llm_router import (
    RouterPlan,
    RouterStep,
    build_presentation,
    classify_with_llm,
    run_agent,
)
from serpapi_haystack.models.actions import (
    action_for_result,
    attach_actions,
    flights_search_url,
    is_safe_url,
    primary_url,
)


def test_safe_url_only_http():
    assert is_safe_url("https://example.com/a")
    assert is_safe_url("http://example.com")
    assert not is_safe_url("ftp://example.com/x")
    assert not is_safe_url("javascript:alert(1)")
    assert not is_safe_url("")
    assert not is_safe_url(None)


def test_primary_url_prefers_result_fields():
    assert primary_url({"url": "https://a.example", "link": "https://b.example"}) == "https://a.example"
    assert primary_url({"application_url": "https://jobs.example/1"}) == "https://jobs.example/1"
    assert primary_url({"ticket_links": ["https://t.example/e"]}) == "https://t.example/e"
    assert primary_url({"url": "javascript:x"}) == ""


def test_flight_action_book_ticket():
    flight = {"airline": "IndiGo", "flight_number": "6E 123", "price": "₹12,400", "url": "https://book.example/f1"}
    action = action_for_result(flight, "travel", 0, {})
    assert action.kind == "book_flight"
    assert action.label == "Book ticket"
    assert action.url == "https://book.example/f1"
    assert action.external is True


def test_flight_action_falls_back_to_search_url():
    flight = {"airline": "AI", "_engine": "google_flights"}
    action = action_for_result(
        flight, "travel", 0, {"origin": "Bengaluru", "destination": "Tokyo", "dates": "Dec 12"}
    )
    assert action.kind == "book_flight"
    assert "google.com/travel/flights" in action.url
    assert "Tokyo" in action.url


def test_other_kinds():
    assert action_for_result({"name": "Taj", "_engine": "google_hotels", "url": "https://h.example"}, "travel", 0, {}).kind == "book_hotel"
    assert action_for_result({"company": "Acme", "application_url": "https://a.example/j"}, "jobs", 0, {}).label == "Open application"
    assert action_for_result({"title": "Kbd", "seller": "S", "url": "https://s.example"}, "shopping", 0, {}).kind == "buy"
    assert action_for_result({"title": "V", "channel": "C", "url": "https://yt.example"}, "youtube_learning", 0, {}).kind == "watch"
    assert action_for_result({"title": "P", "authors": "A", "url": "https://p.example"}, "academic", 0, {}).kind == "read"
    assert action_for_result({"title": "Cafe", "address": "MG Rd"}, "local", 0, {}).kind == "directions"
    assert action_for_result({"title": "E", "venue": "Hall", "url": "https://e.example"}, "events", 0, {}).kind == "tickets"


def test_attach_actions_travel_choices():
    pres = {
        "type": "travel_choices",
        "flights": [{"airline": "IndiGo", "price": "₹12,400", "url": "https://book.example/f1"}],
        "hotels": [{"name": "Taj", "price": "₹8,000", "url": "https://h.example"}],
        "places": [],
        "summary": "s",
    }
    out = attach_actions(pres, "travel", {"origin": "BLR", "destination": "Tokyo"})
    assert len(out["actions"]) == 2
    assert out["flights"][0]["action"]["label"] == "Book ticket"
    assert out["hotels"][0]["action"]["label"] == "Reserve room"


def test_build_presentation_injects_actions():
    results = [
        {"title": "Kbd", "url": "https://s.example/k", "price": "$49", "seller": "Shop", "image": "https://img.example/k.jpg"},
        {"title": "Kbd 2", "url": "https://s.example/k2", "price": "$59", "seller": "Shop"},
    ]
    pres = build_presentation(
        RouterPlan(use_case="shopping", presentation="shopping_top2"),
        [{"results": results}],
        {"order": [0, 1], "reasons": {}, "summary": "two picks"},
    )
    assert pres["picks"][0]["action"]["kind"] == "buy"
    assert pres["actions"][0]["label"] == "View deal"


def test_slots_parsed_from_llm():
    plan = classify_with_llm(
        "book a flight from Bengaluru to Tokyo next month",
        complete=lambda s, u: {
            "use_case": "travel",
            "steps": [{"engine": "google_flights", "query": "Bengaluru Tokyo flights"}],
            "presentation": "travel_choices",
            "needs_clarification": False,
            "clarifying_question": "",
            "slots": {"origin": "Bengaluru", "destination": "Tokyo", "dates": "next month"},
            "missing_slots": [],
            "confidence": "high",
            "reasoning": "full route",
        },
    )
    assert plan.slots == {"origin": "Bengaluru", "destination": "Tokyo", "dates": "next month"}
    assert plan.missing_slots == []


def test_clarify_carries_missing_slots(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    out = run_agent(
        "plan a trip",
        complete=lambda s, u: {
            "use_case": "travel",
            "steps": [],
            "presentation": "travel_choices",
            "needs_clarification": True,
            "clarifying_question": "Where from and where to?",
            "slots": {},
            "missing_slots": ["origin", "destination", "dates"],
            "confidence": "low",
            "reasoning": "missing route",
        },
    )
    assert out["status"] == "clarify"
    assert out["missing_slots"] == ["origin", "destination", "dates"]


def test_run_agent_ok_carries_slots_and_actions(monkeypatch):
    import serpapi_haystack.agents.llm_router as router

    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    monkeypatch.setattr(
        router,
        "execute_plan",
        lambda plan, budget=None: (
            [{
                "engine": "google_flights",
                "results": [{"airline": "IndiGo", "price": "₹12,400", "url": "https://book.example/f1"}],
                "evidence": [],
            }],
            router.RunTrace(),
        ),
    )
    out = router.run_agent(
        "book a flight from Bengaluru to Tokyo",
        complete=lambda s, u: {
            "use_case": "travel",
            "steps": [{"engine": "google_flights", "query": "Bengaluru Tokyo flights"}],
            "presentation": "travel_choices",
            "needs_clarification": False,
            "clarifying_question": "",
            "slots": {"origin": "Bengaluru", "destination": "Tokyo"},
            "missing_slots": ["dates"],
            "confidence": "high",
            "reasoning": "route known",
            "order": [0],
            "reasons": {},
            "summary": "one flight",
        },
    )
    assert out["status"] == "ok"
    assert out["slots"]["destination"] == "Tokyo"
    assert out["missing_slots"] == ["dates"]
    assert out["presentation"]["actions"][0]["label"] == "Book ticket"


def test_chat_enrichment_attaches_actions():
    from fastapi.testclient import TestClient

    from serpapi_haystack import server

    real_execute = server.execute_tools

    def fake_execute(toolset, query, num_results, budget):
        from serpapi_haystack.utils.observability import RunTrace

        return (
            [{
                "engine": "google_jobs",
                "results": [{"title": "SWE Intern", "company": "Acme", "application_url": "https://a.example/j"}],
                "evidence": [],
            }],
            RunTrace(),
        )

    server.execute_tools = fake_execute
    try:
        client = TestClient(server.app)
        body = client.post("/api/chat", json={"query": "software engineering internships", "mode": "jobs"}).json()
    finally:
        server.execute_tools = real_execute
    assert body["results"][0]["action"]["label"] == "Open application"
    assert body["actions"][0]["kind"] == "apply"


def test_flights_search_url_builder():
    url = flights_search_url("Bengaluru", "Tokyo", "Dec 12")
    assert url.startswith("https://www.google.com/travel/flights?q=")
    assert "Tokyo" in url


def test_travel_booking_beats_buy_intent_rule():
    """'book a flight … under 60000' is travel, not shopping, despite the budget."""
    llm_said_travel = {
        "use_case": "travel",
        "steps": [
            {"engine": "google_flights", "query": "Bengaluru Tokyo flights"},
            {"engine": "google_hotels", "query": "Tokyo hotels"},
        ],
        "presentation": "travel_choices",
        "needs_clarification": False,
        "clarifying_question": "",
        "slots": {"origin": "Bengaluru", "destination": "Tokyo"},
        "missing_slots": ["dates"],
        "confidence": "high",
        "reasoning": "route known",
    }
    plan = classify_with_llm(
        "book a flight from Bengaluru to Tokyo next month under 60000",
        complete=lambda s, u: llm_said_travel,
    )
    assert plan.use_case == "travel"
    assert plan.presentation == "travel_choices"
    assert plan.steps[0].engine == "google_flights"


def test_travel_booking_repairs_shopping_plan():
    shopping_plan = {
        "use_case": "shopping",
        "steps": [{"engine": "google_shopping", "query": "flight under 60000"}],
        "presentation": "shopping_top2",
        "needs_clarification": False,
        "clarifying_question": "",
        "confidence": "high",
        "reasoning": "weak model saw only the budget",
    }
    plan = classify_with_llm(
        "book a hotel in Tokyo under 20000", complete=lambda s, u: shopping_plan
    )
    assert plan.use_case == "travel"
    assert "google_shopping" not in [s.engine for s in plan.steps]


def test_invoke_kwargs_flights_resolves_airports():
    from serpapi_haystack.agents.llm_router import _invoke_kwargs

    kwargs = _invoke_kwargs(
        RouterStep(engine="google_flights", query="Bengaluru to Tokyo flights"),
        {"origin": "Bengaluru", "destination": "Tokyo", "dates": "next month"},
    )
    assert kwargs is not None
    assert kwargs["departure_id"] == "BLR"
    assert kwargs["arrival_id"] == "NRT"
    assert "query" not in kwargs


def test_invoke_kwargs_flights_skips_without_route():
    from serpapi_haystack.agents.llm_router import _invoke_kwargs

    assert _invoke_kwargs(RouterStep(engine="google_flights", query="cheap flights"), {}) is None


def test_invoke_kwargs_hotels_always_has_dates():
    from serpapi_haystack.agents.llm_router import _invoke_kwargs

    kwargs = _invoke_kwargs(RouterStep(engine="google_hotels", query="hotels Tokyo"), {})
    assert kwargs is not None
    assert re.fullmatch(r"20\d{2}-\d{2}-\d{2}", kwargs["check_in_date"])
    assert re.fullmatch(r"20\d{2}-\d{2}-\d{2}", kwargs["check_out_date"])


def test_invoke_kwargs_trends_drops_num_results():
    from serpapi_haystack.agents.llm_router import _invoke_kwargs

    kwargs = _invoke_kwargs(RouterStep(engine="google_trends", query="AI agents"), {})
    assert kwargs is not None and "num_results" not in kwargs


def test_travel_utils():
    import datetime as dt

    from serpapi_haystack.utils.travel import flight_dates, parse_trip_dates, resolve_airport

    assert resolve_airport("Bengaluru") == "BLR"
    assert resolve_airport("fly BLR to NRT") == "BLR"
    assert resolve_airport("Tokyo") == "NRT"  # primary airport, not metro code
    assert resolve_airport("") is None
    assert resolve_airport("Mordor") is None
    check_in, check_out = parse_trip_dates("Dec 12 - Dec 15", today=dt.date(2026, 10, 10))
    assert (check_in, check_out) == ("2026-12-12", "2026-12-15")
    check_in2, check_out2 = parse_trip_dates(None, today=dt.date(2026, 10, 10))
    assert (check_in2, check_out2) == ("2026-11-09", "2026-11-12")
    assert flight_dates("next month") == (check_in2, None)  # one-way, no invented return
    assert flight_dates("Dec 12 - Dec 15", today=dt.date(2026, 10, 10)) == ("2026-12-12", "2026-12-15")


def test_execute_plan_calls_flights_natively(monkeypatch):
    import serpapi_haystack.agents.llm_router as router

    seen = {}

    class FakeTool:
        def invoke(self, **kwargs):
            seen.update(kwargs)
            return {"results": [{"airline": "IndiGo", "url": "https://book.example/f1"}], "evidence": []}

    monkeypatch.setitem(router.TOOL_FACTORIES, "google_flights", lambda **kw: FakeTool())
    plan = RouterPlan(
        use_case="travel",
        presentation="travel_choices",
        steps=[RouterStep(engine="google_flights", query="Bengaluru to Tokyo flights")],
        slots={"origin": "Bengaluru", "destination": "Tokyo"},
    )
    outputs, trace = router.execute_plan(plan)
    assert seen.get("departure_id") == "BLR" and seen.get("arrival_id") == "NRT"
    assert outputs[0]["results"][0]["airline"] == "IndiGo"


def test_client_search_without_q_for_flights():
    from serpapi_haystack.client import SerpApiClient
    from tests.conftest import FakeResponse

    seen = {}

    class Cap:
        def get(self, url, params=None, timeout=None):
            seen.update(params or {})
            return FakeResponse({"best_flights": []}, 200)

    c = SerpApiClient(api_key="k")
    c.session = Cap()
    c.search("google_flights", departure_id="BLR", arrival_id="TYO")
    assert seen.get("departure_id") == "BLR"
    assert seen.get("arrival_id") == "TYO"
    assert "q" not in seen


def test_flights_component_end_to_end():
    from serpapi_haystack.components import SerpApiGoogleFlights

    raw = {
        "best_flights": [
            {
                "flights": [{"airline": "IndiGo", "flight_number": "6E 123",
                             "departure_airport": {"name": "BLR"}, "arrival_airport": {"name": "TYO"}}],
                "total_duration": "9h", "price": "₹42,000",
                "link": "https://book.example/f1",
            }
        ]
    }
    comp = SerpApiGoogleFlights(api_key="k")
    comp._client = type("C", (), {"search": lambda self, e, **k: raw})()
    out = comp.run(departure_id="BLR", arrival_id="TYO", outbound_date="2026-11-09")
    assert out["metadata"]["engine"] == "google_flights"
    assert out["results"][0]["airline"] == "IndiGo"
    assert out["results"][0]["url"] == "https://book.example/f1"
