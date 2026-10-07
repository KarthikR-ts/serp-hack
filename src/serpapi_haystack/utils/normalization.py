"""Deduplication + ranking (PRD Sec 75-76).

Ranking (PRD Sec 75)::

    score = 0.40 * relevance + 0.20 * constraint_match
          + 0.15 * freshness + 0.15 * source_quality + 0.10 * confidence

Weights configurable per vertical.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from urllib.parse import parse_qsl, urlparse, urlunparse


def canonicalize_url(url: str) -> str:
    """Normalize URL for dedup: lowercase host, strip tracking params/fragments."""
    if not url:
        return ""
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return url.strip().lower()
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    tracking = {
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "gclid", "fbclid", "msclkid", "ref", "referrer",
    }
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k not in tracking]
    path = parsed.path.rstrip("/") or "/"
    return urlunparse((parsed.scheme.lower() or "https", host, path, "", "&".join(f"{k}={v}" for k, v in sorted(query)), ""))


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").lower().strip(), (b or "").lower().strip()).ratio()


def deduplicate(results: list[dict], url_key: str = "url", title_key: str = "title", threshold: float = 0.92) -> list[dict]:
    """Remove duplicates via URL canonicalization + title similarity (PRD Sec 76)."""
    seen_urls: set[str] = set()
    kept_titles: list[str] = []
    out: list[dict] = []
    for item in results:
        url = canonicalize_url(str(item.get(url_key, "") or ""))
        title = str(item.get(title_key, "") or "")
        if url and url in seen_urls:
            continue
        if title and any(title_similarity(title, t) >= threshold for t in kept_titles):
            continue
        if url:
            seen_urls.add(url)
        if title:
            kept_titles.append(title)
        out.append(item)
    return out


@dataclass
class RankingWeights:
    relevance: float = 0.40
    constraint_match: float = 0.20
    freshness: float = 0.15
    source_quality: float = 0.15
    confidence: float = 0.10


VERTICAL_WEIGHTS: dict[str, RankingWeights] = {
    "search": RankingWeights(),
    "jobs": RankingWeights(relevance=0.35, constraint_match=0.30, freshness=0.15, source_quality=0.10, confidence=0.10),
    "shopping": RankingWeights(relevance=0.35, constraint_match=0.30, freshness=0.05, source_quality=0.15, confidence=0.15),
}

_TRUSTED_DOMAINS = (
    "github.com", "docs.python.org", "stackoverflow.com", "arxiv.org",
    "edu", "gov", "nature.com", "ieee.org", "acm.org",
)


def source_quality_score(source: str, url: str) -> float:
    text = f"{source} {url}".lower()
    if any(d in text for d in _TRUSTED_DOMAINS):
        return 1.0
    if any(d in text for d in (".edu", ".gov", "official")):
        return 0.9
    if not text.strip():
        return 0.3
    return 0.6


def rank_results(
    results: list[dict],
    weights: RankingWeights | None = None,
    constraint_fn=None,
    freshness_fn=None,
) -> list[dict]:
    """Attach ``score`` to each result dict. Stable, deterministic."""
    w = weights or RankingWeights()
    ranked = []
    for idx, item in enumerate(results):
        # Relevance: earlier SerpApi position = higher prior; decay gently.
        relevance = max(0.0, 1.0 - (idx * 0.05))
        constraint_match = float(constraint_fn(item)) if constraint_fn else 0.5
        freshness = float(freshness_fn(item)) if freshness_fn else 0.5
        quality = source_quality_score(str(item.get("source", "")), str(item.get("url", "")))
        confidence = 0.7
        score = (
            w.relevance * relevance
            + w.constraint_match * constraint_match
            + w.freshness * freshness
            + w.source_quality * quality
            + w.confidence * confidence
        )
        ranked.append({**item, "score": round(score, 4)})
    ranked.sort(key=lambda d: d["score"], reverse=True)
    return ranked


def normalize_price_to_number(price: str | None) -> float | None:
    if not price:
        return None
    cleaned = re.sub(r"[^\d.]", "", str(price))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None
