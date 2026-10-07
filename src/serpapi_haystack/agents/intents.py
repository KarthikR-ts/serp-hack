"""Intent taxonomy + rule-based query classifier (PRD Sec 19-20).

Every query is converted into a structured representation::

    {"intent": [...], "entities": [...], "constraints": {...},
     "freshness": ..., "requires_live_data": ...}

Multiple intents allowed (PRD Sec 20).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

INTENTS = [
    "GENERAL_RESEARCH",
    "ACADEMIC_RESEARCH",
    "LEARNING",
    "SHOPPING",
    "JOB_SEARCH",
    "COMPANY_RESEARCH",
    "NEWS",
    "FINANCE",
    "TRAVEL",
    "LOCAL_DISCOVERY",
    "EVENTS",
    "PRODUCT_COMPARISON",
    "PRICE_COMPARISON",
    "TREND_ANALYSIS",
    "PATENT_RESEARCH",
    "TECHNICAL_RESEARCH",
    "IMAGE_DISCOVERY",
    "VERIFICATION",
    "PLANNING",
    "DECISION_SUPPORT",
]

# intent -> preferred Phase 0-3 tools (PRD Sec 27: dynamic tool selection).
INTENT_TOOLS: dict[str, list[str]] = {
    "GENERAL_RESEARCH": ["google_search"],
    "TECHNICAL_RESEARCH": ["google_search"],
    "ACADEMIC_RESEARCH": ["google_search"],  # + scholar in Phase 4
    "LEARNING": ["google_search"],
    "SHOPPING": ["google_shopping", "google_search"],
    "PRODUCT_COMPARISON": ["google_shopping", "google_search"],
    "PRICE_COMPARISON": ["google_shopping", "google_search"],
    "DECISION_SUPPORT": ["google_shopping", "google_search"],
    "JOB_SEARCH": ["google_jobs", "google_search"],
    "COMPANY_RESEARCH": ["google_search"],
    "NEWS": ["google_search"],  # + news in Phase 4
    "VERIFICATION": ["google_search"],
    "PLANNING": ["google_search"],
    "TRAVEL": ["google_search"],  # + flights/hotels in Phase 5
    "FINANCE": ["google_search"],  # + finance in Phase 5
    "LOCAL_DISCOVERY": ["google_search"],
    "EVENTS": ["google_search"],
    "TREND_ANALYSIS": ["google_search"],
    "PATENT_RESEARCH": ["google_search"],
    "IMAGE_DISCOVERY": ["google_search"],
}


@dataclass
class QueryAnalysis:
    intent: list[str]
    entities: list[str] = field(default_factory=list)
    constraints: dict = field(default_factory=dict)
    freshness: str = "any"
    requires_live_data: bool = True
    tools: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


_JOB_RE = re.compile(r"\b(job|jobs|internship|internships|hiring|career|opening|vacancy|apply)\b", re.I)
_SHOP_RE = re.compile(
    r"\b(buy|price|under|budget|cheap|deal|laptop|phone|monitor|headphone|keyboard|camera|product|shopping|best .*(laptop|phone|monitor|keyboard|mouse|tv|camera))\b",
    re.I,
)
_BUDGET_RE = re.compile(r"(?:under|below|budget|max)\s*[₹$€£]?\s*([\d,]+)", re.I)
_COMPARE_RE = re.compile(r"\b(compare|comparison|vs\.?|versus|better|best|which (one|is))\b", re.I)
_LEARN_RE = re.compile(r"\b(learn|teach|course|tutorial|roadmap|learning path|beginner|explain)\b", re.I)
_TECH_RE = re.compile(
    r"\b(python|kubernetes|docker|transformer|diffusion|rag|framework|api|programming|machine learning)\b", re.I
)
_TRAVEL_RE = re.compile(r"\b(flight|hotel|trip|travel|visit|itinerary|plan.*trip)\b", re.I)
_FINANCE_RE = re.compile(r"\b(stock|market|finance|company.*(strategy|revenue)|compare.*companies)\b", re.I)


def classify_query(query: str) -> QueryAnalysis:
    """Deterministic rule-based classifier (MVP; LLM classifier lands in Phase 6)."""
    q = query or ""
    intents: list[str] = []
    constraints: dict = {}
    freshness = "any"
    entities: list[str] = []

    if _JOB_RE.search(q):
        intents.append("JOB_SEARCH")
    if _SHOP_RE.search(q) or "₹" in q or re.search(r"\$\d", q):
        intents.append("SHOPPING")
        m = _BUDGET_RE.search(q)
        if m:
            try:
                constraints["budget"] = float(m.group(1).replace(",", ""))
            except ValueError:
                pass
            if "₹" in q:
                constraints["currency"] = "INR"
            elif "$" in q:
                constraints["currency"] = "USD"
    if _COMPARE_RE.search(q):
        intents.append("PRODUCT_COMPARISON" if "SHOPPING" in intents else "GENERAL_RESEARCH")
        if "SHOPPING" in intents and "PRODUCT_COMPARISON" not in intents:
            intents.append("PRODUCT_COMPARISON")
    if _LEARN_RE.search(q):
        intents.append("LEARNING")
    if _TECH_RE.search(q):
        intents.append("TECHNICAL_RESEARCH")
    if _TRAVEL_RE.search(q):
        intents.append("TRAVEL")
    if _FINANCE_RE.search(q):
        intents.append("FINANCE")
    if re.search(r"\b(should i|worth (buying|learning|it)|which .* better)\b", q, re.I):
        intents.append("DECISION_SUPPORT")
    if not intents:
        intents = ["GENERAL_RESEARCH"]

    # freshness heuristics
    if re.search(r"\b(recent|latest|today|current|2024|2025|2026)\b", q, re.I):
        freshness = "current"

    # entities: naive keyword extraction (content words >= 4 chars, minus stopwords)
    stop = {
        "find", "give", "with", "from", "that", "this", "what", "which", "about",
        "under", "best", "good", "compare", "research", "learn", "teach",
    }
    for tok in re.findall(r"[A-Za-z₹$][\w$₹.-]*", q):
        low = tok.lower()
        if len(low) >= 4 and low not in stop and low not in entities:
            entities.append(low)
        if len(entities) >= 8:
            break

    tools: list[str] = []
    for intent in intents:
        for t in INTENT_TOOLS.get(intent, ["google_search"]):
            if t not in tools:
                tools.append(t)

    return QueryAnalysis(
        intent=intents,
        entities=entities,
        constraints=constraints,
        freshness=freshness,
        requires_live_data=True,
        tools=tools,
    )


def select_tools(analysis: QueryAnalysis, available: list[str] | None = None) -> list[str]:
    """Dynamic tool selection (PRD Sec 27): expose only relevant tools."""
    pool = available or ["google_search", "google_jobs", "google_shopping"]
    return [t for t in analysis.tools if t in pool] or ["google_search"]
