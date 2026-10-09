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
    source_type: str  # e.g. organic, job, product, news, scholar, etc.
    extracted_claim: str
    confidence: Confidence = "medium"
    timestamp: str | None = None
    tool_used: str = ""
    kind: ClaimKind = "FACT"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- Phase 4 Models ---

@dataclass
class NewsResult:
    """Normalized Google News result."""

    title: str
    url: str
    snippet: str = ""
    source: str = ""
    date: str | None = None
    thumbnail: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "NewsResult":
        return cls(
            title=str(item.get("title", "") or ""),
            url=str(item.get("link", "") or item.get("url", "") or ""),
            snippet=str(item.get("snippet", "") or ""),
            source=str(item.get("source", "") or (item.get("source", {}) if isinstance(item.get("source"), str) else item.get("source", {}).get("name", "")) or ""),
            date=item.get("date"),
            thumbnail=item.get("thumbnail"),
            metadata={k: v for k, v in item.items() if k not in {"title", "link", "snippet"}},
        )


@dataclass
class ScholarResult:
    """Normalized Google Scholar paper/research result."""

    title: str
    url: str = ""
    snippet: str = ""
    authors: str = ""
    publication: str = ""
    citations: int | None = None
    year: str | None = None
    pdf_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "ScholarResult":
        publication_info = item.get("publication_info") or {}
        summary = publication_info.get("summary", "")
        inline_links = item.get("inline_links") or {}
        cited_by = inline_links.get("cited_by") or {}
        resources = item.get("resources") or []
        pdf = None
        for r in resources:
            if isinstance(r, dict) and r.get("file_format") == "PDF":
                pdf = r.get("link")
                break

        return cls(
            title=str(item.get("title", "") or ""),
            url=str(item.get("link", "") or item.get("result_id", "") or ""),
            snippet=str(item.get("snippet", "") or ""),
            authors=str(summary),
            publication=str(publication_info.get("journal", summary)),
            citations=cited_by.get("total"),
            year=str(item.get("year", "")) if item.get("year") else None,
            pdf_url=pdf,
            metadata={k: v for k, v in item.items() if k not in {"title", "link", "snippet"}},
        )


@dataclass
class PatentResult:
    """Normalized Google Patents result."""

    title: str
    url: str = ""
    snippet: str = ""
    patent_number: str = ""
    assignee: str = ""
    filing_date: str | None = None
    grant_date: str | None = None
    pdf_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "PatentResult":
        return cls(
            title=str(item.get("title", "") or ""),
            url=str(item.get("pdf", "") or item.get("link", "") or ""),
            snippet=str(item.get("snippet", "") or ""),
            patent_number=str(item.get("patent_id", "") or item.get("patent_number", "") or ""),
            assignee=str(item.get("assignee", "") or ""),
            filing_date=item.get("filing_date"),
            grant_date=item.get("grant_date"),
            pdf_url=item.get("pdf"),
            metadata={k: v for k, v in item.items() if k not in {"title", "link"}},
        )


@dataclass
class ForumResult:
    """Normalized Forum/Discussion result."""

    title: str
    url: str
    snippet: str = ""
    forum_name: str = ""
    author: str = ""
    date: str | None = None
    replies_count: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "ForumResult":
        return cls(
            title=str(item.get("title", "") or ""),
            url=str(item.get("link", "") or item.get("url", "") or ""),
            snippet=str(item.get("snippet", "") or ""),
            forum_name=str(item.get("source", "") or item.get("displayed_link", "") or ""),
            author=str(item.get("author", "") or ""),
            date=item.get("date"),
            replies_count=item.get("replies"),
            metadata={k: v for k, v in item.items() if k not in {"title", "link"}},
        )


@dataclass
class ImageResult:
    """Normalized Google Images result."""

    title: str
    image_url: str
    source_url: str = ""
    source_name: str = ""
    width: int | None = None
    height: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "ImageResult":
        return cls(
            title=str(item.get("title", "") or ""),
            image_url=str(item.get("original", "") or item.get("thumbnail", "") or ""),
            source_url=str(item.get("link", "") or ""),
            source_name=str(item.get("source", "") or ""),
            width=item.get("original_width"),
            height=item.get("original_height"),
            metadata={k: v for k, v in item.items() if k not in {"title", "original", "link"}},
        )


# --- Phase 5 Models ---

@dataclass
class PlaceResult:
    """Normalized Google Maps / Local result."""

    title: str
    address: str = ""
    rating: float | None = None
    reviews: int | None = None
    phone: str = ""
    price_level: str = ""
    category: str = ""
    latitude: float | None = None
    longitude: float | None = None
    url: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "PlaceResult":
        gps = item.get("gps_coordinates") or {}
        return cls(
            title=str(item.get("title", "") or ""),
            address=str(item.get("address", "") or ""),
            rating=float(item.get("rating")) if item.get("rating") is not None else None,
            reviews=int(item.get("reviews")) if item.get("reviews") is not None else None,
            phone=str(item.get("phone", "") or ""),
            price_level=str(item.get("price", "") or ""),
            category=str(item.get("type", "") or item.get("category", "") or ""),
            latitude=gps.get("latitude"),
            longitude=gps.get("longitude"),
            url=str(item.get("link", "") or item.get("website", "") or ""),
            metadata={k: v for k, v in item.items() if k not in {"title", "address"}},
        )


@dataclass
class FlightResult:
    """Normalized Google Flights result."""

    airline: str
    flight_number: str = ""
    departure: str = ""
    arrival: str = ""
    duration: str = ""
    price: str = ""
    stops: int = 0
    carbon_emissions: str = ""
    url: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "FlightResult":
        legs = item.get("flights") or []
        first_leg = legs[0] if legs else {}
        arr = first_leg.get("arrival_airport", {}).get("name", "")
        dep = first_leg.get("departure_airport", {}).get("name", "")
        airline = first_leg.get("airline", "") or item.get("airline", "")
        price = str(item.get("price", "") or "")
        return cls(
            airline=str(airline),
            flight_number=str(first_leg.get("flight_number", "")),
            departure=str(dep),
            arrival=str(arr),
            duration=str(item.get("total_duration", "") or item.get("duration", "")),
            price=price,
            stops=len(legs) - 1 if legs else item.get("stops", 0),
            carbon_emissions=str(item.get("carbon_emissions", {}).get("this_flight", "")),
            url=str(item.get("link", "")),
            metadata={k: v for k, v in item.items() if k not in {"airline", "price"}},
        )


@dataclass
class HotelResult:
    """Normalized Google Hotels result."""

    name: str
    price: str = ""
    rating: float | None = None
    reviews: int | None = None
    location: str = ""
    amenities: list[str] = field(default_factory=list)
    url: str = ""
    image: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "HotelResult":
        rate = item.get("rate_per_night", {}) or {}
        return cls(
            name=str(item.get("name", "") or item.get("title", "") or ""),
            price=str(rate.get("lowest", "") or item.get("price", "") or ""),
            rating=float(item.get("overall_rating")) if item.get("overall_rating") is not None else None,
            reviews=int(item.get("reviews")) if item.get("reviews") is not None else None,
            location=str(item.get("location", "") or ""),
            amenities=item.get("amenities") or [],
            url=str(item.get("link", "") or ""),
            image=item.get("images", [{}])[0].get("thumbnail") if item.get("images") else None,
            metadata={k: v for k, v in item.items() if k not in {"name", "title"}},
        )


@dataclass
class FinanceResult:
    """Normalized Google Finance result."""

    symbol: str
    stock_name: str = ""
    price: str = ""
    price_change: str = ""
    percent_change: str = ""
    currency: str = ""
    exchange: str = ""
    summary: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "FinanceResult":
        summary = item.get("summary") if isinstance(item.get("summary"), dict) else item
        symbol = item.get("symbol") or summary.get("symbol") or item.get("ticker") or ""
        stock_name = item.get("stock_name") or item.get("name") or summary.get("title") or item.get("title") or ""
        price = item.get("price") or summary.get("price") or ""
        price_change = item.get("price_change") or summary.get("price_change") or ""
        percent_change = item.get("price_change_percent") or summary.get("price_change_percent") or ""
        return cls(
            symbol=str(symbol),
            stock_name=str(stock_name),
            price=str(price),
            price_change=str(price_change),
            percent_change=str(percent_change),
            currency=str(item.get("currency") or summary.get("currency") or ""),
            exchange=str(item.get("exchange") or summary.get("exchange") or ""),
            summary=str(item.get("snippet") or summary.get("description") or ""),
            metadata={k: v for k, v in item.items() if k not in {"symbol", "name"}},
        )


@dataclass
class TrendResult:
    """Normalized Google Trends result."""

    query: str
    interest_over_time: list[dict[str, Any]] = field(default_factory=list)
    top_queries: list[str] = field(default_factory=list)
    rising_queries: list[str] = field(default_factory=list)
    region: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "TrendResult":
        related = item.get("related_queries") or {}
        top = [q.get("query", "") for q in related.get("top", []) if isinstance(q, dict)]
        rising = [q.get("query", "") for q in related.get("rising", []) if isinstance(q, dict)]
        return cls(
            query=str(item.get("query", "") or ""),
            interest_over_time=item.get("interest_over_time", {}).get("timeline_data", []) or [],
            top_queries=top,
            rising_queries=rising,
            region=str(item.get("geo", "") or ""),
            metadata={k: v for k, v in item.items() if k not in {"query"}},
        )


@dataclass
class EventResult:
    """Normalized Google Events result."""

    title: str
    date: str = ""
    time: str = ""
    venue: str = ""
    address: str = ""
    description: str = ""
    ticket_links: list[str] = field(default_factory=list)
    image: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "EventResult":
        venue_info = item.get("venue") or {}
        date_info = item.get("date") or {}
        tickets = [t.get("link", "") for t in item.get("ticket_info", []) if isinstance(t, dict)]
        return cls(
            title=str(item.get("title", "") or ""),
            date=str(date_info.get("when", "") or date_info.get("start_date", "") or ""),
            time=str(date_info.get("time", "") or ""),
            venue=str(venue_info.get("name", "") or item.get("address", [{}])[0] if isinstance(item.get("address"), list) else ""),
            address=str(", ".join(item.get("address", [])) if isinstance(item.get("address"), list) else item.get("address", "")),
            description=str(item.get("description", "") or item.get("snippet", "") or ""),
            ticket_links=tickets,
            image=item.get("image") or item.get("thumbnail"),
            metadata={k: v for k, v in item.items() if k not in {"title", "description"}},
        )


@dataclass
class VideoResult:
    """Normalized YouTube video result (engine=youtube, per SerpApi docs)."""

    title: str
    url: str = ""
    video_id: str = ""
    channel: str = ""
    channel_url: str = ""
    channel_verified: bool = False
    views: int | None = None
    length: str = ""
    published_date: str | None = None
    description: str = ""
    thumbnail: str | None = None
    level: str | None = None  # beginner|intermediate|advanced (set by presenter)
    metadata: dict[str, Any] = field(default_factory=dict)
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_serpapi(cls, item: dict[str, Any]) -> "VideoResult":
        channel = item.get("channel") or {}
        thumb = item.get("thumbnail") or {}
        thumbnail = thumb.get("static") if isinstance(thumb, dict) else thumb
        views = item.get("views")
        try:
            views_i = int(views) if views is not None else None
        except (TypeError, ValueError):
            views_i = None
        return cls(
            title=str(item.get("title", "") or ""),
            url=str(item.get("link", "") or ""),
            video_id=str(item.get("video_id", "") or ""),
            channel=str(channel.get("name", "") or ""),
            channel_url=str(channel.get("link", "") or ""),
            channel_verified=bool(channel.get("verified", False)),
            views=views_i,
            length=str(item.get("length", "") or ""),
            published_date=item.get("published_date"),
            description=str(item.get("description", "") or "")[:500],
            thumbnail=thumbnail,
            metadata={k: v for k, v in item.items() if k not in {"title", "link"}},
        )

