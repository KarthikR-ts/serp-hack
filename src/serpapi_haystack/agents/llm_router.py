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

from .intents import (
    INTENT_TOOLS,
    _BUDGET_RE,
    _FINANCE_RE,
    _FLIGHT_RE,
    _HOTEL_RE,
    _LEARN_RE,
    _SHOP_RE,
    QueryAnalysis,
    classify_query,
    split_tasks_regex,
)
from ..models.actions import attach_actions
from ..toolsets import TOOL_FACTORIES
from ..utils.travel import flight_dates, parse_trip_dates, resolve_airport
from ..utils.limits import BudgetLimits, BudgetTracker
from ..utils.observability import RunTrace, ToolCallRecord
from ..utils.presentation import (
    apply_funnel,
    attach_evidence,
    build_route,
    confidence_with_reasons,
    refinements_for,
    why_for,
)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o-mini"

# Separate small model for one-line reasoning traces (never blocks the run).
REASONING_DEFAULT_MODEL = "openai/gpt-4o-mini"
REASONING_DEFAULT_BASE_URL = OPENROUTER_BASE_URL
MAX_REASONING_CALLS = 3

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
    "learning_plan",
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


def resolve_reasoning_model() -> str:
    return (os.getenv("REASONING_MODEL") or REASONING_DEFAULT_MODEL).strip()


def resolve_reasoning_base_url() -> str:
    return (os.getenv("REASONING_BASE_URL") or REASONING_DEFAULT_BASE_URL).strip()


def resolve_reasoning_key() -> str:
    return (
        os.getenv("REASONING_API_KEY")
        or os.getenv("OPENROUTER_API_KEY")
        or os.getenv("LLM_API_KEY")
        or ""
    ).strip()


def reasoning_line(prompt: str, fallback: str, max_tokens: int = 40) -> str:
    """One reasoning trace line via the separate reasoning model.

    Any failure (no key, network error, timeout, empty reply) returns the
    deterministic ``fallback`` template — never raises, never blocks.
    """
    try:
        key = resolve_reasoning_key()
        if not key:
            return fallback
        from openai import OpenAI  # lazy: only needed for live reasoning calls

        client = OpenAI(base_url=resolve_reasoning_base_url(), api_key=key, timeout=30.0)
        resp = client.chat.completions.create(
            model=resolve_reasoning_model(),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max(40, min(max_tokens, 1200)),
            temperature=0.0,
        )
        text = (resp.choices[0].message.content or "").strip()
        return text[:4000] if text else fallback
    except Exception:
        return fallback


CompleteFn = Callable[[str, str], dict[str, Any]]
"""complete(system_prompt, user_prompt) -> parsed JSON dict."""


def openrouter_complete(system: str, user: str, max_tokens: int = 1500, temperature: float = 0.0) -> dict[str, Any]:
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
        parsed = None
    if isinstance(parsed, dict):
        return parsed
    # Reasoning-style models think out loud then emit JSON: scan for the
    # last balanced {...} block and parse that.
    best: dict[str, Any] = {}
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(cleaned):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    cand = json.loads(cleaned[start : i + 1])
                except (json.JSONDecodeError, ValueError):
                    pass
                else:
                    if isinstance(cand, dict):
                        best = cand
                start = -1
    return best


@dataclass
class RouterStep:
    engine: str
    query: str
    num_results: int = 8
    location: str | None = None


@dataclass
class SubTask:
    id: str = "task-1"
    label: str = ""
    query: str = ""
    use_case: str = "research"
    presentation: str = "research_brief"
    steps: list[RouterStep] = field(default_factory=list)


@dataclass
class RouterPlan:
    use_case: str = "research"
    presentation: str = "research_brief"
    steps: list[RouterStep] = field(default_factory=list)
    needs_clarification: bool = False
    clarifying_question: str = ""
    confidence: Literal["high", "medium", "low"] = "medium"
    reasoning: str = ""
    # Agentic slots: structured choices the run needs (origin/destination/
    # dates/budget/travelers for travel, role/location for jobs,
    # product/budget for shopping). Keys are free-form short strings.
    slots: dict[str, Any] = field(default_factory=dict)
    missing_slots: list[str] = field(default_factory=list)
    # Multi-task decomposition: each entry owns its sub-query, use_case,
    # presentation and steps. Empty = single-intent query (legacy path).
    tasks: list[SubTask] = field(default_factory=list)
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
1b. TRAVEL BOOKING always means travel, never shopping. If the query has
    travel words (flight, hotel, trip, travel, itinerary, fly, stay,
    vacation, book a flight/hotel, reserve a room), then use_case MUST be
    "travel", the FIRST step MUST use "google_flights" (or "google_hotels"
    for stays), and presentation MUST be "travel_choices". A budget
    ("under 60000") never turns travel into shopping. For google_flights
    steps, ALSO fill slots origin/destination/dates — the runner resolves
    airport codes from slots, not from the query string.
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
- "teach me crispr with videos" ->
  {{"use_case": "youtube_learning", "steps": [{{"engine": "youtube", "query": "crispr gene editing tutorial beginners", "num_results": 8}}], "presentation": "youtube_path"}}
- "plan a trip" (no origin/destination) ->
  {{"use_case": "travel", "steps": [], "presentation": "travel_choices", "needs_clarification": true, "clarifying_question": "Where are you flying from, and where to?", "slots": {{}}, "missing_slots": ["origin", "destination", "dates"]}}
- "book a flight from Bengaluru to Tokyo next month under 60000" ->
  {{"use_case": "travel", "steps": [{{"engine": "google_flights", "query": "Bengaluru to Tokyo flights", "num_results": 8}}, {{"engine": "google_hotels", "query": "hotels Tokyo", "num_results": 8}}], "presentation": "travel_choices", "slots": {{"origin": "Bengaluru", "destination": "Tokyo", "dates": "next month", "budget": "60000"}}, "missing_slots": []}}

SLOT EXTRACTION (for agentic handoff — every pick gets an action button):
- travel: origin, destination, dates, budget, travelers
- jobs: role, location, remote
- shopping: product, budget, brand
- Always extract what the user stated into "slots" (short strings, max 120 chars each).
- List genuinely absent required choices in "missing_slots" using exactly these keys.
- Set needs_clarification=true ONLY when a required choice is missing: travel without origin/destination, jobs without any role, or a query under 3 meaningful words. Otherwise false.
- "NVDA stock price today" ->
  {{"use_case": "finance", "steps": [{{"engine": "google_finance", "query": "NVDA", "num_results": 5}}, {{"engine": "google_news", "query": "Nvidia stock news", "num_results": 5}}], "presentation": "finance_snapshot"}}

OUTPUT CONTRACT:
- Reply with JSON only, matching this schema:
  {{"use_case": "<short label like shopping|youtube_learning|deep_dive|finance|jobs|travel|research|news|local|events|trends|patents|academic>",
   "steps": [{{"engine": "<one of allowed>", "query": "<rewritten search query>", "num_results": <1-10>, "location": "<city/country or null>"}}],
   "presentation": "<one of: {presentations}>",
   "tasks": [{{"id": "task-1", "label": "<short label>", "query": "<rewritten sub-query>",
     "use_case": "<short label>", "presentation": "<one of: {presentations}>",
     "steps": [{{"engine": "<one of allowed>", "query": "<rewritten search query>", "num_results": <1-10>}}]}}],
   "needs_clarification": <true|false>,
   "clarifying_question": "<one specific question or empty>",
   "slots": {{"<slot key>": "<short value>"}},
   "missing_slots": ["<absent required slot keys>"],
   "confidence": "<high|medium|low>",
   "reasoning": "<one sentence>"}}
- Use at most 3 steps. First step is the primary engine.
- Multi-intent queries (e.g. "papers about CRISPR and plan a Goa trip") MUST
  decompose into "tasks" (at most 3, each with own use_case/presentation/
  rewritten query/steps); single-intent queries return exactly one task.
  Top-level use_case/presentation/steps mirror the first task.
- Every task "query" must be SELF-CONTAINED: process the full prompt first,
  then inject the shared context (topic, place, product) into each task
  query plus the search type it needs. Never emit a fragment like "some
  good videos as well" — rewrite to "Bitcoin explainer YouTube videos".
  Clauses asking for videos map to use_case youtube_learning with a
  youtube step, even without learn-words.
- Ambiguous queries set needs_clarification with ONE concise question plus
  missing_slots: shopping without budget, travel without dates/party size,
  multi-intent with no clean split. Otherwise false.
- Rewrite queries for search (keywords, not full sentences). YouTube queries should target tutorials/explainers.
- Set needs_clarification=true ONLY when a required choice is missing: travel without origin/destination, jobs without any role, or a query under 3 meaningful words. Otherwise false.
- Never invent engines or parameters. Location only when the user implies a place.
- Return ONLY the JSON object and nothing else: no thinking, no prose, no markdown fences.
"""


_VIDEO_LEARN_RE = re.compile(r"\b(video|videos|tutorial|tutorials|talk|course videos|youtube)\b", re.I)

# Travel-booking verbs beat the buy-intent rule: "book a flight/hotel" is
# travel research ending in a Book-ticket handoff, never shopping.
_TRAVEL_BOOK_RE = re.compile(
    r"\b(flight|flights|fly|airline|hotel|hotels|trip|travel|itinerary|vacation|stay|check-in|resort|airbnb)\b",
    re.I,
)


def _has_slot(slots: dict[str, Any], key: str) -> bool:
    """Non-empty slot value present (case-insensitive key match)."""
    if not isinstance(slots, dict):
        return False
    for k, v in slots.items():
        if str(k).lower() == key and str(v or "").strip():
            return True
    return False


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
    # Travel booking ("book a flight/hotel", trip planning) is never shopping,
    # even when a budget is stated — it ends in a Book-ticket handoff.
    is_travel = bool(_TRAVEL_BOOK_RE.search(q) or _FLIGHT_RE.search(q) or _HOTEL_RE.search(q))
    if is_travel:
        if plan.use_case == "shopping":
            plan.use_case = "travel"
        if plan.presentation == "shopping_top2":
            plan.presentation = "travel_choices"
        if "google_shopping" in engines and not any(
            e in engines for e in ("google_flights", "google_hotels", "google_maps")
        ):
            plan.steps = [s for s in plan.steps if s.engine != "google_shopping"] or [
                RouterStep(engine="google_flights", query=q.strip()[:300] or q)
            ]
            engines = [s.engine for s in plan.steps]
        plan.reasoning = (plan.reasoning + " [rule: travel-booking -> travel]").strip()
        # Fall through to generic backfill below (no early return): travel
        # queries still need maps/search steps when the LLM under-plans.
    is_finance = bool(_FINANCE_RE.search(q))
    buy_signal = bool((_SHOP_RE.search(q) or _BUDGET_RE.search(q) or "$" in q or "₹" in q) and not is_finance)
    if buy_signal and not is_travel and "google_shopping" not in engines:
        plan.steps.insert(0, RouterStep(engine="google_shopping", query=q.strip()[:300] or q))
        if plan.use_case == "research":
            plan.use_case = "shopping"
        plan.presentation = "shopping_top2"
        plan.reasoning = (plan.reasoning + " [rule: buy-intent -> shopping]").strip()
    _backfill_steps(plan.steps, plan.use_case, plan.presentation, plan.slots or {}, q)
    video_signal = bool(_LEARN_RE.search(q) and _VIDEO_LEARN_RE.search(q))
    if video_signal and "youtube" not in engines:
        plan.steps.insert(0, RouterStep(engine="youtube", query=q.strip()[:300] or q))
        if plan.use_case == "research":
            plan.use_case = "youtube_learning"
        plan.presentation = "youtube_path"
        plan.reasoning = (plan.reasoning + " [rule: video-learning -> youtube]").strip()
    return plan


def _backfill_steps(
    steps: list[RouterStep],
    use_case: str,
    presentation: str,
    slots: dict[str, Any],
    query: str,
) -> None:
    """Mutate ``steps`` in place: guarantee the specialized engines a
    presentation needs (small LLMs often plan a single generic step).

    Idempotent: never duplicates an engine already planned. Safe to call
    twice (classify time + after runtime slot merge). Caps at 3 steps,
    dropping generic search first.
    """
    engines = [s.engine for s in steps]
    specialized = [e for e in engines if e != "google_search"]
    want: list[str] = []
    if use_case == "travel" or presentation == "travel_choices":
        # Flight/hotel top-up whenever slots allow, even on good plans.
        # Maps always: places power the itinerary + top-places ranking.
        if _has_slot(slots, "origin") and _has_slot(slots, "destination"):
            want += ["google_flights", "google_hotels"]
        want += ["google_maps"]
        if not specialized:
            want += ["google_search"]
    elif not specialized:
        if use_case == "shopping" or presentation == "shopping_top2":
            want += ["google_shopping", "google_search"]
        elif use_case == "jobs" or presentation == "jobs_table":
            want += ["google_jobs", "google_search"]
        elif use_case in ("academic", "deep_dive") or presentation in (
            "deep_dive",
            "research_brief",
        ):
            want += ["google_scholar", "google_search"]
        elif use_case == "finance" or presentation == "finance_snapshot":
            want += ["google_finance", "google_news"]
        elif use_case == "news":
            want += ["google_news", "google_search"]
    q = (query or "").strip()[:300] or (query or "")
    for eng in want:
        if eng not in engines and eng in TOOL_FACTORIES:
            steps.append(RouterStep(engine=eng, query=q))
            engines.append(eng)
    while len(steps) > 3:
        idx = next((i for i, s in enumerate(steps) if s.engine == "google_search"), 0)
        steps.pop(idx)


def _parse_router_step(raw: Any, fallback_query: str) -> RouterStep | None:
    """Validate one LLM step dict against the engine registry."""
    if not isinstance(raw, dict):
        return None
    engine = str(raw.get("engine", ""))
    if engine not in ENGINE_REGISTRY or engine not in TOOL_FACTORIES:
        return None
    q = str(raw.get("query", "") or fallback_query).strip()[:300] or fallback_query
    try:
        n = max(1, min(int(raw.get("num_results", 8)), 10))
    except (TypeError, ValueError):
        n = 8
    loc = raw.get("location")
    return RouterStep(engine=engine, query=q, num_results=n, location=str(loc)[:120] if loc else None)


# Primary-intent -> (use_case, presentation) for regex-fallback sub-tasks.
_INTENT_TASK_PROFILE: dict[str, tuple[str, str]] = {
    "SHOPPING": ("shopping", "shopping_top2"),
    "PRODUCT_COMPARISON": ("shopping", "shopping_top2"),
    "PRICE_COMPARISON": ("shopping", "shopping_top2"),
    "DECISION_SUPPORT": ("shopping", "shopping_top2"),
    "ACADEMIC_RESEARCH": ("academic", "deep_dive"),
    "TECHNICAL_RESEARCH": ("research", "research_brief"),
    "PATENT_RESEARCH": ("research", "generic"),
    "TRAVEL": ("travel", "travel_choices"),
    "PLANNING": ("travel", "travel_choices"),
    "LOCAL_DISCOVERY": ("local", "local_list"),
    "EVENTS": ("events", "generic"),
    "JOB_SEARCH": ("jobs", "jobs_table"),
    "COMPANY_RESEARCH": ("research", "research_brief"),
    "FINANCE": ("finance", "finance_snapshot"),
    "NEWS": ("news", "generic"),
    "TREND_ANALYSIS": ("research", "generic"),
    "LEARNING": ("learning", "learning_plan"),
    "VIDEO_LEARNING": ("youtube_learning", "youtube_path"),
    "FORUM_DISCOVERY": ("research", "generic"),
    "IMAGE_DISCOVERY": ("research", "generic"),
    "VERIFICATION": ("research", "generic"),
}


def _primary_intent(query: str) -> str:
    intents = classify_query(query).intent
    for intent in intents:
        if intent != "GENERAL_RESEARCH":
            return intent
    return "GENERAL_RESEARCH"


def _regex_subtasks(query: str) -> list[SubTask]:
    """Deterministic fallback tasks from :func:`split_tasks_regex`."""
    parts = split_tasks_regex(query)
    if len(parts) < 2:
        return []
    tasks: list[SubTask] = []
    for part in parts:
        clause = part["query"]
        # Video mention alone selects the youtube engine: a clause asking
        # for videos wants videos, with or without learn-words.
        if _VIDEO_LEARN_RE.search(clause) and "youtube" in TOOL_FACTORIES:
            use_case, presentation, engines = "youtube_learning", "youtube_path", ["youtube"]
        else:
            primary = _primary_intent(clause)
            use_case, presentation = _INTENT_TASK_PROFILE.get(primary, ("research", "generic"))
            engines = [e for e in INTENT_TOOLS.get(primary, ["google_search"]) if e in TOOL_FACTORIES][:2]
            if not engines:
                engines = ["google_search"]
        tasks.append(
            SubTask(
                id=part["id"],
                label=part["label"],
                query=clause,
                use_case=use_case,
                presentation=presentation,
                steps=[RouterStep(engine=e, query=clause) for e in engines],
            )
        )
    return tasks


def _parse_tasks(parsed: dict[str, Any], query: str, plan: RouterPlan) -> list[SubTask]:
    """Parse LLM tasks with validation; regex fallback when LLM gives none."""
    raw_tasks = parsed.get("tasks")
    tasks: list[SubTask] = []
    if isinstance(raw_tasks, list):
        for i, raw in enumerate(raw_tasks[:3]):
            if not isinstance(raw, dict):
                continue
            tq = str(raw.get("query", "")).strip()[:300] or query
            steps = [
                step
                for r in (raw.get("steps") or [])[:3]
                if (step := _parse_router_step(r, tq)) is not None
            ]
            if not steps:
                steps = [RouterStep(engine="google_search", query=tq)]
            presentation = raw.get("presentation")
            if presentation not in PRESENTATIONS:
                presentation = plan.presentation if plan.presentation in PRESENTATIONS else "research_brief"
            use_case = str(raw.get("use_case") or plan.use_case)[:60] or "research"
            tasks.append(
                SubTask(
                    id=str(raw.get("id") or f"task-{i + 1}")[:20],
                    label=str(raw.get("label") or use_case)[:60],
                    query=tq,
                    use_case=use_case,
                    presentation=presentation,
                    steps=steps,
                )
            )
    if len(tasks) > 1:
        return tasks
    # Single LLM task but regex sees 2+ distinct intent families: the LLM
    # missed a multi-intent query — deterministic split wins (recall first).
    regex_tasks = _regex_subtasks(query)
    if len(regex_tasks) > 1:
        return regex_tasks
    if tasks:
        return tasks
    return regex_tasks


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
        # Even with no LLM output, deterministic split still applies.
        plan.tasks = _regex_subtasks(query)
        return _enforce_hard_rules(query, plan)
    plan.use_case = str(parsed.get("use_case", "research"))[:60] or "research"
    if parsed.get("presentation") in PRESENTATIONS:
        plan.presentation = parsed["presentation"]
    for raw in (parsed.get("steps") or [])[:3]:
        step = _parse_router_step(raw, query)
        if step is not None:
            plan.steps.append(step)
    if not plan.steps:
        plan.steps = [RouterStep(engine="google_search", query=query)]
    plan.needs_clarification = bool(parsed.get("needs_clarification", False))
    plan.clarifying_question = str(parsed.get("clarifying_question", ""))[:300]
    raw_slots = parsed.get("slots")
    if isinstance(raw_slots, dict):
        plan.slots = {str(k)[:40]: str(v)[:120] for k, v in raw_slots.items() if str(v).strip()} or {}
    raw_missing = parsed.get("missing_slots")
    if isinstance(raw_missing, list):
        plan.missing_slots = [str(s)[:40] for s in raw_missing if isinstance(s, str) and str(s).strip()][:8]
    if parsed.get("confidence") in ("high", "medium", "low"):
        plan.confidence = parsed["confidence"]
    plan.reasoning = str(parsed.get("reasoning", ""))[:300]
    plan.tasks = _parse_tasks(parsed, query, plan)
    return _enforce_hard_rules(query, plan)


def classify_request(
    query: str,
    complete: CompleteFn | None = None,
    backend: Literal["llm", "laya", "hybrid"] | None = None,
) -> RouterPlan:
    """Classify user request using configured backend (default 'laya')."""
    # Allow explicit complete mock in tests when backend is not explicitly requested
    if complete is not None and backend is None:
        return classify_with_llm(query, complete=complete)

    chosen_backend = (backend or os.getenv("ROUTER_BACKEND", "laya")).strip().lower()
    if chosen_backend == "llm":
        return classify_with_llm(query, complete=complete)
    elif chosen_backend == "hybrid":
        try:
            from .laya_router import classify_with_laya
            laya_plan = classify_with_laya(query)
            if laya_plan.confidence in ("high", "medium") and not laya_plan.tasks:
                return laya_plan
        except Exception:
            pass
        return classify_with_llm(query, complete=complete)
    else:  # default: 'laya'
        try:
            from .laya_router import classify_with_laya
            return classify_with_laya(query)
        except Exception:
            return classify_with_llm(query, complete=complete)



def _invoke_kwargs(step: RouterStep, slots: dict[str, Any]) -> dict[str, Any] | None:
    """Translate a generic {query, num_results} step into engine-native params.

    Most engines take ``query``; the exceptions are handled explicitly:
    flights needs IATA codes (resolved from slots), hotels needs dates,
    trends takes no ``num_results``, and only search/jobs/shopping/news/
    events accept ``location``. Returns ``None`` when a required parameter
    cannot be resolved (caller records a graceful skip, not a crash).
    """
    n = max(1, min(step.num_results, 10))
    if step.engine == "google_flights":
        origin = resolve_airport(slots.get("origin")) or resolve_airport(step.query)
        dest = resolve_airport(slots.get("destination"))
        if not dest:
            # Try "X to Y" inside the step query as a last resort.
            parts = re.split(r"\bto\b", step.query, maxsplit=1, flags=re.I)
            if len(parts) == 2:
                origin = origin or resolve_airport(parts[0])
                dest = resolve_airport(parts[1])
        if not origin or not dest:
            return None
        kwargs: dict[str, Any] = {
            "departure_id": origin,
            "arrival_id": dest,
            "num_results": n,
        }
        dates = slots.get("dates") or ""
        explicit_return = slots.get("return_date")
        if explicit_return:
            kwargs["outbound_date"] = parse_trip_dates(str(dates))[0] if dates else ""
            kwargs["return_date"] = str(explicit_return)[:10]
            kwargs["trip_type"] = "1"
        elif dates:
            outbound, ret = flight_dates(str(dates))
            kwargs["outbound_date"] = outbound
            if ret:
                kwargs["return_date"] = ret
                kwargs["trip_type"] = "1"
            else:
                kwargs["trip_type"] = "2"  # one-way: no invented return leg
        else:
            kwargs["trip_type"] = "2"
        if slots.get("currency"):
            kwargs["currency"] = str(slots["currency"])[:8]
        return kwargs
    if step.engine == "google_hotels":
        check_in, check_out = parse_trip_dates(slots.get("dates"))
        if not check_in or not check_out:
            return None  # graceful skip (same "needs dates" record as flights)
        hotel_q = step.query
        dest = str(slots.get("destination") or "").strip()
        if dest and "hotel" not in hotel_q.lower():
            # Raw trip clauses ("plan a 4-day trip to Goa") return nothing
            # from the Hotels engine: search the destination instead.
            hotel_q = f"hotels in {dest}"
        kwargs = {
            "query": hotel_q,
            "check_in_date": check_in,
            "check_out_date": check_out,
            "num_results": n,
        }
        if slots.get("currency"):
            kwargs["currency"] = str(slots["currency"])[:8]
        return kwargs
    if step.engine == "google_trends":
        kwargs = {"query": step.query}
        if step.location:
            kwargs["geo"] = step.location
        return kwargs
    kwargs = {"query": step.query, "num_results": n}
    if step.location and step.engine in (
        "google_search", "google_jobs", "google_shopping", "google_news", "google_events",
    ):
        kwargs["location"] = step.location
    return kwargs


def execute_plan(plan: RouterPlan, budget: BudgetLimits | None = None) -> tuple[list[dict[str, Any]], RunTrace]:
    """PASS 2: call the exact endpoints via Haystack tools (read-only)."""
    budget = budget or BudgetLimits(max_serpapi_calls=5)
    trace = RunTrace()
    tracker = BudgetTracker(budget)
    slots = getattr(plan, "slots", None) or {}
    outputs: list[dict[str, Any]] = []
    for step in plan.steps[:3]:
        try:
            tracker.consume(1)
        except Exception:
            break
        started = time.monotonic()
        kwargs = _invoke_kwargs(step, slots)
        if kwargs is None:
            reason = (
                "Skipped: needs check-in and check-out dates."
                if step.engine == "google_hotels"
                else "Skipped: needs origin and destination airports."
            )
            trace.add(
                ToolCallRecord(
                    tool=step.engine,
                    query=step.query[:120],
                    latency_ms=(time.monotonic() - started) * 1000.0,
                    error=reason,
                )
            )
            outputs.append({"engine": step.engine, "results": [], "evidence": [], "error": reason})
            continue
        try:
            tool = TOOL_FACTORIES[step.engine]()
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
Rules: rank by fit to the request (price/budget match, recency, authority, relevance). Order every index given. Reasons must cite concrete attributes (price, rating, date, source).
If the request involves travel/places, also propose a day-by-day itinerary: {{"itinerary": [{{"day": 1, "title": "<day theme>", "items": [{{"name": "<place from RESULTS>", "note": "<why visit>"}}], "note": "<logistics tip or empty>"}}]}}. Reference only places present in RESULTS, at most 3 items per day."""


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
        "itinerary": parsed.get("itinerary") if isinstance(parsed.get("itinerary"), list) else [],
    }


_DIGEST_HEADINGS = (
    "What you asked",
    "What I found",
    "Where it's from",
    "What the results explain",
    "How I thought it through",
    "Why these are the better picks",
    "How to navigate",
)

_DIGEST_SYSTEM = """Write a structured result digest, about 45 lines, plain text, short lines.
Use EXACTLY these bracketed headings in this order, each on its own line:
[What you asked] 2-4 lines: the user's request restated in simple terms.
[What I found] 4-6 lines: what the results are, counts per task, result kinds.
[Where it's from] 3-5 lines: which search engines and source types per task.
[What the results explain] 5-8 lines: the substance of the results per task.
[How I thought it through] 4-6 lines: plan recap from the TRACE lines given.
[Why these are the better picks] 6-10 lines: named top picks with concrete signals (price, rating, citations, authority).
[How to navigate] 5-8 lines: which result serves which need, plus one tip on tracing claims to sources.
Rules: name only real titles from ITEMS; never invent titles, counts, or sources; no markdown, no tables, no emojis; 35-50 lines total; never name internal engine ids (google_search, google_scholar, youtube, ...) — use plain words (Web, Scholar, videos, places)."""


def _digest_top_items(presentation: dict[str, Any]) -> list[str]:
    """Short 'title + signal' lines for the digest's picks sections."""
    items: list[str] = []
    p = presentation or {}
    for f in (p.get("findings") or [])[:4]:
        claim = str(f.get("claim") or f.get("title") or "").strip()[:140]
        if claim:
            items.append(claim)
    for pick in (p.get("picks") or [])[:5]:
        t = str(pick.get("title") or "").strip()[:100]
        if not t:
            continue
        sig = pick.get("price") or (f"rating {pick.get('rating')}" if pick.get("rating") is not None else "")
        items.append(f"{t} ({sig})" if sig else t)
    for tp in (p.get("top_picks") or [])[:3]:
        t = str(tp.get("title") or "").strip()[:100]
        if not t:
            continue
        cit = tp.get("citations")
        items.append(f"{t} (cited by {cit})" if isinstance(cit, int) and cit > 0 else t)
    for paper in (p.get("papers") or [])[:4]:
        t = str(paper.get("title") or "").strip()[:100]
        if t and t not in items:
            items.append(t)
    for pl in (p.get("top_places") or [])[:5]:
        name = str(pl.get("name") or "").strip()[:100]
        if name and name not in items:
            items.append(name)
    for lvl in ("beginner", "intermediate", "advanced"):
        for v in ((p.get("levels") or {}).get(lvl) or [])[:2]:
            t = str(v.get("title") or "").strip()[:100]
            if t and t not in items:
                items.append(f"{t} [{lvl}]")
    for day in (p.get("itinerary") or [])[:4]:
        for it in (day.get("items") or [])[:3]:
            name = str(it.get("name") or "").strip()[:100]
            if name and name not in items:
                items.append(name)
    for stage in (p.get("stages") or [])[:4]:
        for t in (stage.get("topics") or [])[:3]:
            title = str(t.get("title") or "").strip()[:100]
            if title and title not in items:
                items.append(title)
    for h in (p.get("headlines") or [])[:4]:
        title = str(h.get("title") or "").strip()[:100]
        if title and title not in items:
            items.append(title)
    rest: list[dict[str, Any]] = [
        *(p.get("flights") or []),
        *(p.get("hotels") or []),
        *(p.get("places") or []),
        *(p.get("jobs") or []),
        *(p.get("results") or []),
    ]
    for r in rest[:8]:
        t = str(r.get("title") or r.get("name") or "").strip()[:100]
        if t and t not in items:
            items.append(t)
    return items[:12]


_ENGINE_LABEL = {
    "google_search": "Web",
    "google_scholar": "Scholar",
    "google_news": "News",
    "google_shopping": "Shopping",
    "google_jobs": "Jobs",
    "google_maps": "Places",
    "google_flights": "Flights",
    "google_hotels": "Hotels",
    "google_finance": "Markets",
    "google_trends": "Trends",
    "google_events": "Events",
    "forums": "Discussions",
    "google_forums": "Discussions",
    "images": "Images",
    "google_images": "Images",
    "patents": "Patents",
    "google_patents": "Patents",
    "youtube": "YouTube",
}


def _engine_label(name: str) -> str:
    return _ENGINE_LABEL.get(str(name or "").lower(), str(name or "?"))


def _humanize(text: str) -> str:
    """Replace internal engine ids with plain source words for user display."""
    out = str(text or "")
    for key in sorted(_ENGINE_LABEL, key=len, reverse=True):
        out = re.sub(r"\b" + re.escape(key) + r"\b", _ENGINE_LABEL[key], out, flags=re.I)
    return out


def _digest_fallback(
    query: str,
    sections: list[dict[str, Any]],
    route: list[dict[str, Any]],
    reasoning: list[str],
) -> str:
    """Deterministic digest with the same 7 headings (no LLM needed)."""
    total = sum(int(s.get("results_count") or 0) for s in sections)
    lines = ["[What you asked]", f"In simple terms: {query.strip()[:240]}", ""]
    lines.append("[What I found]")
    if not sections:
        lines.append("No results this run.")
    for s in sections:
        title = str(s.get("title") or "results").strip().rstrip(".").capitalize()
        lines.append(f"{title}: {s.get('results_count', 0)} results.")
    lines += ["", "[Where it's from]"]
    engines: list[str] = []
    for entry in route or []:
        if entry.get("status") == "ok":
            label = _engine_label(entry.get("vertical") or entry.get("tool"))
            if label not in engines:
                engines.append(label)
    lines.append(", ".join(engines) or "direct index lookups")
    lines += ["", "[What the results explain]"]
    for s in sections:
        title = str(s.get("title") or "results").strip().rstrip(".").capitalize()
        tops = _digest_top_items(s.get("presentation") or {})
        lines.append(f"{title}:")
        if tops:
            lines.extend(f"- {t}" for t in tops[:4])
        else:
            lines.append("- overview matches")
    lines += ["", "[How I thought it through]"]
    thought = [_humanize(str(r)[:200]) for r in (reasoning or [])[:6]] or ["Planned, searched, ranked."]
    lines += thought
    lines += ["", "[Why these are the better picks]"]
    shown = 0
    for s in sections:
        for t in _digest_top_items(s.get("presentation") or {})[:4]:
            if shown >= 8:
                break
            lines.append(f"- {t}")
            shown += 1
        if shown >= 8:
            break
    if not shown:
        lines.append("Ranked by relevance, recency, and source authority.")
    lines += ["", "[How to navigate]"]
    lines += [
        "Open a pick for full detail at its source.",
        "Hover a source card to trace which result it backs.",
        "Use Refine chips to narrow (cheaper, recent, other brands).",
        f"{total} results total — start with the top picks above.",
    ]
    return "\n".join(lines)[:4000]


def _short_verdict(query: str, sections: list[dict[str, Any]]) -> str:
    """Plain 3-line verdict for the answer header: query, found, explanation.

    No brackets, no engine names — safe to render as-is.
    """
    try:
        total = sum(int(s.get("results_count") or 0) for s in sections)
        q = (query or "").strip().rstrip(".?")[:160]
        tops: list[str] = []
        for s in sections or []:
            for t in _digest_top_items(s.get("presentation") or {})[:2]:
                if t not in tops:
                    tops.append(t)
            if len(tops) >= 3:
                break
        found = f"Found {total} result{'s' if total != 1 else ''} on {q}." if q else f"Found {total} results."
        if tops:
            return f"{found} Top answers: {'; '.join(tops[:3])}."
        return found
    except Exception:
        return ""


def build_digest_summary(
    query: str,
    sections: list[dict[str, Any]],
    route: list[dict[str, Any]],
    reasoning: list[str],
    text_fn: Callable[[str, str], str] | None = None,
) -> str:
    """~45-line structured digest: LLM-written, deterministic fallback.

    ``text_fn(prompt, fallback)`` performs the long-form LLM call; defaults
    to the separate reasoning model. Never raises.
    """
    try:
        sec_view = []
        for s in sections or []:
            pres = s.get("presentation") or {}
            sec_view.append(
                {
                    "title": s.get("title"),
                    "use_case": s.get("use_case"),
                    "count": s.get("results_count", 0),
                    "top": _digest_top_items(pres),
                    "engines": sorted(
                        {
                            str(e.get("vertical") or e.get("tool") or "?")
                            for e in (s.get("route") or [])
                            if e.get("status") == "ok"
                        }
                    ),
                }
            )
        context = {
            "query": (query or "")[:300],
            "sections": sec_view,
            "failed": sorted(
                {
                    str(e.get("vertical") or e.get("tool") or "?")
                    for e in (route or [])
                    if e.get("status") not in ("ok", None)
                }
            ),
            "trace": [str(r)[:200] for r in (reasoning or [])[:8]],
        }
        fallback = _digest_fallback(query, sections or [], route or [], reasoning or [])
        prompt = _DIGEST_SYSTEM + "\nCONTEXT:\n" + json.dumps(context)[:5000]
        if text_fn is None:

            def text_fn(prompt: str, fb: str) -> str:  # noqa: F821 - closure default
                return reasoning_line(prompt, fb, max_tokens=1100)

        digest = text_fn(prompt, fallback)
        if not isinstance(digest, str) or not digest.strip():
            return fallback
        if not any(f"[{h}]" in digest for h in _DIGEST_HEADINGS):
            return fallback
        return _humanize(digest).strip()[:4000]
    except Exception:
        try:
            return _digest_fallback(query, sections or [], route or [], reasoning or [])
        except Exception:
            return f"[What I found]\nFound results for: {(query or '')[:200]}"
    return [results[i] for i in order if 0 <= i < len(results)]


def _reorder(results: list[dict], order: list[int]) -> list[dict]:
    return [results[i] for i in order if 0 <= i < len(results)]


def _citations_of(result: dict) -> int:
    """Best-effort citation count for scholar results (missing -> 0)."""
    for key in ("citations", "cited_by", "cited_by_count", "citation_count"):
        try:
            val = result.get(key)
            if isinstance(val, dict):
                val = val.get("total")
            if val is not None:
                return max(0, int(val))
        except (TypeError, ValueError):
            continue
    return 0


def _place_name(result: dict) -> str:
    return str(result.get("title", "") or result.get("name", ""))[:200]


def _validate_itinerary(raw: Any, places: list[dict]) -> list[dict]:
    """Normalize an LLM-proposed itinerary; [] when unusable (fallback path)."""
    if not isinstance(raw, list) or not places:
        return []
    by_name = { _place_name(p).lower(): p for p in places if _place_name(p)}
    days: list[dict] = []
    for entry in raw[:7]:
        if not isinstance(entry, dict):
            continue
        items: list[dict] = []
        for it in (entry.get("items") or [])[:3]:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name", ""))[:200].strip()
            if not name:
                continue
            match = by_name.get(name.lower())
            if match is None:
                match = next((p for key, p in by_name.items() if name.lower() in key or key in name.lower()), None)
            items.append(
                {
                    "name": name,
                    "url": (match or {}).get("url", ""),
                    "note": str(it.get("note", ""))[:200],
                }
            )
        if not items:
            continue
        try:
            day = max(1, int(entry.get("day", len(days) + 1)))
        except (TypeError, ValueError):
            day = len(days) + 1
        days.append(
            {
                "day": day,
                "title": str(entry.get("title", "") or f"Day {day}")[:200],
                "items": items,
                "note": str(entry.get("note", ""))[:300],
            }
        )
    return days


def _fallback_itinerary(places: list[dict]) -> list[dict]:
    """Deterministic geo-group fallback: chunk ranked places, 3 per day."""
    days: list[dict] = []
    for n, i in enumerate(range(0, min(len(places), 9), 3), start=1):
        chunk = places[i : i + 3]
        days.append(
            {
                "day": n,
                "title": f"Day {n}",
                "items": [
                    {"name": _place_name(p), "url": p.get("url", ""), "note": ""}
                    for p in chunk
                    if _place_name(p)
                ],
                "note": "",
            }
        )
    return [d for d in days if d["items"]]


def _shape_presentation(
    plan: RouterPlan, tool_outputs: list[dict[str, Any]], ranking: dict[str, Any]
) -> dict[str, Any]:
    """Shape ranked results into the per-use-case UI payload (pre-actions)."""
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
        for r in ranked[:5]:
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
        best = next((p for p in picks if p.get("price")), None)
        if best:
            deals_note = f"Best value: {best.get('title', '')} at {best.get('price')}".strip()
        elif picks:
            deals_note = f"Compared {len(picks)} options; no prices listed."
        else:
            deals_note = ""
        return {"type": "shopping_top2", "picks": picks, "deals_note": deals_note, "summary": ranking.get("summary", "")}
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
        papers = sorted(
            [r for r in ranked if r.get("_engine") == "google_scholar"],
            key=_citations_of,
            reverse=True,
        )[:5]
        findings = [
            {"claim": (r.get("snippet", "") or r.get("description", "") or r.get("title", ""))[:280],
             "url": r.get("url", ""), "title": r.get("title", ""), "why": reason_for(r)}
            for r in ranked[:6]
        ]
        top_picks = [
            {
                "title": p.get("title", ""),
                "url": p.get("url", ""),
                "citations": _citations_of(p),
                "pick_reason": reason_for(p) or f"{_citations_of(p)} citations.",
            }
            for p in papers[:3]
        ]
        return {"type": "deep_dive", "summary": ranking.get("summary", ""), "findings": findings, "papers": papers, "top_picks": top_picks}
    if presentation == "jobs_table":
        return {"type": "jobs_table", "jobs": ranked[:8], "summary": ranking.get("summary", "")}
    if presentation == "travel_choices":
        flights = [r for r in ranked if r.get("_engine") == "google_flights"][:4]
        hotels = [r for r in ranked if r.get("_engine") == "google_hotels"][:4]
        places_pool = [r for r in ranked if r.get("_engine") == "google_maps"][:8]
        top_places = [
            {
                "title": _place_name(p),
                "url": p.get("url", ""),
                "rating": p.get("rating"),
                "why": reason_for(p),
            }
            for p in places_pool[:5]
        ]
        itinerary = _validate_itinerary(ranking.get("itinerary"), places_pool) or _fallback_itinerary(
            places_pool
        )
        return {
            "type": "travel_choices",
            "flights": flights,
            "hotels": hotels,
            "places": places_pool[:4],
            "top_places": top_places,
            "itinerary": itinerary,
            "summary": ranking.get("summary", ""),
            "note": "Choices are planned and ready — no booking performed. Booking is a later decision.",
        }
    if presentation == "local_list":
        return {"type": "local_list", "places": ranked[:8], "summary": ranking.get("summary", "")}
    if presentation == "learning_plan":
        stages = ["Goal", "Prerequisites", "Fundamentals", "Resources", "Projects", "Papers", "Advanced"]
        pools = {
            "Prerequisites": [r for r in ranked if r.get("_engine") == "google_search"],
            "Fundamentals": [r for r in ranked if r.get("_engine") == "google_search"],
            "Resources": [r for r in ranked if r.get("_engine") in ("youtube", "google_search")],
            "Projects": [r for r in ranked if r.get("_engine") in ("google_forums", "google_search")],
            "Papers": [r for r in ranked if r.get("_engine") == "google_scholar"],
            "Advanced": [r for r in ranked if r.get("_engine") == "google_scholar"],
        }
        plan_stages = []
        for stage in stages[1:]:
            items = (pools.get(stage) or ranked)[:3]
            plan_stages.append(
                {
                    "stage": stage,
                    "topics": [
                        {"title": it.get("title", ""), "url": it.get("url", ""), "why": reason_for(it)}
                        for it in items
                    ],
                }
            )
        return {
            "type": "learning_plan",
            "goal": ranking.get("summary", ""),
            "stages": plan_stages,
            "summary": ranking.get("summary", ""),
        }
    return {"type": "generic", "results": ranked[:10], "summary": ranking.get("summary", "")}


def build_presentation(
    plan: RouterPlan,
    tool_outputs: list[dict[str, Any]],
    ranking: dict[str, Any],
    slots: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Shape ranked results, then attach one outbound action per pick.

    Actions are read-only handoffs ("Book ticket" opens the provider
    site). ``slots`` defaults to the plan's extracted slots and feeds
    fallback provider-search URLs when a result has no direct link.
    """
    shaped = _shape_presentation(plan, tool_outputs, ranking)
    return attach_actions(shaped, plan.use_case, slots if slots is not None else plan.slots)


def _confidence(total: int, errors: int) -> str:
    if total >= 8 and errors == 0:
        return "high"
    if total >= 3:
        return "medium"
    return "low"


def _process_task_outputs(
    task_query: str,
    task_plan: RouterPlan,
    tool_outputs: list[dict[str, Any]],
    complete: CompleteFn | None,
    constraints: dict[str, Any],
) -> dict[str, Any]:
    """Shared PASS-3 pipeline for one task: funnel -> rank -> shape -> evidence."""
    flat = [r for out in tool_outputs for r in (out.get("results", []) or [])]
    funnel = apply_funnel(flat, constraints)
    matched = funnel["matched_results"]
    ranking = rank_with_llm(task_query, matched, complete=complete)
    order = [i for i in (ranking.get("order") or []) if 0 <= i < len(matched)]
    order += [i for i in range(len(matched)) if i not in order]
    ranked_flat = [matched[i] for i in order]
    new_index = {id(matched[i]): pos for pos, i in enumerate(order)}
    reasons: dict[str, str] = {}
    for k, v in (ranking.get("reasons", {}) or {}).items():
        try:
            orig = int(k)
            if 0 <= orig < len(matched) and id(matched[orig]) in new_index and isinstance(v, str):
                reasons[str(new_index[id(matched[orig])])] = v[:200]
        except (TypeError, ValueError):
            continue
    ordered_ranking = {
        "order": list(range(len(ranked_flat))),
        "reasons": reasons,
        "summary": ranking.get("summary", ""),
        "itinerary": ranking.get("itinerary", []),
    }
    by_id = {id(r) for r in ranked_flat}
    filtered_outputs = []
    for out in tool_outputs:
        kept = [r for r in (out.get("results", []) or []) if id(r) in by_id]
        filtered_outputs.append({**out, "results": kept})
    presentation = build_presentation(task_plan, filtered_outputs, ordered_ranking)
    evidence = [e for out in tool_outputs for e in (out.get("evidence", []) or [])]
    agent_results = [r for out in filtered_outputs for r in (out.get("results", []) or [])]
    for i, r in enumerate(agent_results):
        r["why"] = why_for(r, constraints, i, len(agent_results))
    _, linked_evidence = attach_evidence(agent_results[:30], evidence[:30])
    url_to_ids: dict[str, list[str]] = {}
    for e in linked_evidence:
        key = str(e.get("source_url", "") or "").rstrip("/").lower()
        if key:
            url_to_ids.setdefault(key, []).append(e.get("id", ""))

    def _inject(node: Any) -> None:
        if isinstance(node, dict):
            url = str(node.get("url", "") or "").rstrip("/").lower()
            if url and url in url_to_ids:
                node["evidence_ids"] = url_to_ids[url]
            for v in node.values():
                _inject(v)
        elif isinstance(node, list):
            for v in node:
                _inject(v)

    _inject(presentation)
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
    return {
        "presentation": presentation,
        "agent_results": agent_results,
        "linked_evidence": linked_evidence,
        "sources": sources,
        "funnel": funnel,
        "ranking": ranking,
        "filtered_outputs": filtered_outputs,
    }


def _agent_events(
    query: str,
    complete: CompleteFn | None,
    num_results: int,
    constraints: dict[str, Any],
):
    """Shared run implementation yielding stream events, ending in answer_complete."""
    import time as _time

    started = _time.monotonic()
    resolve_llm_key()  # fail fast with a clear error when unconfigured
    plan = classify_request(query, complete=complete)
    # Runtime-provided slots (SlotPrompt answers, filters) always merge into
    # the plan: engine kwargs (flights IATA, hotel dates) resolve from these.
    # Nice-to-have prefs (budget, party size...) never block: the runner
    # proceeds and surfaces them as refinements instead.
    _OPTIONAL_SLOTS = {"budget", "travelers", "brand", "remote", "salary_min", "min_salary"}
    constraints = constraints or {}
    plan.slots = {
        **(plan.slots or {}),
        **{k: v for k, v in constraints.items() if str(v or "").strip()},
    }
    if plan.needs_clarification and plan.missing_slots:
        known = {str(k).lower() for k in plan.slots}
        plan.missing_slots = [s for s in plan.missing_slots if str(s).lower() not in known]
        blockers = [s for s in plan.missing_slots if str(s).lower() not in _OPTIONAL_SLOTS]
        steps_ok = bool(plan.steps) or any(t.steps for t in (plan.tasks or []))
        if not plan.missing_slots or (not blockers and steps_ok):
            plan.needs_clarification = False
            plan.clarifying_question = ""
            plan.missing_slots = blockers
    # Second backfill pass with merged runtime slots: flights/hotels unlock
    # once origin+destination are known (classify time often lacks them).
    _backfill_steps(plan.steps, plan.use_case, plan.presentation, plan.slots or {}, query)
    for _t in plan.tasks or []:
        _backfill_steps(_t.steps, _t.use_case, _t.presentation, plan.slots or {}, _t.query or query)
    if plan.needs_clarification and plan.clarifying_question:
        tasks = plan.tasks or []
        if tasks:
            line = (
                f"Split into {len(tasks)} tasks "
                f"({', '.join(t.label for t in tasks)}). "
                f"One question first: {plan.clarifying_question}"
            )
        else:
            line = f"One question first: {plan.clarifying_question}"
        yield {"event": "reasoning", "data": {"text": line[:240]}}
        for t in tasks:
            yield {"event": "task_started", "data": {"id": t.id, "label": t.label}}
        yield {
            "event": "answer_complete",
            "data": {
                "status": "clarify",
                "query": query,
                "model": resolve_model(),
                "classification": plan.to_dict(),
                "clarifying_question": plan.clarifying_question,
                "slots": plan.slots,
                "missing_slots": plan.missing_slots,
            },
        }
        return
    constraints = constraints or {}
    reasoning: list[str] = []
    llm_reasoning_calls = 0

    def _llm_line(prompt: str, fallback: str) -> str:
        nonlocal llm_reasoning_calls
        if llm_reasoning_calls >= MAX_REASONING_CALLS:
            return fallback
        llm_reasoning_calls += 1
        return reasoning_line(prompt, fallback)

    def _llm_block(prompt: str, fallback: str) -> str:
        nonlocal llm_reasoning_calls
        if llm_reasoning_calls >= MAX_REASONING_CALLS + 1:
            return fallback
        llm_reasoning_calls += 1
        return reasoning_line(prompt, fallback, max_tokens=1100)

    subtasks = plan.tasks if len(plan.tasks) > 1 else []
    engines = [s.engine for s in plan.steps]
    if subtasks:
        distinct = list(dict.fromkeys(s.engine for t in subtasks for s in t.steps))
        plan_fallback = (
            f"Plan: {len(subtasks)} tasks ({', '.join(t.use_case for t in subtasks)}) "
            f"via {', '.join(distinct)}."
        )
    else:
        plan_fallback = f"Plan: {plan.use_case} via {', '.join(engines) or 'broad search'}."
    line = _llm_line(f"Summarize this search plan in one short line: {plan_fallback}", plan_fallback)
    reasoning.append(line)
    yield {"event": "reasoning", "data": {"text": line}}
    # Deterministic regex analysis alongside, for trace continuity.
    legacy = classify_query(query)

    if not subtasks:
        for step in plan.steps:
            step.num_results = max(1, min(step.num_results, num_results, 10))
            yield {"event": "tool_started", "data": {"tool": step.engine, "query": step.query}}
        yield {"event": "task_started", "data": {"id": "task-1", "label": plan.use_case}}
        tool_outputs, trace = execute_plan(plan)
        trace.intent = [plan.use_case]
        trace.tools_selected = [s.engine for s in plan.steps]
        for call in trace.calls:
            yield {
                "event": "tool_completed",
                "data": {
                    "tool": call.tool,
                    "status": "error" if call.error else "ok",
                    "count": call.result_count,
                },
            }
        done = _process_task_outputs(query, plan, tool_outputs, complete, constraints)
        agent_results = done["agent_results"]
        task_line = f"Task '{plan.use_case}': {len(agent_results)} results via {', '.join(engines) or 'no tools'}."
        reasoning.append(task_line)
        yield {"event": "reasoning", "data": {"text": task_line}}
        yield {
            "event": "task_done",
            "data": {"id": "task-1", "label": plan.use_case, "count": len(agent_results)},
        }
        errors = len(trace.summary()["errors"])
        route = build_route([s.engine for s in plan.steps], trace.calls)
        ok_lines = [entry for entry in route if entry["status"] == "ok"]
        outcome_fallback = f"Done: {len(agent_results)} results, {len(done['sources'])} sources."
        outcome = _llm_line(
            f"Summarize this search outcome in one short line: {outcome_fallback}", outcome_fallback
        )
        reasoning.append(outcome)
        yield {"event": "reasoning", "data": {"text": outcome}}
        funnel = done["funnel"]
        single_section = {
            "task_id": "task-1",
            "title": plan.use_case,
            "use_case": plan.use_case,
            "presentation": done["presentation"],
            "results_count": len(agent_results),
            "sources": done["sources"],
            "route": route,
        }
        digest = build_digest_summary(query, [single_section], route, reasoning, _llm_block)
        verdict = _short_verdict(query, [single_section])
        yield {
            "event": "answer_complete",
            "data": {
                "status": "ok",
                "query": query,
                "model": resolve_model(),
                "classification": plan.to_dict(),
                "legacy_intents": legacy.intent,
                "constraints": constraints,
                "slots": plan.slots,
                "missing_slots": plan.missing_slots,
                "presentation": done["presentation"],
                "sources": done["sources"],
                "results_count": len(agent_results),
                "evidence_count": len(done["linked_evidence"]),
                "funnel": {
                    "discovered": funnel["discovered"],
                    "matched": funnel["matched"],
                    "set_aside": funnel["set_aside"],
                    "reasons": funnel["reasons"],
                    "set_aside_results": funnel["set_aside_results"],
                },
                "route": route,
                "confidence": confidence_with_reasons(len(agent_results), errors, len(ok_lines), constraints),
                "refinements": refinements_for(plan.use_case),
                "budget": {
                    "calls_used": trace.summary()["serpapi_calls"],
                    "calls_limit": 5,
                    "seconds_used": round(_time.monotonic() - started, 1),
                    "seconds_limit": 45.0,
                },
                "research_trace": trace.summary(),
                "summary": digest,
                "summary_short": verdict,
                "tasks": [
                    {
                        "id": "task-1",
                        "label": plan.use_case,
                        "use_case": plan.use_case,
                        "status": "ok" if agent_results else "empty",
                    }
                ],
                "sections": [
                    {
                        "task_id": "task-1",
                        "title": plan.use_case,
                        "use_case": plan.use_case,
                        "presentation": done["presentation"],
                        "results_count": len(agent_results),
                        "sources": done["sources"],
                        "route": route,
                    }
                ],
                "reasoning": reasoning,
            },
        }
        return

    # Multi-task path: per-task execute -> rank -> shape, then combine.
    # Per-task call share leaves room for 3-step tasks (flights+hotels+maps).
    share = max(2, 6 // len(subtasks))
    combined = RunTrace()
    combined.intent = [plan.use_case]
    combined.tools_selected = [s.engine for t in subtasks for s in t.steps]
    sections: list[dict[str, Any]] = []
    task_infos: list[dict[str, Any]] = []
    all_sources: list[dict[str, Any]] = []
    all_route: list[dict[str, Any]] = []
    merged_funnel: dict[str, Any] = {
        "discovered": 0,
        "matched": 0,
        "set_aside": 0,
        "reasons": {},
        "set_aside_results": [],
    }
    total_results = 0
    total_evidence = 0
    summaries: list[str] = []
    for sub in subtasks:
        for step in sub.steps:
            step.num_results = max(1, min(step.num_results, num_results, 10))
        yield {"event": "task_started", "data": {"id": sub.id, "label": sub.label}}
        for step in sub.steps:
            yield {"event": "tool_started", "data": {"tool": step.engine, "query": step.query}}
        task_plan = RouterPlan(
            use_case=sub.use_case, presentation=sub.presentation, steps=sub.steps, slots=plan.slots
        )
        tool_outputs, task_trace = execute_plan(task_plan, budget=BudgetLimits(max_serpapi_calls=share))
        combined.calls.extend(task_trace.calls)
        for call in task_trace.calls:
            yield {
                "event": "tool_completed",
                "data": {
                    "tool": call.tool,
                    "status": "error" if call.error else "ok",
                    "count": call.result_count,
                },
            }
        done = _process_task_outputs(sub.query, task_plan, tool_outputs, complete, constraints)
        agent_results = done["agent_results"]
        task_route = build_route([s.engine for s in sub.steps], task_trace.calls)
        all_sources.extend(done["sources"])
        all_route.extend(task_route)
        task_funnel = done["funnel"]
        merged_funnel["discovered"] += task_funnel["discovered"]
        merged_funnel["matched"] += task_funnel["matched"]
        merged_funnel["set_aside"] += task_funnel["set_aside"]
        merged_funnel["set_aside_results"].extend(task_funnel["set_aside_results"])
        if isinstance(task_funnel.get("reasons"), dict):
            for k, v in task_funnel["reasons"].items():
                merged_funnel["reasons"].setdefault(k, v)
        total_results += len(agent_results)
        total_evidence += len(done["linked_evidence"])
        if done["ranking"].get("summary"):
            summaries.append(str(done["ranking"]["summary"]))
        task_line = f"Task '{sub.label}' ({sub.use_case}): {len(agent_results)} results."
        reasoning.append(task_line)
        yield {"event": "reasoning", "data": {"text": task_line}}
        yield {"event": "task_done", "data": {"id": sub.id, "label": sub.label, "count": len(agent_results)}}
        sections.append(
            {
                "task_id": sub.id,
                "title": sub.label,
                "use_case": sub.use_case,
                "presentation": done["presentation"],
                "results_count": len(agent_results),
                "sources": done["sources"],
                "route": task_route,
            }
        )
        task_infos.append(
            {
                "id": sub.id,
                "label": sub.label,
                "use_case": sub.use_case,
                "status": "ok" if agent_results else "empty",
            }
        )
    errors = len(combined.summary()["errors"])
    ok_lines = [entry for entry in all_route if entry["status"] == "ok"]
    outcome_fallback = (
        f"Done: {total_results} results across {len(subtasks)} tasks, {len(all_sources)} sources."
    )
    outcome = _llm_line(
        f"Summarize this search outcome in one short line: {outcome_fallback}", outcome_fallback
    )
    reasoning.append(outcome)
    yield {"event": "reasoning", "data": {"text": outcome}}
    digest = build_digest_summary(query, sections, all_route, reasoning, _llm_block)
    verdict = _short_verdict(query, sections)
    yield {
        "event": "answer_complete",
        "data": {
            "status": "ok",
            "query": query,
            "model": resolve_model(),
            "classification": plan.to_dict(),
            "legacy_intents": legacy.intent,
            "constraints": constraints,
            "slots": plan.slots,
            "missing_slots": plan.missing_slots,
            "presentation": {
                "type": "multi_task",
                "sections": [s["presentation"] for s in sections],
                "summary": digest,
            },
            "sources": all_sources,
            "results_count": total_results,
            "evidence_count": total_evidence,
            "funnel": merged_funnel,
            "route": all_route,
            "confidence": confidence_with_reasons(total_results, errors, len(ok_lines), constraints),
            "refinements": refinements_for(plan.use_case),
            "budget": {
                "calls_used": combined.summary()["serpapi_calls"],
                "calls_limit": 5,
                "seconds_used": round(_time.monotonic() - started, 1),
                "seconds_limit": 45.0,
            },
            "research_trace": combined.summary(),
            "summary": digest,
            "summary_short": verdict,
            "tasks": task_infos,
            "sections": sections,
            "reasoning": reasoning,
        },
    }


def run_agent_stream(
    query: str,
    num_results: int = 8,
    filters: dict[str, Any] | None = None,
    complete: CompleteFn | None = None,
    constraints: dict[str, Any] | None = None,
):
    """Streaming run: yields reasoning/task/tool events, ends in answer_complete."""
    if constraints is None:
        constraints = filters or {}
    yield from _agent_events(query, complete=complete, num_results=num_results, constraints=constraints)


def run_agent(
    query: str,
    complete: CompleteFn | None = None,
    num_results: int = 8,
    constraints: dict[str, Any] | None = None,
    filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the autonomous 3-pass flow. Read-only; stops before any action."""
    if constraints is None:
        constraints = filters or {}
    events = list(
        _agent_events(query, complete=complete, num_results=num_results, constraints=constraints)
    )
    if not events:
        raise RuntimeError("Agent produced no events.")
    last = events[-1]
    if last.get("event") != "answer_complete":
        raise RuntimeError("Agent did not complete.")
    return last["data"]


__all__ = [
    "ENGINE_REGISTRY",
    "PRESENTATIONS",
    "MAX_REASONING_CALLS",
    "REASONING_DEFAULT_BASE_URL",
    "REASONING_DEFAULT_MODEL",
    "RouterPlan",
    "RouterStep",
    "SubTask",
    "LLMKeyMissing",
    "resolve_llm_key",
    "resolve_model",
    "resolve_reasoning_base_url",
    "resolve_reasoning_key",
    "resolve_reasoning_model",
    "reasoning_line",
    "classify_with_llm",
    "execute_plan",
    "rank_with_llm",
    "build_presentation",
    "run_agent",
    "run_agent_stream",
    "openrouter_complete",
]
