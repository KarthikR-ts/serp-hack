"""FastAPI Web Application & API Server (Phase 6-8, PRD Sec 87-96, 124, 130).

Phase 7: Home/Chat/Trace/Sources/Cards + SSE streaming.
Phase 8: Research / Shopping / Learning / Jobs / Travel domain modes.

Safety (PRD Sec 81-84):
- SERPAPI_API_KEY resolved server-side only, never accepted from frontend,
  never returned, never logged.
- Input validation + sanitization, per-IP rate limiting, security headers.
- Tools are READ-ONLY. No purchase/apply/book endpoints exist.
- Tool outputs treated as untrusted data, never as instructions.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Literal

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from serpapi_haystack.agents.intents import QueryAnalysis, classify_query
from serpapi_haystack.agents.llm_router import LLMKeyMissing
from serpapi_haystack.agents.llm_router import run_agent as run_llm_agent
from serpapi_haystack.agents.universal import build_plan, synthesis_input
from serpapi_haystack.models.actions import action_for_result
from serpapi_haystack.utils.presentation import (
    apply_funnel,
    attach_evidence,
    build_route,
    completeness,
    confidence_with_reasons,
    refinements_for,
    record_usage,
    usage_snapshot,
    why_for,
)
from serpapi_haystack.toolsets import (
    TOOL_FACTORIES,
    academic_toolset,
    careers_toolset,
    finance_toolset,
    local_toolset,
    research_toolset,
    shopping_toolset,
    toolset_for_analysis,
    travel_toolset,
    universal_toolset,
)
from serpapi_haystack.utils.limits import BudgetLimits, BudgetTracker, run_parallel
from serpapi_haystack.utils.observability import RunTrace, ToolCallRecord

app = FastAPI(
    title="SerpApi x Haystack — Universal Web Intelligence API",
    description="Universal agent composing 14 SerpApi verticals. Phase 7-8: streaming + domain modes.",
    version="0.2.0",
)

# CORS: same-origin frontend + local dev. No credentials with wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'"
    )
    return resp


# --- Rate limiting (in-memory, per IP) --------------------------------------
_RATE: dict[str, list[float]] = {}
_LIMITS = {
    "chat": (30, 60.0),  # 30 req / 60s
    "default": (60, 60.0),
}


def _check_rate(request: Request, bucket: str = "default") -> None:
    max_req, window = _LIMITS.get(bucket, _LIMITS["default"])
    ip = request.client.host if request.client else "unknown"
    key = f"{bucket}:{ip}"
    now = time.monotonic()
    hits = [t for t in _RATE.get(key, []) if now - t < window]
    if len(hits) >= max_req:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Retry shortly.")
    hits.append(now)
    _RATE[key] = hits


# --- Validation + sanitization ----------------------------------------------
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_query(q: str, max_len: int = 500) -> str:
    q = _CONTROL_RE.sub("", q or "").strip()
    # Strip trivial HTML tag attempts; frontend renders via textContent anyway.
    q = re.sub(r"<[^>]{0,200}>", "", q).strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    if len(q) > max_len:
        raise HTTPException(status_code=400, detail=f"Query too long (max {max_len} chars).")
    return q


Mode = Literal["auto", "research", "shopping", "jobs", "learning", "travel"]


class IntentRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)


class SearchRequest(BaseModel):
    engine: str = Field("google_search")
    query: str = Field(..., min_length=1, max_length=500)
    num_results: int = Field(10, ge=1, le=10)
    location: str | None = Field(None, max_length=120)


class ChatRequest(BaseModel):
    # NOTE: no api_key field. Key resolves server-side only (PRD Sec 81).
    query: str = Field(..., min_length=1, max_length=500)
    mode: Mode = Field("auto")
    deep_research: bool = Field(False)
    conversation_id: str | None = Field(None, max_length=64)
    num_results: int = Field(10, ge=1, le=10)
    filters: dict[str, Any] = Field(default_factory=dict)
    context: list[str] = Field(default_factory=list)


class AgentRequest(BaseModel):
    # Autonomous LLM flow: classify -> exact endpoints -> ranked picks.
    # No key fields: SERPAPI_API_KEY + OPENROUTER_API_KEY resolve server-side.
    query: str = Field(..., min_length=1, max_length=500)
    conversation_id: str | None = Field(None, max_length=64)
    num_results: int = Field(8, ge=1, le=10)
    filters: dict[str, Any] = Field(default_factory=dict)


DOMAIN_MODES: dict[str, dict[str, Any]] = {
    "research": {
        "label": "Research",
        "tools": ["google_search", "google_news", "google_scholar", "google_patents", "google_forums"],
        "filters": ["date", "domain", "source_type", "academic_only", "country", "language"],
    },
    "shopping": {
        "label": "Shopping",
        "tools": ["google_shopping", "google_search", "google_images", "google_forums"],
        "filters": ["budget", "brand", "category", "min_rating", "availability"],
    },
    "jobs": {
        "label": "Jobs",
        "tools": ["google_jobs", "google_search", "google_news"],
        "filters": ["role", "location", "remote", "min_salary", "experience", "date_posted"],
    },
    "learning": {
        "label": "Learning",
        "tools": ["google_scholar", "youtube", "google_search", "google_forums"],
        "filters": ["level", "format", "free_only"],
        "stages": ["Goal", "Prerequisites", "Fundamentals", "Resources", "Projects", "Papers", "Advanced"],
    },
    "travel": {
        "label": "Travel",
        "tools": ["google_flights", "google_hotels", "google_maps", "google_events", "google_search"],
        "filters": ["origin", "destination", "dates", "budget", "rating"],
    },
}


def _toolset_for_mode(mode: str, analysis: QueryAnalysis, **kw: Any):  # type: ignore[no-untyped-def]
    if mode == "research":
        return research_toolset(**kw)
    if mode == "shopping":
        return shopping_toolset(**kw)
    if mode == "jobs":
        return careers_toolset(**kw)
    if mode == "learning":
        return academic_toolset(**kw)
    if mode == "travel":
        return travel_toolset(**kw)
    return toolset_for_analysis(analysis, **kw)


def _confidence(result_count: int, errors: int) -> str:
    if result_count >= 8 and errors == 0:
        return "high"
    if result_count >= 3:
        return "medium"
    return "low"


def execute_tools(toolset: Any, query: str, num_results: int, budget: BudgetLimits) -> tuple[list[dict], RunTrace]:
    trace = RunTrace()
    tracker = BudgetTracker(budget)
    tasks: dict[str, Any] = {}
    for tool in toolset.tools:
        try:
            tracker.consume(1)
        except Exception:
            break

        def _make(t: Any = tool) -> Any:
            def _run() -> dict:
                started = time.monotonic()
                try:
                    # Public Haystack API: Tool.invoke() runs the wrapped
                    # component (ComponentTool exposes it as _component only).
                    out = t.invoke(query=query, num_results=num_results)
                    if not isinstance(out, dict):
                        raise TypeError(f"Unexpected tool result type: {type(out).__name__}")
                    trace.add(
                        ToolCallRecord(
                            tool=t.name,
                            query=query[:120],
                            latency_ms=(time.monotonic() - started) * 1000.0,
                            result_count=len(out.get("results", []) or []),
                        )
                    )
                    return out
                except Exception as exc:  # PRD Sec 80: continue, report failure
                    trace.add(
                        ToolCallRecord(
                            tool=t.name,
                            query=query[:120],
                            latency_ms=(time.monotonic() - started) * 1000.0,
                            error=str(exc)[:200],
                        )
                    )
                    return {"results": [], "evidence": [], "error": str(exc)[:200]}

            return _run

        tasks[tool.name] = _make()
    raw = run_parallel(tasks, max_workers=4)
    ordered = [raw[name] for name in [t.name for t in toolset.tools] if name in raw and not isinstance(raw[name], Exception)]
    return ordered, trace


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "version": "0.2.0", "service": "serpapi-haystack-universal-agent"}


@app.get("/api/tools")
def list_tools() -> list[dict[str, str]]:
    tools = universal_toolset().tools
    return [{"name": tool.name, "description": tool.description} for tool in tools]


@app.get("/api/modes")
def list_modes() -> dict[str, Any]:
    return {"modes": DOMAIN_MODES, "default": "auto"}


@app.post("/api/intents")
def analyze_intent(req: IntentRequest, request: Request) -> dict[str, Any]:
    _check_rate(request)
    q = sanitize_query(req.query)
    analysis = classify_query(q)
    plan = [{"id": s.id, "action": s.action, "tool": s.tool, "query": s.query} for s in build_plan(analysis, q)]
    estimated_calls = max(1, len(analysis.tools))
    return {
        "analysis": analysis.to_dict(),
        "plan": plan,
        "estimated_calls": estimated_calls,
        "estimated_seconds": estimated_calls * 4,
        "requires_confirmation": estimated_calls >= 5,
    }


@app.post("/api/search")
def execute_search(req: SearchRequest, request: Request) -> dict[str, Any]:
    _check_rate(request)
    if req.engine not in TOOL_FACTORIES:
        raise HTTPException(status_code=400, detail=f"Engine '{req.engine}' not supported.")
    q = sanitize_query(req.query)
    loc = (req.location or "").strip()[:120] or None
    tool = TOOL_FACTORIES[req.engine]()
    try:
        kwargs: dict[str, Any] = {"query": q, "num_results": req.num_results}
        if loc:
            kwargs["location"] = loc
        out = tool.invoke(**kwargs)
        if not isinstance(out, dict):
            raise TypeError(f"Unexpected tool result type: {type(out).__name__}")
        return out
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Search failed: {str(exc)[:200]}")


def _enrich_outputs(
    tool_outputs: list[dict[str, Any]],
    tool_names: list[str],
    trace: RunTrace,
    constraints: dict[str, Any],
    budget: BudgetLimits,
    started: float,
    use_case: str = "",
) -> dict[str, Any]:
    """Shared enrichment: funnel, why, route, confidence, completeness, links, actions."""
    import time as _time

    flat = []
    for out in tool_outputs:
        for r in (out.get("results", []) or []):
            r["_engine"] = out.get("engine", "")
            flat.append(r)
    funnel = apply_funnel(flat, constraints or {})
    matched = funnel["matched_results"]
    for i, r in enumerate(matched):
        r["why"] = why_for(r, constraints or {}, i, len(matched))
    evidence = [e for out in tool_outputs for e in (out.get("evidence", []) or [])]
    linked_results, linked_evidence = attach_evidence(matched[:30], evidence[:30])
    # Agentic handoff: one outbound action per result (read-only, opens provider site).
    top_actions: list[dict[str, Any]] = []
    for i, r in enumerate(linked_results):
        action = action_for_result(r, use_case, i, constraints or {})
        r["action"] = action.to_dict()
        top_actions.append(action.to_dict())
    sources = [
        {
            "id": e.get("id", ""),
            "title": (e.get("source_title") or "")[:200],
            "url": e.get("source_url") or "",
            "domain": e.get("domain", ""),
            "type": e.get("source_type") or "",
            "claim": (e.get("extracted_claim") or "")[:300],
            "claim_type": str(e.get("kind", "FACT")).lower(),
            "tool": e.get("tool_used") or "",
            "date": e.get("timestamp"),
        }
        for e in linked_evidence
    ]
    summary = trace.summary()
    errors = len(summary["errors"])
    route = build_route(tool_names, trace.calls)
    ok_lines = [line for line in route if line["status"] == "ok"]
    failed = sum(1 for line in route if line["status"] == "failed")
    succeeded = sum(1 for line in route if line["status"] in ("ok", "empty"))
    elapsed = _time.monotonic() - started
    return {
        "results": linked_results,
        "results_count": len(matched),
        "actions": top_actions,
        "evidence": linked_evidence,
        "evidence_count": len(linked_evidence),
        "sources": sources,
        "route": route,
        "funnel": {
            "discovered": funnel["discovered"],
            "matched": funnel["matched"],
            "set_aside": funnel["set_aside"],
            "reasons": funnel["reasons"],
            "set_aside_results": funnel["set_aside_results"],
        },
        "confidence": confidence_with_reasons(len(matched), errors, len(ok_lines), constraints or {}),
        "completeness": completeness(len(route), succeeded, failed),
        "budget": {
            "calls_used": summary["serpapi_calls"],
            "calls_limit": budget.max_serpapi_calls,
            "seconds_used": round(elapsed, 1),
            "seconds_limit": budget.max_execution_time_seconds,
        },
        "errors": errors,
    }


def _run_chat(
    query: str,
    mode: str,
    deep: bool,
    num_results: int,
    filters: dict[str, Any] | None = None,
    context: list[str] | None = None,
) -> dict[str, Any]:
    import time as _time

    started = _time.monotonic()
    analysis = classify_query(query)
    constraints = {**(analysis.constraints or {}), **(filters or {})}
    analysis.constraints = constraints
    if mode != "auto":
        # Constrain tools to the explicit domain mode (power-user override).
        wanted = DOMAIN_MODES[mode]["tools"]
        analysis.tools = [t for t in wanted if t] or analysis.tools
    plan = build_plan(analysis, query, max_steps=12 if deep else 8)
    budget = BudgetLimits(
        max_planning_steps=12 if deep else 8,
        max_serpapi_calls=12 if deep else 5,
        max_results_per_call=10,
    )
    toolset = _toolset_for_mode(mode, analysis)
    if not deep:
        # Normal mode: 3-5 tool calls. Deep: up to budget.
        toolset.tools = toolset.tools[:5]  # type: ignore[attr-defined]
    tool_names = [t.name for t in toolset.tools]
    tool_outputs, trace = execute_tools(toolset, query, num_results, budget)
    trace.intent = analysis.intent
    trace.tools_selected = tool_names
    enriched = _enrich_outputs(
        tool_outputs, tool_names, trace, constraints, budget, started,
        (analysis.intent or ["GENERAL_RESEARCH"])[0].lower(),
    )
    use_case = (analysis.intent or ["GENERAL_RESEARCH"])[0].lower()
    record_usage(
        queries=1,
        calls=enriched["budget"]["calls_used"],
        failed=enriched["errors"],
        tools=tool_names,
    )
    return {
        "query": query,
        "mode": mode,
        "deep_research": deep,
        "analysis": analysis.to_dict(),
        "plan": [{"id": s.id, "action": s.action, "tool": s.tool, "query": s.query} for s in plan],
        "tools_executed": tool_names,
        "constraints": constraints,
        "context": context or [],
        **enriched,
        "refinements": refinements_for(use_case),
        "research_trace": trace.summary(),
        "answer": "",
        "summary": f"Found {enriched['results_count']} results across {len(tool_names)} sources.",
    }


@app.post("/api/chat")
def chat_agent(req: ChatRequest, request: Request) -> dict[str, Any]:
    _check_rate(request, "chat")
    q = sanitize_query(req.query)
    filters = {k: v for k, v in (req.filters or {}).items() if str(v).strip() != ""}
    return _run_chat(q, req.mode, req.deep_research, req.num_results, filters, req.context)


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    limits = BudgetLimits()
    return {
        "limits": {
            "max_planning_steps": limits.max_planning_steps,
            "max_serpapi_calls": limits.max_serpapi_calls,
            "max_results_per_call": limits.max_results_per_call,
            "max_execution_time_seconds": limits.max_execution_time_seconds,
        },
        "modes": list(DOMAIN_MODES.keys()),
        "features": {"agent": True, "streaming": True, "compare": True, "saved_local": True},
    }


@app.get("/api/usage")
def get_usage() -> dict[str, Any]:
    return usage_snapshot()


@app.post("/api/agent")
def agent_run(req: AgentRequest, request: Request) -> dict[str, Any]:
    """Autonomous LLM agent: classify -> exact SerpApi endpoints -> best picks.

    Read-only. Returns choices (products, videos, flights/hotels) ready to
    open — never performs bookings, applications, or purchases.
    """
    _check_rate(request, "chat")
    q = sanitize_query(req.query)
    try:
        out = run_llm_agent(q, num_results=req.num_results, constraints=req.filters or {})
        record_usage(queries=1)
        return out
    except LLMKeyMissing as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/api/chat/stream")
def chat_stream(req: ChatRequest, request: Request) -> StreamingResponse:
    _check_rate(request, "chat")
    q = sanitize_query(req.query)

    def gen():  # type: ignore[no-untyped-def]
        yield f"event: query_received\ndata: {json.dumps({'query': q})}\n\n"
        analysis = classify_query(q)
        if req.mode != "auto":
            analysis.tools = DOMAIN_MODES[req.mode]["tools"]
        yield f"event: intent_detected\ndata: {json.dumps(analysis.to_dict())}\n\n"
        plan = build_plan(analysis, q, max_steps=12 if req.deep_research else 8)
        yield f"event: plan_created\ndata: {json.dumps([s.__dict__ for s in plan])}\n\n"
        toolset = _toolset_for_mode(req.mode, analysis)
        if not req.deep_research:
            toolset.tools = toolset.tools[:5]  # type: ignore[attr-defined]
        budget = BudgetLimits(max_serpapi_calls=12 if req.deep_research else 5)
        tool_outputs, trace = execute_tools(toolset, q, req.num_results, budget)
        for t in toolset.tools:
            yield f"event: tool_started\ndata: {json.dumps({'tool': t.name, 'query': q[:120]})}\n\n"
        yield f"event: tool_completed\ndata: {json.dumps({'tools': [t.name for t in toolset.tools]})}\n\n"
        synth = synthesis_input(q, analysis, tool_outputs)
        yield f"event: result_found\ndata: {json.dumps({'results': len(synth['results']), 'evidence': len(synth['evidence'])})}\n\n"
        yield "event: synthesis_started\ndata: {}\n\n"
        # Answer chunk: summary only. LLM synthesis happens client-side display;
        # factual claims stay tied to sources list below.
        summary = f"Found {len(synth['results'])} results across {len(toolset.tools)} sources."
        yield f"event: answer_chunk\ndata: {json.dumps({'text': summary})}\n\n"
        final = {
            "results": synth["results"][:30],
            "evidence": synth["evidence"][:30],
            "confidence": confidence_with_reasons(len(synth["results"]), 0, len(toolset.tools), {}),
            "trace": trace.summary(),
        }
        yield f"event: answer_complete\ndata: {json.dumps(final)[:8000]}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# Serve Phase 7-8 static frontend when built (frontend/ at repo root or package dir).
def _frontend_dir() -> Path | None:
    here = Path(__file__).resolve()
    for cand in [
        Path.cwd() / "frontend",
        here.parents[3] / "frontend",
        here.parents[2] / "frontend",
    ]:
        if (cand / "index.html").exists():
            return cand
    return None


_front = _frontend_dir()
if _front is not None:
    app.mount("/", StaticFiles(directory=str(_front), html=True), name="frontend")
