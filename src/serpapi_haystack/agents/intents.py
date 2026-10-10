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
    "TRAVEL": ["google_maps", "google_search", "google_flights", "google_hotels", "google_events"],
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
_LEARN_RE = re.compile(r"\b(learn|teach|course|tutorial|roadmap|learning path|beginner|explain|explainer|explainers|guide|guides|intro|primer)\b", re.I)
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
    r"\b(python|kubernetes|docker|transformer|crispr|gene editing|rag|framework|api|programming|machine learning)\b", re.I
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


# Clause separators for multi-task decomposition: "A and also B", "A plus B",
# "A as well as B", "A; B", "A? then B", "A and B", "A then B".
_SPLIT_RE = re.compile(
    r"\s*(?:\band\s+also\b|\bas\s+well\s+as\b|\bplus\b|\bthen\b|;\s*|\?+\s*(?:then|also|and)\b|\band\b)\s*",
    re.I,
)

_GENERAL_FAMILY = ("GENERAL_RESEARCH",)

# Video-mention signal shared with the LLM router: a clause asking for
# videos means the youtube engine, even without learn-words.
_VIDEO_MENTION_RE = re.compile(r"\b(video|videos|youtube|youtu\.be|vlog|webinar|talk|course videos)\b", re.I)

# Filler stripped from clause edges before they become sub-queries.
_FILLER_HEAD_RE = re.compile(r"^(?:and|or|plus|then|also|as well as)\b[\s,;:]*", re.I)
_FILLER_TAIL_RE = re.compile(r"[\s,;:.]*(?:as well|too|also|please)\s*$", re.I)

# Stopwords excluded from anchor-topic extraction.
_TOPIC_STOP = frozenset(
    "find me the best good top get give show list all some any for of a an to and also as well too or plus then than that this those these with about on in at from into include includes including contain contains versus vs without with".split()
)


def _intent_family(query: str, include_video: bool = True) -> tuple[str, ...]:
    """Primary intent family of a clause (GENERAL_RESEARCH when nothing specific)."""
    intents = classify_query(query).intent
    specific = tuple(sorted(i for i in intents if i != "GENERAL_RESEARCH"))
    if include_video and _VIDEO_MENTION_RE.search(query or "") and "LEARNING" not in specific:
        specific = tuple(sorted(specific + ("VIDEO_LEARNING",)))
    return specific or _GENERAL_FAMILY


# Capitalized words that are platforms/formats, not topics: they never
# count as a clause's "own topic" for enrichment decisions.
_PLATFORM_WORDS = frozenset(
    "youtube youtu.be video videos vlog vlogs webinar webinars talk talks podcast podcasts "
    "google reddit amazon flipkart twitter x instagram facebook linkedin github arxiv".split()
)


def _own_topic(clause: str) -> list[str]:
    """Capitalized mid-sentence topic words of a clause (platforms excluded)."""
    words = re.findall(r"[A-Za-z][\w.-]*", clause or "")
    own: list[str] = []
    for i, w in enumerate(words):
        w = w.strip(" .,'\";:!?()")
        if len(w) <= 2 or w.lower() in _TOPIC_STOP or w.lower() in _PLATFORM_WORDS:
            continue
        if w[0].isupper() and i > 0 and w not in own:
            own.append(w)
    return own


def _anchor_topic(full_query: str, anchor_clause: str) -> list[str]:
    """Topic terms that give a fragment clause its context.

    Mid-sentence capitalized words first ("Bitcoin"), else anchor entities
    ("white paper"). At most 2 terms; sentence-start words excluded.
    """
    words = re.findall(r"[A-Za-z][\w.-]*", anchor_clause or "")
    topics: list[str] = []
    for i, w in enumerate(words):
        w = w.strip(" .,'\";:!?()")
        if len(w) <= 2 or w.lower() in _TOPIC_STOP or w.lower() in _PLATFORM_WORDS:
            continue
        if w[0].isupper() and i > 0:
            if w not in topics:
                topics.append(w)
        if len(topics) >= 2:
            break
    if not topics:
        try:
            ents = classify_query(anchor_clause or "").entities or []
        except Exception:
            ents = []
        for e in ents:
            e = str(e).strip(" .,'\"").strip()
            if len(e) > 2 and e.lower() not in _TOPIC_STOP and e.lower() not in (t.lower() for t in topics):
                topics.append(e)
            if len(topics) >= 2:
                break
    return topics[:2]


def _contextualize(clause: str, topics: list[str]) -> str:
    """Make a fragment clause self-contained: strip filler, inject topic."""
    c = _FILLER_HEAD_RE.sub("", (clause or "").strip(" ?;."))
    c = _FILLER_TAIL_RE.sub("", c).strip()
    missing = [t for t in (topics or []) if t.lower() not in c.lower()]
    if missing and c:
        c = f"{' '.join(missing)}: {c}"
    return (c or clause or "").strip()[:300]


_TASK_KIND = {
    "ACADEMIC_RESEARCH": "Papers",
    "TECHNICAL_RESEARCH": "Research",
    "PATENT_RESEARCH": "Patents",
    "VIDEO_LEARNING": "YouTube videos",
    "LEARNING": "Learning",
    "TRAVEL": "Trip plan",
    "PLANNING": "Trip plan",
    "SHOPPING": "Products",
    "PRODUCT_COMPARISON": "Compare",
    "PRICE_COMPARISON": "Prices",
    "DECISION_SUPPORT": "Decision",
    "JOB_SEARCH": "Jobs",
    "FINANCE": "Markets",
    "NEWS": "News",
    "LOCAL_DISCOVERY": "Places",
    "EVENTS": "Events",
}


def _task_label(query: str, index: int, topic: str = "") -> str:
    if _VIDEO_MENTION_RE.search(query or ""):
        kind = "YouTube videos"
    else:
        fam = _intent_family(query)
        primary = fam[0] if fam != _GENERAL_FAMILY else "GENERAL_RESEARCH"
        kind = _TASK_KIND.get(primary)
        if kind is None:
            words = re.findall(r"[A-Za-z][\w.-]*", query)
            kind = " ".join(words[:4])[:40] or f"task {index + 1}"
    label = f"{kind} · {topic}" if topic else kind
    return label[:40]


def split_tasks_regex(query: str) -> list[dict[str, str]]:
    """Split a multi-intent query into at most 3 sub-task dicts.

    Splits on "and also"/"and"/"plus"/"as well as"/";"/"? then|also" and
    keeps the split only when 2+ distinct intent families are detected
    (each clause classified via :func:`classify_query`; a clause is kept
    when it yields a non-GENERAL intent or differs from its siblings).
    Falls back to a single task holding the whole query.
    """
    q = (query or "").strip()
    single = [{"id": "task-1", "label": _task_label(q, 0) if q else "task 1", "query": q}]
    if not q:
        return single
    clauses = [c.strip(" ?;.") for c in _SPLIT_RE.split(q)]
    clauses = [c for c in clauses if c]
    if len(clauses) < 2:
        return single
    families = [_intent_family(c) for c in clauses]
    if len(set(families)) < 2:
        return single
    kept = [
        (i, c)
        for i, (c, fam) in enumerate(zip(clauses, families))
        if fam != _GENERAL_FAMILY or any(fam != other for j, other in enumerate(families) if j != i)
    ]
    if len(kept) < 2:
        return single
    # Context-first: the first specific clause holds the topic ("Bitcoin").
    # Fragment clauses (GENERAL family) get it injected so every sub-query
    # is self-contained: "Bitcoin: some good explainer YouTube videos".
    anchor_idx = next(
        (i for i, (_, c) in enumerate(kept) if _intent_family(c, include_video=False) != _GENERAL_FAMILY),
        0,
    )
    anchor_clause = kept[anchor_idx][1]
    topics = _anchor_topic(q, anchor_clause)
    out = []
    for n, (_, c) in enumerate(kept[:3]):
        # Context-first enrichment: a clause with no topic of its own
        # (fragment, or video ask riding on the anchor's topic) inherits the
        # anchor's terms. Complete clauses (own topic like Goa) stay intact.
        if n != anchor_idx and not _own_topic(c) and topics:
            qc = _contextualize(c, topics)
        else:
            qc = _FILLER_TAIL_RE.sub("", _FILLER_HEAD_RE.sub("", c)).strip()[:300] or c
        label_topic = next((t for t in topics if t.lower() in qc.lower()), "")
        out.append({"id": f"task-{n + 1}", "label": _task_label(qc, n, label_topic), "query": qc})
    return out
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
        "google_trends", "google_events", "youtube",
    ]
    pool = available or default_available
    return [t for t in analysis.tools if t in pool] or ["google_search"]
