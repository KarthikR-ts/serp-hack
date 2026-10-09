"""LLM-driven autonomous router (OpenRouter via OpenAI-compatible SDK).

Three passes per user prompt::

    PASS 1 (LLM): classify -> {use_case, engine steps, presentation, slots}
    PASS 2 (code): call the exact SerpApi endpoints via Haystack tools
    PASS 3 (LLM): rank/select the best set -> presenter shapes UI payload

Stops before any real-world action (no booking/applying/purchasing):
travel and similar flows return *choices ready to book* with links.

The LLM is constrained to ENGINE_REGISTRY (grounded in SerpApi docs at
serpapi.com/search-api), so it cannot invent engines or parameters.
``complete`` is injectable for tests.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Literal

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from .intents import QueryAnalysis, _BUDGET_RE, _LEARN_RE, _SHOP_RE, classify_query
from ..toolsets import TOOL_FACTORIES
from ..utils.limits import BudgetLimits, BudgetTracker
from ..utils.observability import RunTrace, ToolCallRecord

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o-mini"

# Engine registry grounded in SerpApi docs. `query_param` is the exact
# required query field per vertical (YouTube uses `search_query`, not `q`).
ENGINE_REGISTRY: dict[str, dict[str, Any]] = {
    "google_search": {"use_when": "general research, facts, docs, comparisons", "query_param": "q", "cost": 1},
    "google_news": {"use_when": "breaking news, announcements, recent events", "query_param": "q", "cost": 1},
    "google_shopping": {"use_when": "buy/compare products, prices, reviews", "query_param": "q", "cost": 1},
    "google_jobs": {"use_when": "jobs, internships, hiring, salaries", "query_param": "q", "cost": 1},
    "google_scholar": {"use_when": "papers, citations, academic literature", "query_param": "q", "cost": 1},
    "google_patents": {"use_when": "patents, prior art, IP filings", "query_param": "q", "cost": 1},
    "google_forums": {"use_when": "community opinions, real-world experience, troubleshooting", "query_param": "q", "cost": 1},
    "google_images": {"use_when": "visual references, diagrams, product photos", "query_param": "q", "cost": 1},
    "google_maps": {"use_when": "places, restaurants, services, addresses near a location", "query_param": "q", "cost": 1},
    "google_flights": {"use_when": "flight options, prices, routes, dates", "query_param": "q", "cost": 1},
    "google_hotels": {"use_when": "hotels, nightly rates, availability", "query_param": "q", "cost": 1},
    "google_finance": {"use_when": "stocks, tickers, market data, company financials", "query_param": "q", "cost": 1},
    "google_trends": {"use_when": "interest over time, rising topics, popularity compare", "query_param": "q", "cost": 1},
    "google_events": {"use_when": "concerts, conferences, meetups, festivals, tickets", "query_param": "q", "cost": 1},
    "youtube": {"use_when": "video learning, tutorials, explainers, talks, visual reviews", "query_param": "search_query", "cost": 1},
}

PRESENTATIONS = [
    "shopping_top2",
    "youtube_path",
    "finance_snapshot",
    "deep_dive",
    "research_brief",
    "jobs_table",
    "travel_choices",
    "local_list",
    "generic",
]

USE_CASE_HINTS = {
    "shopping": ("google_shopping", "shopping_top2"),
    "youtube_learning": ("youtube", "youtube_path"),
    "deep_dive": ("google_search+scholar+news", "deep_dive"),
    "finance": ("google_finance", "finance_snapshot"),
    "jobs": ("google_jobs", "jobs_table"),
    "travel": ("google_flights+hotels", "travel_choices"),
    "research": ("google_search", "research_brief"),
}


class LLMKeyMissing(RuntimeError):
    """OPENROUTER_API_KEY is not configured."""


def resolve_llm_key(explicit: str | None = None) -> str:
    key = (explicit or os.getenv("OPENROUTER_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    if not key:
        raise LLMKeyMissing("LLM key not configured. Set OPENROUTER_API_KEY in .env.")
    return key


def resolve_model() -> str:
    return (os.getenv("LLM_MODEL") or DEFAULT_MODEL).strip()


CompleteFn = Callable[[str, str], dict[str, Any]]
"""complete(system_prompt, user_prompt) -> parsed JSON dict."""


def openrouter_complete(system: str, user: str, max_tokens: int = 800, temperature: float = 0.0) -> dict[str, Any]:
    """Default completion fn: OpenRouter chat completions with JSON mode."""
    from openai import OpenAI  # lazy: only needed for live LLM calls

    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=resolve_llm_key())
    resp = client.chat.completions.create(
        model=resolve_model(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        max_tokens=max_tokens,
        temperature=temperature,
    )
    text = (resp.choices[0].message.content or "").strip()
    return _parse_json(text)


def _parse_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


@dataclass
class RouterStep:
    engine: str
    query: str
    num_results: int = 8
    location: str | None = None


@dataclass
class RouterPlan:
    use_case: str = "research"
    presentation: str = "research_brief"
    steps: list[RouterStep] = field(default_factory=list)
    needs_clarification: bool = False
    clarifying_question: str = ""
    confidence: Literal["high", "medium", "low"] = "medium"
    reasoning: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_CLASSIFY_SYSTEM = """You are the classifier for a universal web-intelligence agent.
Given a user request, decide EXACTLY which search engines to call.

Allowed engines and when to use them:
{registry}

HARD RULES (follow in order):
1. BUY INTENT always means shopping. If the query contains a buy verb
   (buy, find, get, best, top, cheapest, affordable, order) AND a product noun
   (keyboard, laptop, phone, monitor, headphones, camera, shoes, etc.),
   OR any price/budget/currency signal ($, Rs, USD, under, below, budget),
   then use_case MUST be "shopping", the FIRST step MUST use engine
   "google_shopping", and presentation MUST be "shopping_top2".
   Never label buy-intent queries as "research".
2. VIDEO LEARNING means youtube. "learn X", "tutorial", "course videos",
   "explain X on video" -> FIRST step engine "youtube", presentation "youtube_path".
3. Prefer the specialized engine over google_search whenever one fits
   (jobs->google_jobs, stocks->google_finance, flights/hotels->travel engines,
   papers->google_scholar, places->google_maps). google_search alone is only
   for generic factual lookup with no specialized fit.
4. Deep/complex research ("deep dive", "thorough", "comprehensive", multi-part
   questions): steps google_search + google_scholar + google_news, presentation deep_dive.

FEW-SHOT EXAMPLES:
- "best wireless keyboard under $100" ->
  {{"use_case": "shopping", "steps": [{{"engine": "google_shopping", "query": "wireless keyboard under $100", "num_results": 8}}], "presentation": "shopping_top2"}}
- "teach me diffusion models with videos" ->
  {{"use_case": "youtube_learning", "steps": [{{"engine": "youtube", "query": "diffusion models tutorial beginners", "num_results": 8}}], "presentation": "youtube_path"}}
- "plan a trip" (no origin/destination) ->
  {{"use_case": "travel", "steps": [], "presentation": "travel_choices", "needs_clarification": true, "clarifying_question": "Where are you flying from, and where to?"}}
- "NVDA stock price today" ->
  {{"use_case": "finance", "steps": [{{"engine": "google_finance", "query": "NVDA", "num_results": 5}}, {{"engine": "google_news", "query": "Nvidia stock news", "num_results": 5}}], "presentation": "finance_snapshot"}}

OUTPUT CONTRACT:
- Reply with JSON only, matching this schema:
  {{"use_case": "<short label like shopping|youtube_learning|deep_dive|finance|jobs|travel|research|news|local|events|trends|patents|academic>",
   "steps": [{{"engine": "<one of allowed>", "query": "<rewritten search query>", "num_results": <1-10>, "location": "<city/country or null>"}}],
   "presentation": "<one of: {presentations}>",
   "needs_clarification": <true|false>,
   "clarifying_question": "<one specific question or empty>",
   "confidence": "<high|medium|low>",
   "reasoning": "<one sentence>"}}
- Use at most 3 steps. First step is the primary engine.
- Rewrite queries for search (keywords, not full sentences). YouTube queries should target tutorials/explainers.
- Set needs_clarification=true ONLY when a required choice is missing: travel without origin/destination, jobs without any role, or a query under 3 meaningful words. Otherwise false.
- Never invent engines or parameters. Location only when the user implies a place.
"""


_VIDEO_LEARN_RE = re.compile(r"\b(video|videos|tutorial|tutorials|talk|course videos|youtube)\b", re.I)


def _enforce_hard_rules(query: str, plan: RouterPlan) -> RouterPlan:
    """Deterministic safety net over the LLM plan.

    Small models ignore prompt rules; these Buy/video-learning overrides use
    the same keyword signals as the legacy classifier and only fire when the
    LLM missed the obvious engine. Never duplicates an engine already planned.
    """
    if plan.needs_clarification:
        return plan
    q = query or ""
    engines = [s.engine for s in plan.steps]
    buy_signal = bool(_SHOP_RE.search(q) or _BUDGET_RE.search(q) or "$" in q or "₹" in q)
    if buy_signal and "google_shopping" not in engines:
        plan.steps.insert(0, RouterStep(engine="google_shopping", query=q.strip()[:300] or q))
        if plan.use_case == "research":
            plan.use_case = "shopping"
        plan.presentation = "shopping_top2"
        plan.reasoning = (plan.reasoning + " [rule: buy-intent -> shopping]").strip()
    video_signal = bool(_LEARN_RE.search(q) and _VIDEO_LEARN_RE.search(q))
    if video_signal and "youtube" not in engines:
        plan.steps.insert(0, RouterStep(engine="youtube", query=q.strip()[:300] or q))
        if plan.use_case == "research":
            plan.use_case = "youtube_learning"
        plan.presentation = "youtube_path"
        plan.reasoning = (plan.reasoning + " [rule: video-learning -> youtube]").strip()
    return plan


def classify_with_llm(query: str, complete: CompleteFn | None = None) -> RouterPlan:
    """PASS 1: LLM classifies the request into exact endpoint steps."""
    complete = complete or openrouter_complete
    registry = "\n".join(f"- {eng}: {info['use_when']}" for eng, info in ENGINE_REGISTRY.items())
    system = _CLASSIFY_SYSTEM.format(registry=registry, presentations="|".join(PRESENTATIONS))
    try:
        parsed = complete(system, f"User request: {query}")
    except Exception:
        parsed = {}
    plan = RouterPlan()
    if not parsed:
        plan.steps = [RouterStep(engine="google_search", query=query)]
        plan.reasoning = "Classifier fallback: broad web search."
        return _enforce_hard_rules(query, plan)
    plan.use_case = str(parsed.get("use_case", "research"))[:60] or "research"
    if parsed.get("presentation") in PRESENTATIONS:
        plan.presentation = parsed["presentation"]
    for raw in (parsed.get("steps") or [])[:3]:
        if not isinstance(raw, dict):
            continue
        engine = str(raw.get("engine", ""))
        if engine not in ENGINE_REGISTRY or engine not in TOOL_FACTORIES:
            continue
        q = str(raw.get("query", "") or query).strip()[:300] or query
        try:
            n = max(1, min(int(raw.get("num_results", 8)), 10))
        except (TypeError, ValueError):
            n = 8
        loc = raw.get("location")
        plan.steps.append(
            RouterStep(engine=engine, query=q, num_results=n, location=str(loc)[:120] if loc else None)
        )
    if not plan.steps:
        plan.steps = [RouterStep(engine="google_search", query=query)]
    plan.needs_clarification = bool(parsed.get("needs_clarification", False))
    plan.clarifying_question = str(parsed.get("clarifying_question", ""))[:300]
    if parsed.get("confidence") in ("high", "medium", "low"):
        plan.confidence = parsed["confidence"]
    plan.reasoning = str(parsed.get("reasoning", ""))[:300]
    return _enforce_hard_rules(query, plan)


def execute_plan(plan: RouterPlan, budget: BudgetLimits | None = None) -> tuple[list[dict[str, Any]], RunTrace]:
    """PASS 2: call the exact endpoints via Haystack tools (read-only)."""
    budget = budget or BudgetLimits(max_serpapi_calls=5)
    trace = RunTrace()
    tracker = BudgetTracker(budget)
    outputs: list[dict[str, Any]] = []
    for step in plan.steps[:3]:
        try:
            tracker.consume(1)
        except Exception:
            break
        started = time.monotonic()
        try:
            tool = TOOL_FACTORIES[step.engine]()
            kwargs: dict[str, Any] = {"query": step.query, "num_results": step.num_results}
            if step.location:
                kwargs["location"] = step.location
            out = tool.invoke(**kwargs)
            if not isinstance(out, dict):
                raise TypeError(f"Unexpected tool result: {type(out).__name__}")
            outputs.append({"engine": step.engine, **out})
            trace.add(
                ToolCallRecord(
                    tool=step.engine,
                    query=step.query[:120],
                    latency_ms=(time.monotonic() - started) * 1000.0,
                    result_count=len(out.get("results", []) or []),
                )
            )
        except Exception as exc:  # continue on partial failure, report it
            trace.add(
                ToolCallRecord(
                    tool=step.engine,
                    query=step.query[:120],
                    latency_ms=(time.monotonic() - started) * 1000.0,
                    error=str(exc)[:200],
                )
            )
            outputs.append({"engine": step.engine, "results": [], "evidence": [], "error": str(exc)[:200]})
    return outputs, trace


_RANK_SYSTEM = """You rank web search results for a user request.
Reply with JSON only: {{"order": [<indices into RESULTS, best first>], "reasons": {{"<index>": "<one short reason>"}}, "summary": "<2 sentences max>"}}
Rules: rank by fit to the request (price/budget match, recency, authority, relevance). Order every index given. Reasons must cite concrete attributes (price, rating, date, source)."""


def rank_with_llm(
    query: str, results: list[dict[str, Any]], complete: CompleteFn | None = None
) -> dict[str, Any]:
    """PASS 3: LLM selects/orders the best set. Falls back to score order."""
    fallback = {
        "order": list(range(len(results))),
        "reasons": {},
        "summary": f"Found {len(results)} results.",
    }
    if not results:
        return fallback
    complete = complete or openrouter_complete
    compact = []
    for i, r in enumerate(results[:15]):
        compact.append(
            {
                "i": i,
                "title": str(r.get("title", "") or r.get("name", ""))[:120],
                "url": r.get("url", "") or r.get("application_url", ""),
                "snippet": str(r.get("snippet", "") or r.get("description", "") or "")[:200],
                "price": r.get("price"),
                "rating": r.get("rating"),
                "company": r.get("company"),
                "date": r.get("date") or r.get("published_date"),
                "score": r.get("score"),
            }
        )
    try:
        parsed = complete(_RANK_SYSTEM, f"Request: {query}\nRESULTS: {json.dumps(compact)[:6000]}")
    except Exception:
        return fallback
    order = [i for i in (parsed.get("order") or []) if isinstance(i, int) and 0 <= i < len(results)]
    order += [i for i in range(len(results)) if i not in order]
    reasons = parsed.get("reasons") or {}
    return {
        "order": order or list(range(len(results))),
        "reasons": {str(k): str(v)[:200] for k, v in reasons.items() if isinstance(v, str)},
        "summary": str(parsed.get("summary", fallback["summary"]))[:500],
    }


def _reorder(results: list[dict], order: list[int]) -> list[dict]:
    return [results[i] for i in order if 0 <= i < len(results)]


def build_presentation(
    plan: RouterPlan, tool_outputs: list[dict[str, Any]], ranking: dict[str, Any]
) -> dict[str, Any]:
    """Shape ranked results into the per-use-case UI payload (no actions)."""
    flat: list[dict[str, Any]] = []
    for out in tool_outputs:
        for r in out.get("results", []) or []:
            flat.append({**r, "_engine": out.get("engine", "")})
    ranked = _reorder(flat, ranking.get("order", []))
    reasons = ranking.get("reasons", {})

    def reason_for(result: dict) -> str:
        try:
            orig = flat.index(result)
        except ValueError:
            return ""
        return reasons.get(str(orig), reasons.get(orig, ""))

    presentation = plan.presentation
    if presentation == "shopping_top2":
        picks = []
        for r in ranked[:2]:
            picks.append(
                {
                    "title": r.get("title", ""),
                    "image": r.get("image"),
                    "price": r.get("price"),
                    "seller": r.get("seller", ""),
                    "rating": r.get("rating"),
                    "reviews": r.get("reviews"),
                    "url": r.get("url", ""),
                    "why": reason_for(r),
                }
            )
        return {"type": "shopping_top2", "picks": picks, "summary": ranking.get("summary", "")}
    if presentation == "youtube_path":
        levels: dict[str, list] = {"beginner": [], "intermediate": [], "advanced": []}
        for r in ranked[:9]:
            title = f"{r.get('title', '')} {r.get('description', '')}".lower()
            if any(k in title for k in ("beginner", "intro", "basics", "explained simply", "for dummies", "101")):
                lvl = "beginner"
            elif any(k in title for k in ("advanced", "deep dive", "paper", "phd", "masterclass")):
                lvl = "advanced"
            else:
                lvl = "intermediate"
            levels[lvl].append(
                {
                    "title": r.get("title", ""),
                    "thumbnail": r.get("thumbnail"),
                    "channel": r.get("channel", ""),
                    "length": r.get("length", ""),
                    "views": r.get("views"),
                    "url": r.get("url", ""),
                    "why": reason_for(r),
                }
            )
        return {"type": "youtube_path", "levels": levels, "summary": ranking.get("summary", "")}
    if presentation == "finance_snapshot":
        quote = next((r for r in ranked if r.get("_engine") == "google_finance"), None) or (ranked[0] if ranked else {})
        headlines = [r for r in ranked if r.get("_engine") == "google_news"][:5]
        return {
            "type": "finance_snapshot",
            "quote": quote,
            "headlines": [{"title": h.get("title", ""), "url": h.get("url", ""), "date": h.get("date")} for h in headlines],
            "summary": ranking.get("summary", ""),
            "disclaimer": "Informational only — not financial advice.",
        }
    if presentation == "deep_dive":
        papers = [r for r in ranked if r.get("_engine") == "google_scholar"][:5]
        findings = [
            {"claim": (r.get("snippet", "") or r.get("description", "") or r.get("title", ""))[:280],
             "url": r.get("url", ""), "title": r.get("title", ""), "why": reason_for(r)}
            for r in ranked[:6]
        ]
        return {"type": "deep_dive", "summary": ranking.get("summary", ""), "findings": findings, "papers": papers}
    if presentation == "jobs_table":
        return {"type": "jobs_table", "jobs": ranked[:8], "summary": ranking.get("summary", "")}
    if presentation == "travel_choices":
        flights = [r for r in ranked if r.get("_engine") == "google_flights"][:4]
        hotels = [r for r in ranked if r.get("_engine") == "google_hotels"][:4]
        places = [r for r in ranked if r.get("_engine") == "google_maps"][:4]
        return {
            "type": "travel_choices",
            "flights": flights,
            "hotels": hotels,
            "places": places,
            "summary": ranking.get("summary", ""),
            "note": "Choices are planned and ready — no booking performed. Booking is a later decision.",
        }
    if presentation == "local_list":
        return {"type": "local_list", "places": ranked[:8], "summary": ranking.get("summary", "")}
    return {"type": "generic", "results": ranked[:10], "summary": ranking.get("summary", "")}


def _confidence(total: int, errors: int) -> str:
    if total >= 8 and errors == 0:
        return "high"
    if total >= 3:
        return "medium"
    return "low"


def run_agent(query: str, complete: CompleteFn | None = None, num_results: int = 8) -> dict[str, Any]:
    """Run the autonomous 3-pass flow. Read-only; stops before any action."""
    resolve_llm_key()  # fail fast with a clear error when unconfigured
    plan = classify_with_llm(query, complete=complete)
    if plan.needs_clarification and plan.clarifying_question:
        return {
            "status": "clarify",
            "query": query,
            "classification": plan.to_dict(),
            "clarifying_question": plan.clarifying_question,
        }
    for step in plan.steps:
        step.num_results = max(1, min(step.num_results, num_results, 10))
    tool_outputs, trace = execute_plan(plan)
    trace.intent = [plan.use_case]
    trace.tools_selected = [s.engine for s in plan.steps]
    flat = [r for out in tool_outputs for r in (out.get("results", []) or [])]
    ranking = rank_with_llm(query, flat, complete=complete)
    presentation = build_presentation(plan, tool_outputs, ranking)
    evidence = [e for out in tool_outputs for e in (out.get("evidence", []) or [])]
    errors = len(trace.summary()["errors"])
    sources = [
        {
            "title": (e.get("source_title") or "")[:200],
            "url": e.get("source_url") or "",
            "type": e.get("source_type") or "",
            "claim": (e.get("extracted_claim") or "")[:300],
            "tool": e.get("tool_used") or "",
        }
        for e in evidence[:30]
    ]
    # Deterministic regex analysis alongside, for trace continuity.
    legacy = classify_query(query)
    return {
        "status": "ok",
        "query": query,
        "model": resolve_model(),
        "classification": plan.to_dict(),
        "legacy_intents": legacy.intent,
        "presentation": presentation,
        "sources": sources,
        "results_count": len(flat),
        "evidence_count": len(evidence),
        "confidence": plan.confidence if flat else "low",
        "research_trace": trace.summary(),
        "summary": ranking.get("summary", ""),
    }


__all__ = [
    "ENGINE_REGISTRY",
    "PRESENTATIONS",
    "RouterPlan",
    "RouterStep",
    "LLMKeyMissing",
    "resolve_llm_key",
    "resolve_model",
    "classify_with_llm",
    "execute_plan",
    "rank_with_llm",
    "build_presentation",
    "run_agent",
    "openrouter_complete",
]
