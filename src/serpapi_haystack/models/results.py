"""Normalized result models (PRD Sec 73-74).

Different SerpApi engines produce different schemas. These dataclasses
are the single internal representation used by components, ranking,
evidence, and synthesis.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


@dataclass
class SearchResult:
    """Generic web result (PRD Sec 73)."""

    title: str
    url: str
    snippet: str = ""
    source: str = ""
    result_type: str = "organic"
    timestamp: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "SearchResult":
        return cls(
            title=str(item.get("title", "") or ""),
            url=str(item.get("link", "") or item.get("url", "") or ""),
            snippet=str(item.get("snippet", "") or ""),
            source=str(item.get("source", "") or item.get("displayed_link", "") or ""),
            result_type=str(item.get("result_type", "organic")),
            timestamp=item.get("date"),
            metadata={k: v for k, v in item.items() if k not in {"title", "link", "snippet"}},
        )


@dataclass
class JobResult:
    """Normalized job posting (PRD Sec 73)."""

    title: str
    company: str = ""
    location: str = ""
    salary: str | None = None
    employment_type: str | None = None
    description: str = ""
    requirements: str = ""
    application_url: str = ""
    posted_at: str | None = None
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "JobResult":
        extensions = item.get("extensions") or []
        # extensions often like ["Full-time", "$120k", "Posted 2 days ago"]
        employment_type = None
        salary = None
        posted_at = None
        for ext in extensions:
            low = str(ext).lower()
            if any(t in low for t in ("full-time", "part-time", "contract", "intern", "temporary")):
                employment_type = str(ext)
            elif any(s in low for s in ("$", "₹", "€", "£", "/yr", "/year", "/hr", "lakh", "lpa")):
                salary = str(ext)
            elif "post" in low or "day" in low or "hour" in low or "week" in low:
                posted_at = str(ext)
        detected = item.get("detected_extensions") or {}
        salary = salary or detected.get("salary") or item.get("salary")
        return cls(
            title=str(item.get("title", "") or ""),
            company=str(item.get("company_name", "") or ""),
            location=str(item.get("location", "") or ""),
            salary=salary,
            employment_type=employment_type or item.get("employment_type"),
            description=str(item.get("description", "") or item.get("snippet", "") or ""),
            requirements=str(item.get("requirements", "") or ""),
            application_url=str(
                item.get("apply_link", "") or item.get("link", "") or item.get("share_link", "") or ""
            ),
            posted_at=posted_at or item.get("posted_at"),
            source=str(item.get("via", "") or item.get("source", "") or ""),
            metadata={k: v for k, v in item.items() if k not in {"title", "company_name"}},
        )


@dataclass
class ProductResult:
    """Normalized shopping product (PRD Sec 73)."""

    title: str
    price: str | None = None
    currency: str | None = None
    numeric_price: float | None = None
    seller: str = ""
    rating: float | None = None
    reviews: int | None = None
    url: str = ""
    image: str | None = None
    specifications: dict[str, Any] = field(default_factory=dict)
    availability: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "ProductResult":
        price_raw = item.get("price")
        extracted = item.get("extracted_price")
        rating = item.get("rating")
        reviews = item.get("reviews")
        try:
            rating_f = float(rating) if rating is not None else None
        except (TypeError, ValueError):
            rating_f = None
        try:
            reviews_i = int(reviews) if reviews is not None else None
        except (TypeError, ValueError):
            reviews_i = None
        return cls(
            title=str(item.get("title", "") or ""),
            price=str(price_raw) if price_raw is not None else None,
            currency=None,
            numeric_price=float(extracted) if extracted is not None else None,
            seller=str(item.get("source", "") or item.get("seller", "") or ""),
            rating=rating_f,
            reviews=reviews_i,
            url=str(item.get("link", "") or item.get("product_link", "") or ""),
            image=item.get("thumbnail") or item.get("image"),
            specifications={},
            availability=item.get("availability"),
            metadata={k: v for k, v in item.items() if k not in {"title"}},
        )


Confidence = Literal["high", "medium", "low"]
ClaimKind = Literal["FACT", "INFERENCE", "RECOMMENDATION", "UNCERTAINTY"]


@dataclass
class Evidence:
    """Traceable claim extracted from a tool result (PRD Sec 74)."""

    source_url: str
    source_title: str
    source_type: str  # e.g. organic, job, product
    extracted_claim: str
    confidence: Confidence = "medium"
    timestamp: str | None = None
    tool_used: str = ""
    kind: ClaimKind = "FACT"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
