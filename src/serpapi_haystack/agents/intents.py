"""Intent taxonomy + hybrid rule/LLM query classifier (PRD Sec 19-20, Phase 4-6).

Every query is converted into a structured representation::

    {"intent": [...], "entities": [...], "constraints": {...},
     "freshness": ..., "requires_live_data": ...}
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

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
    "FORUM_DISCOVERY",
    "VERIFICATION",
    "PLANNING",
    "DECISION_SUPPORT",
]

# Mapping intent -> preferred SerpApi capabilities across Phase 4 & 5 tools.
INTENT_TOOLS: dict[str, list[str]] = {
    "GENERAL_RESEARCH": ["google_search"],
    "TECHNICAL_RESEARCH": ["google_search", "google_scholar"],
    "ACADEMIC_RESEARCH": ["google_scholar", "google_search"],
    "PATENT_RESEARCH": ["google_patents", "google_search"],
    "NEWS": ["google_news", "google_search"],
    "FORUM_DISCOVERY": ["google_forums", "google_search"],
    "IMAGE_DISCOVERY": ["google_images", "google_search"],
    "LEARNING": ["google_scholar", "google_search"],
    "SHOPPING": ["google_shopping", "google_search", "google_images"],
    "PRODUCT_COMPARISON": ["google_shopping", "google_search", "google_forums"],
    "PRICE_COMPARISON": ["google_shopping", "google_search"],
    "DECISION_SUPPORT": ["google_shopping", "google_search", "google_forums"],
    "JOB_SEARCH": ["google_jobs", "google_search"],
    "COMPANY_RESEARCH": ["google_search", "google_news", "google_finance"],
    "FINANCE": ["google_finance", "google_trends", "google_news", "google_search"],
    "TRAVEL": ["google_flights", "google_hotels", "google_maps", "google_events", "google_search"],
    "LOCAL_DISCOVERY": ["google_maps", "google_events", "google_search"],
    "EVENTS": ["google_events", "google_search"],
    "TREND_ANALYSIS": ["google_trends", "google_search", "google_news"],
    "VERIFICATION": ["google_search", "google_news"],
    "PLANNING": ["google_search", "google_maps", "google_flights"],
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
_SCHOLAR_RE = re.compile(r"\b(paper|papers|arxiv|journal|citation|citations|doi|literature|academic|researcher|study)\b", re.I)
_PATENT_RE = re.compile(r"\b(patent|patents|prior art|invention|claims|assignee|uspto)\b", re.I)
_NEWS_RE = re.compile(r"\b(news|headline|headlines|breaking|latest news|announcement|press release)\b", re.I)
_FORUM_RE = re.compile(r"\b(reddit|quora|stackoverflow|forum|discussion|opinion|experience|review)\b", re.I)
_IMAGE_RE = re.compile(r"\b(image|images|picture|photo|diagram|screenshot|visual)\b", re.I)
_MAP_RE = re.compile(r"\b(near me|restaurant|restaurants|place|places|address|location|maps|directions)\b", re.I)
_FLIGHT_RE = re.compile(r"\b(flight|flights|airline|fly|nonstop|outbound|return date|jfk|lax|sfo|blr)\b", re.I)
_HOTEL_RE = re.compile(r"\b(hotel|hotels|resort|motel|stay|accommodation|booking|airbnb|check-in)\b", re.I)
_FINANCE_RE = re.compile(r"\b(stock|stocks|ticker|finance|market|shares|nasdaq|nyse|price change|market cap)\b", re.I)
_TREND_RE = re.compile(r"\b(trend|trends|trending|popularity|interest over time|rising query)\b", re.I)
_EVENT_RE = re.compile(r"\b(event|events|concert|conference|meetup|festival|ticket|tickets|venue)\b", re.I)
_TECH_RE = re.compile(
    r"\b(python|kubernetes|docker|transformer|diffusion|rag|framework|api|programming|machine learning)\b", re.I
)


def classify_query(query: str) -> QueryAnalysis:
    """Deterministic rule-based query classifier across all 14 SerpApi verticals."""
    q = query or ""
    intents: list[str] = []
    constraints: dict = {}
    freshness = "any"
    entities: list[str] = []

    if _JOB_RE.search(q):
        intents.append("JOB_SEARCH")
    if _SCHOLAR_RE.search(q):
        intents.append("ACADEMIC_RESEARCH")
    if _PATENT_RE.search(q):
        intents.append("PATENT_RESEARCH")
    if _NEWS_RE.search(q):
        intents.append("NEWS")
    if _FORUM_RE.search(q):
        intents.append("FORUM_DISCOVERY")
    if _IMAGE_RE.search(q):
        intents.append("IMAGE_DISCOVERY")
    if _MAP_RE.search(q):
        intents.append("LOCAL_DISCOVERY")
    if _FLIGHT_RE.search(q) or _HOTEL_RE.search(q) or re.search(r"\b(trip|travel|visit|vacation)\b", q, re.I):
        intents.append("TRAVEL")
    if _FINANCE_RE.search(q):
        intents.append("FINANCE")
    if _TREND_RE.search(q):
        intents.append("TREND_ANALYSIS")
    if _EVENT_RE.search(q):
        intents.append("EVENTS")
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
    if _LEARN_RE.search(q):
        intents.append("LEARNING")
    if _TECH_RE.search(q) and "ACADEMIC_RESEARCH" not in intents:
        intents.append("TECHNICAL_RESEARCH")
    if re.search(r"\b(should i|worth (buying|learning|it)|which .* better)\b", q, re.I):
        intents.append("DECISION_SUPPORT")

    if not intents:
        intents = ["GENERAL_RESEARCH"]

    if re.search(r"\b(recent|latest|today|current|2024|2025|2026)\b", q, re.I):
        freshness = "current"

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


def classify_query_llm(query: str, generator: Any = None) -> QueryAnalysis:
    """LLM-assisted intent classification (Phase 6 hybrid fallback)."""
    base_analysis = classify_query(query)
    if generator is None:
        return base_analysis
    # If generator provided, prompt generator for refined intent list
    try:
        prompt = (
            f"Analyze the user query: '{query}'\n"
            f"Allowed intents: {', '.join(INTENTS)}\n"
            "Respond with a comma-separated list of matched intents."
        )
        res = generator.run(prompt)
        text = res.get("replies", [""])[0] if isinstance(res, dict) else str(res)
        found = [i.strip() for i in text.split(",") if i.strip() in INTENTS]
        if found:
            base_analysis.intent = list(dict.fromkeys(base_analysis.intent + found))
            for intent in base_analysis.intent:
                for t in INTENT_TOOLS.get(intent, []):
                    if t not in base_analysis.tools:
                        base_analysis.tools.append(t)
    except Exception:
        pass
    return base_analysis


def select_tools(analysis: QueryAnalysis, available: list[str] | None = None) -> list[str]:
    """Dynamic tool selection: expose only tools requested by query analysis."""
    default_available = [
        "google_search", "google_jobs", "google_shopping", "google_news",
        "google_scholar", "google_patents", "google_forums", "google_images",
        "google_maps", "google_flights", "google_hotels", "google_finance",
        "google_trends", "google_events",
    ]
    pool = available or default_available
    return [t for t in analysis.tools if t in pool] or ["google_search"]
