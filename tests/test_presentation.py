"""Tests for presentation helpers + new server endpoints (mocked)."""
from fastapi.testclient import TestClient

from serpapi_haystack.server import app
from serpapi_haystack.utils.observability import RunTrace, ToolCallRecord
from serpapi_haystack.utils.presentation import (
    apply_funnel,
    attach_evidence,
    build_route,
    completeness,
    confidence_with_reasons,
    match_constraints,
    parse_amount,
    refinements_for,
    usage_snapshot,
    why_for,
)

client = TestClient(app)


def test_parse_amount():
    assert parse_amount("₹74,990") == 74990.0
    assert parse_amount("$13.86") == 13.86
    assert parse_amount(None) is None
    assert parse_amount("not listed") is None


def test_match_constraints_budget_and_rating():
    assert match_constraints({"numeric_price": 90000.0}, {"budget": 80000.0}) == "Over budget"
    assert match_constraints({"numeric_price": 50000.0}, {"budget": 80000.0}) is None
    assert match_constraints({"rating": 3.2}, {"min_rating": 4.0}) == "Below rating"
    assert match_constraints({"location": "Delhi", "company": "X", "title": "Dev"}, {"location": "bengaluru"}) == "Outside location"
    assert match_constraints({"location": "Remote", "company": "X", "title": "Dev"}, {"location": "bengaluru"}) is None


def test_funnel_counts_and_reasons():
    results = [
        {"title": "A", "numeric_price": 90000.0},
        {"title": "B", "numeric_price": 50000.0},
        {"title": "C", "numeric_price": 120000.0},
    ]
    funnel = apply_funnel(results, {"budget": 80000.0})
    assert (funnel["discovered"], funnel["matched"], funnel["set_aside"]) == (3, 1, 2)
    assert funnel["reasons"] == [{"label": "Over budget", "count": 2}]


def test_why_confidence_completeness_shapes():
    why = why_for({"price": "$10", "numeric_price": 10.0, "rating": 4.5, "reviews": 100}, {"budget": 50}, 0, 4)
    assert why and all({"criterion", "met", "text"} <= set(w) for w in why)
    conf = confidence_with_reasons(9, 0, 3, {"budget": 1})
    assert conf["level"] == "high" and len(conf["reasons"]) >= 2
    assert completeness(4, 4, 0)["state"] == "complete"
    assert completeness(4, 2, 2)["state"] == "partial"
    assert completeness(2, 0, 2)["state"] == "failed"


def test_attach_evidence_links():
    results = [{"title": "T", "url": "https://example.com/a"}]
    evidence = [{"source_url": "https://example.com/a?utm=x", "source_title": "T", "source_type": "organic", "extracted_claim": "c", "kind": "FACT"}]
    # tracking params differ, so no link yet; canonical match:
    evidence[0]["source_url"] = "https://example.com/a"
    linked_results, linked_evidence = attach_evidence(results, evidence)
    assert linked_evidence[0]["id"] == "e1"
    assert linked_evidence[0]["domain"] == "example.com"
    assert linked_results[0]["evidence_ids"] == ["e1"]


def test_route_and_refinements():
    trace = RunTrace()
    trace.add(ToolCallRecord(tool="google_search", query="x", result_count=3))
    trace.add(ToolCallRecord(tool="google_jobs", query="y", error="boom"))
    route = build_route(["google_search", "google_jobs", "google_news"], trace.calls)
    assert [line["status"] for line in route] == ["ok", "failed", "skipped"]
    assert route[0]["name"] == "Web" and route[0]["family"] == "web"
    assert len(refinements_for("shopping")) == 5


def test_config_usage_intents_endpoints():
    cfg = client.get("/api/config").json()
    assert cfg["limits"]["max_serpapi_calls"] == 12
    assert "auto" not in cfg["modes"]  # domain modes only
    assert cfg["features"]["agent"] is True
    usage = client.get("/api/usage").json()
    assert {"queries", "serpapi_calls", "calls_per_query", "calls_by_tool"} <= set(usage)
    body = client.post("/api/intents", json={"query": "buy headphones"}).json()
    assert {"estimated_calls", "estimated_seconds", "requires_confirmation"} <= set(body)
    assert body["estimated_calls"] >= 1
