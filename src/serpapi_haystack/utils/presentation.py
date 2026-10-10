"""Presentation helpers: turn tool outputs into UI-ready structures.

Covers the design doc's contract needs: route lines with per-vertical
status, funnel counts with set-aside reasons, per-result why-rankings,
confidence with reasons, completeness lines, evidence ids linked to
results, refinement chips, and operator usage counters.
"""

from __future__ import annotations

import re
import time
from collections import Counter
from typing import Any
from urllib.parse import urlparse

# User-facing names (never engine ids) + family for route colors.
USER_NAMES: dict[str, str] = {
    "google_search": "Web",
    "google_news": "News",
    "google_shopping": "Products",
    "google_jobs": "Job listings",
    "google_scholar": "Papers",
    "google_patents": "Patents",
    "google_forums": "Discussions",
    "google_images": "Images",
    "google_maps": "Places",
    "google_flights": "Flights",
    "google_hotels": "Hotels",
    "google_finance": "Markets",
    "google_trends": "Search interest",
    "google_events": "Events",
    "youtube": "Videos",
}

FAMILY: dict[str, str] = {
    "google_search": "web",
    "google_news": "live",
    "google_shopping": "commerce",
    "google_jobs": "career",
    "google_scholar": "research",
    "google_patents": "research",
    "google_forums": "web",
    "google_images": "web",
    "google_maps": "place",
    "google_flights": "place",
    "google_hotels": "place",
    "google_finance": "live",
    "google_trends": "live",
    "google_events": "place",
    "youtube": "web",
}


def domain_of(url: str) -> str:
    try:
        host = urlparse(str(url or "")).netloc.lower()
    except Exception:
        return ""
    return host[4:] if host.startswith("www.") else host


def build_route(tool_names: list[str], calls: list) -> list[dict[str, Any]]:
    """One line per vertical actually used, with ok/empty/failed status."""
    by_tool = {c.tool: c for c in calls}
    lines = []
    for i, name in enumerate(tool_names):
        rec = by_tool.get(name)
        if rec is None:
            status = "skipped"
            count, latency, query, error = 0, 0.0, "", None
        elif rec.error:
            status = "failed"
            count, latency, query, error = 0, rec.latency_ms, rec.query, rec.error
        elif rec.result_count == 0:
            status = "empty"
            count, latency, query, error = 0, rec.latency_ms, rec.query, None
        else:
            status = "ok"
            count, latency, query, error = rec.result_count, rec.latency_ms, rec.query, None
        lines.append(
            {
                "id": f"line-{i}-{name}",
                "vertical": name,
                "name": USER_NAMES.get(name, name),
                "family": FAMILY.get(name, "web"),
                "status": status,
                "result_count": count,
                "latency_ms": round(latency, 1),
                "query": (query or "")[:120],
                "error": (error or "")[:200] if error else None,
            }
        )
    return lines


_NUMBER_RE = re.compile(r"[\d,]+(?:\.\d+)?")


def parse_amount(text: Any) -> float | None:
    """Parse the first number out of a price/salary string. No conversion."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    m = _NUMBER_RE.search(str(text).replace("₹", " ").replace(",", ""))
    if not m:
        return None
    try:
        value = float(m.group(0))
    except ValueError:  # malformed number, treat as unknown
        return None
    low = str(text).lower()
    if value < 1000 and ("lakh" in low or "lac" in low):
        value *= 100000
    if "k" in low and value < 1000 and re.search(r"\d\s*k\b", low):
        value *= 1000
    return value


def match_constraints(result: dict[str, Any], constraints: dict[str, Any]) -> str | None:
    """Return a set-aside reason, or None when the result matches."""
    if not constraints:
        return None
    budget = constraints.get("budget")
    if budget is not None:
        price = result.get("numeric_price")
        if price is None:
            price = parse_amount(result.get("price"))
        try:
            if price is not None and float(price) > float(budget):
                return "Over budget"
        except (TypeError, ValueError):
            pass
    min_rating = constraints.get("min_rating") or constraints.get("rating")
    if min_rating is not None and result.get("rating") is not None:
        try:
            if float(result["rating"]) < float(min_rating):
                return "Below rating"
        except (TypeError, ValueError):
            pass
    loc = str(constraints.get("location") or "").strip().lower()
    if loc and any(k in result for k in ("company", "application_url")):
        hay = f"{result.get('location', '')} {result.get('title', '')}".lower()
        if hay.strip() and loc not in hay and "remote" not in hay:
            return "Outside location"
    salary_min = constraints.get("salary_min") or constraints.get("min_salary")
    if salary_min is not None and ("company" in result or "application_url" in result):
        salary = parse_amount(result.get("salary"))
        if salary is None:
            return "Pay not listed"
        try:
            if salary < float(salary_min):
                return "Below pay"
        except (TypeError, ValueError):
            pass
    remote = str(constraints.get("remote") or "").strip().lower()
    if remote in ("remote", "onsite"):
        hay = f"{result.get('location', '')} {result.get('title', '')} {result.get('employment_type', '')}".lower()
        if remote == "remote" and "remote" not in hay:
            return "Not remote"
        if remote == "onsite" and "remote" in hay:
            return "Remote excluded"
    return None


def apply_funnel(results: list[dict[str, Any]], constraints: dict[str, Any]) -> dict[str, Any]:
    matched: list[dict[str, Any]] = []
    set_aside: list[dict[str, Any]] = []
    for r in results:
        reason = match_constraints(r, constraints or {})
        if reason is None:
            matched.append(r)
        else:
            set_aside.append({**r, "set_aside_reason": reason})
    reasons: dict[str, int] = {}
    for item in set_aside:
        reasons[item["set_aside_reason"]] = reasons.get(item["set_aside_reason"], 0) + 1
    return {
        "discovered": len(results),
        "matched": len(matched),
        "set_aside": len(set_aside),
        "reasons": [{"label": k, "count": v} for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])],
        "matched_results": matched,
        "set_aside_results": set_aside[:20],
    }


def why_for(result: dict[str, Any], constraints: dict[str, Any], rank: int, total: int) -> list[dict[str, Any]]:
    """Ranking explanation in user terms (never bare numbers)."""
    why: list[dict[str, Any]] = []
    budget = (constraints or {}).get("budget")
    price = result.get("numeric_price")
    if price is None:
        price = parse_amount(result.get("price"))
    if budget is not None and price is not None:
        try:
            met = float(price) <= float(budget)
            why.append(
                {
                    "criterion": "constraint_match",
                    "met": met,
                    "text": f"{'Within' if met else 'Over'} budget ({result.get('price', price)})",
                }
            )
        except (TypeError, ValueError):
            pass
    if result.get("rating") is not None:
        why.append(
            {
                "criterion": "source_quality",
                "met": float(result["rating"]) >= 4.0,
                "text": f"Rated {result['rating']}" + (f" by {result['reviews']} reviewers" if result.get("reviews") else ""),
            }
        )
    if result.get("date") or result.get("published_date") or result.get("posted_at"):
        why.append({"criterion": "freshness", "met": True, "text": "Recent listing"})
    if result.get("company") or result.get("seller") or result.get("source"):
        why.append(
            {
                "criterion": "source_quality",
                "met": True,
                "text": f"From {result.get('company') or result.get('seller') or result.get('source')}",
            }
        )
    why.append(
        {
            "criterion": "relevance",
            "met": rank < max(1, total // 3),
            "text": f"Ranked {rank + 1} of {total} for query match",
        }
    )
    return why


def confidence_with_reasons(total: int, errors: int, engine_count: int, constraints: dict) -> dict[str, Any]:
    reasons: list[str] = []
    if engine_count >= 3 and errors == 0:
        reasons.append(f"{engine_count} independent sources agree")
    elif engine_count >= 2:
        reasons.append(f"{engine_count} sources consulted")
    else:
        reasons.append("Limited source coverage")
    if total >= 8:
        reasons.append(f"{total} results to compare")
    elif total == 0:
        reasons.append("No results found")
    if constraints:
        reasons.append("Your constraints were applied")
    if errors:
        reasons.append(f"{errors} source{'s' if errors > 1 else ''} didn't load")
    if total >= 8 and errors == 0:
        level = "high"
    elif total >= 3:
        level = "medium"
    else:
        level = "low"
    return {"level": level, "reasons": reasons}


def completeness(planned: int, succeeded: int, failed: int, limit_hit: bool = False) -> dict[str, Any]:
    if failed == 0 and succeeded == planned:
        state, message = "complete", f"Used {planned} {'source' if planned == 1 else 'sources'}."
    elif succeeded == 0:
        state, message = "failed", "Search isn't responding. Nothing was searched."
    elif limit_hit:
        state, message = "limit_reached", "Stopped at the search limit. Here's what was found."
    else:
        state, message = "partial", f"Used {succeeded} of {planned} sources. {failed} didn't load."
    return {"state": state, "planned_lines": planned, "succeeded_lines": succeeded, "message": message}


def attach_evidence(results: list[dict[str, Any]], evidence: list[dict[str, Any]]) -> tuple[list, list]:
    """Give evidence stable ids and link each result to its evidence."""
    by_url: dict[str, list[str]] = {}
    out_evidence = []
    for i, e in enumerate(evidence):
        eid = f"e{i + 1}"
        e = {**e, "id": eid, "domain": domain_of(e.get("source_url", ""))}
        out_evidence.append(e)
        url = (e.get("source_url") or "").rstrip("/").lower()
        if url:
            by_url.setdefault(url, []).append(eid)
    out_results = []
    for r in results:
        ids: list[str] = []
        for key in ("url", "application_url", "link"):
            url = str(r.get(key, "") or "").rstrip("/").lower()
            if url and url in by_url:
                ids.extend(x for x in by_url[url] if x not in ids)
        out_results.append({**r, "evidence_ids": ids})
    return out_results, out_evidence


REFINEMENTS: dict[str, list[dict[str, Any]]] = {
    "shopping": [
        {"id": "cheaper", "label": "Cheaper options", "estimated_calls": 2},
        {"id": "recent_reviews", "label": "Only recent reviews", "estimated_calls": 2},
        {"id": "brands", "label": "Other brands", "estimated_calls": 2},
        {"id": "wider", "label": "Search wider", "estimated_calls": 4},
    ],
    "jobs": [
        {"id": "remote", "label": "Include remote", "estimated_calls": 2},
        {"id": "recent", "label": "Posted this week", "estimated_calls": 2},
        {"id": "pay", "label": "Higher pay", "estimated_calls": 2},
        {"id": "cities", "label": "Other cities", "estimated_calls": 2},
    ],
    "research": [
        {"id": "recent", "label": "Only recent sources", "estimated_calls": 2},
        {"id": "academic", "label": "Academic sources", "estimated_calls": 2},
        {"id": "counter", "label": "Counter-arguments", "estimated_calls": 3},
        {"id": "wider", "label": "Search wider", "estimated_calls": 4},
    ],
    "learning": [
        {"id": "beginner", "label": "Beginner-friendly", "estimated_calls": 2},
        {"id": "projects", "label": "More projects", "estimated_calls": 2},
        {"id": "papers", "label": "Add papers", "estimated_calls": 2},
    ],
    "any": [
        {"id": "followup", "label": "Ask a follow-up", "estimated_calls": 0},
        {"id": "deep", "label": "Deep research", "estimated_calls": 12},
    ],
}


def refinements_for(use_case: str) -> list[dict[str, Any]]:
    key = (use_case or "").lower()
    base = list(REFINEMENTS.get(key, REFINEMENTS["research"]))
    base.append({"id": "deep", "label": "Deep research", "estimated_calls": 12})
    return base[:5]


# --- operator usage (in-memory; resets on restart) ---------------------------
_USAGE: dict[str, Any] = {
    "started_at": time.time(),
    "queries": 0,
    "serpapi_calls": 0,
    "failed_calls": 0,
    "tools": Counter(),
}


def record_usage(queries: int = 0, calls: int = 0, failed: int = 0, tools: list[str] | None = None) -> None:
    _USAGE["queries"] += queries
    _USAGE["serpapi_calls"] += calls
    _USAGE["failed_calls"] += failed
    for t in tools or []:
        _USAGE["tools"][t] += 1


def usage_snapshot() -> dict[str, Any]:
    queries = max(1, _USAGE["queries"])
    return {
        "uptime_seconds": round(time.time() - _USAGE["started_at"], 1),
        "queries": _USAGE["queries"],
        "serpapi_calls": _USAGE["serpapi_calls"],
        "calls_per_query": round(_USAGE["serpapi_calls"] / queries, 2),
        "failed_calls": _USAGE["failed_calls"],
        "calls_by_tool": dict(sorted(_USAGE["tools"].items(), key=lambda kv: -kv[1])),
    }


__all__ = [
    "USER_NAMES",
    "FAMILY",
    "domain_of",
    "build_route",
    "parse_amount",
    "match_constraints",
    "apply_funnel",
    "why_for",
    "confidence_with_reasons",
    "completeness",
    "attach_evidence",
    "refinements_for",
    "record_usage",
    "usage_snapshot",
]
