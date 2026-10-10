"""Outbound Action model (agentic handoff).

The agent is READ-ONLY: it never books, buys, applies, or reserves.
Instead, every decision-ready pick carries an ``Action`` — an explicit,
labeled button ("Book ticket") that opens the provider site in a new tab.
The transaction happens there, never here.

Contract per action::

    {"id": "a1", "kind": "book_flight", "label": "Book ticket",
     "url": "https://…", "external": True, "result_ref": 0,
     "provider": "airline/agency site",
     "note": "Opens the provider site. Booking happens there."}

Rules:
- Only ``http``/``https`` URLs are ever emitted (``is_safe_url``).
- URLs are never invented: they come from result fields
  (``url``/``application_url``/``link``/``ticket_links``) or from
  deterministic provider *search* URLs built from user slots
  (e.g. Google Flights search for origin → destination + dates).
- Every action is marked ``external=True`` and rendered with an
  external-link glyph, ``target="_blank"`` and a handoff caption.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import quote_plus, urlparse


@dataclass
class Action:
    """One outbound handoff button for a result pick."""

    id: str
    kind: str  # book_flight|book_hotel|buy|apply|watch|read|directions|tickets|open
    label: str  # user-facing verb: "Book ticket", "Reserve room", …
    url: str
    external: bool = True
    result_ref: int = 0  # index of the pick inside its presentation list
    provider: str = ""  # short provider hint, e.g. domain or "provider site"
    note: str = "Opens the provider site. This assistant does not book, buy, or apply."

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def is_safe_url(url: Any) -> bool:
    """Only http/https URLs with a host are actionable."""
    try:
        parsed = urlparse(str(url or "").strip())
    except Exception:  # noqa: BLE001 - any unparsable input is simply not actionable
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def primary_url(result: dict[str, Any]) -> str:
    """First usable outbound URL on a normalized result dict."""
    for key in ("url", "application_url", "link"):
        value = result.get(key)
        if is_safe_url(value):
            return str(value).strip()
    tickets = result.get("ticket_links") or []
    if isinstance(tickets, list):
        for ticket in tickets:
            if is_safe_url(ticket):
                return str(ticket).strip()
    pdf = result.get("pdf_url")
    if is_safe_url(pdf):
        return str(pdf).strip()
    return ""


def _q(text: Any) -> str:
    return quote_plus(str(text or "").strip()[:200])


# --- Deterministic provider-search fallbacks (built from user slots) --------

def flights_search_url(origin: str = "", destination: str = "", dates: str = "") -> str:
    query = f"flights {origin} to {destination} {dates}".strip()
    return f"https://www.google.com/travel/flights?q={_q(query)}"


def hotels_search_url(place: str = "", dates: str = "") -> str:
    query = f"hotels {place} {dates}".strip()
    return f"https://www.google.com/travel/hotels?q={_q(query)}"


def shopping_search_url(product: str = "") -> str:
    return f"https://www.google.com/search?tbm=shop&q={_q(product)}"


def jobs_search_url(role: str = "", location: str = "") -> str:
    query = f"{role} jobs {location}".strip()
    return f"https://www.google.com/search?ibp=htl;jobs&q={_q(query)}"


def maps_search_url(place: str = "") -> str:
    return f"https://www.google.com/maps/search/{_q(place)}"


def youtube_search_url(query: str = "") -> str:
    return f"https://www.youtube.com/results?search_query={_q(query)}"


def scholar_search_url(query: str = "") -> str:
    return f"https://scholar.google.com/scholar?q={_q(query)}"


# --- Kind resolution ---------------------------------------------------------

def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
    except Exception:  # noqa: BLE001 - unparsable URL has no provider hint
        return ""
    return host.removeprefix("www.")


def action_for_result(
    result: dict[str, Any],
    use_case: str = "",
    index: int = 0,
    slots: dict[str, Any] | None = None,
) -> Action:
    """Build the primary outbound action for one normalized result.

    Never raises: always returns an ``Action`` (possibly with an empty
    URL, which the UI renders as plain text, not a button).
    """
    slots = slots or {}
    url = primary_url(result)
    case = (use_case or "").lower()
    action_id = f"a{index + 1}"

    def make(kind: str, label: str, link: str, provider: str = "") -> Action:
        return Action(
            id=action_id,
            kind=kind,
            label=label,
            url=link,
            result_ref=index,
            provider=provider or (_domain(link) if link else ""),
        )

    # Flights — the flagship "Book ticket" flow.
    if result.get("airline") or result.get("flight_number") or case == "travel" and result.get("_engine") == "google_flights":
        link = url or flights_search_url(slots.get("origin", ""), slots.get("destination", ""), slots.get("dates", ""))
        return make("book_flight", "Book ticket", link)
    # Hotels (HotelResult carries `name`; product/job checks already ran above).
    if result.get("name"):
        link = url or hotels_search_url(slots.get("destination", "") or slots.get("place", ""), slots.get("dates", ""))
        return make("book_hotel", "Reserve room", link)
    # Jobs.
    if result.get("company") or result.get("application_url") or case in ("jobs", "careers"):
        link = url or jobs_search_url(slots.get("role", ""), slots.get("location", ""))
        return make("apply", "Open application", link)
    # Products / shopping.
    if result.get("seller") or result.get("numeric_price") is not None or case == "shopping":
        link = url or shopping_search_url(slots.get("product", "") or result.get("title", ""))
        return make("buy", "View deal", link)
    # Videos.
    if result.get("channel") or result.get("length") or result.get("_engine") == "youtube":
        link = url or youtube_search_url(result.get("title", ""))
        return make("watch", "Watch", link)
    # Papers / patents.
    if result.get("authors") is not None or result.get("citations") is not None or result.get("patent_number") or case in ("academic", "deep_dive"):
        link = url or scholar_search_url(result.get("title", ""))
        return make("read", "Read paper", link)
    # Events (tickets first).
    if result.get("venue") or result.get("ticket_links") or result.get("_engine") == "google_events":
        link = url
        return make("tickets", "Get tickets", link)
    # Places.
    if result.get("address") or result.get("_engine") == "google_maps":
        link = url or maps_search_url(result.get("title", "") or slots.get("place", ""))
        return make("directions", "Get directions", link)
    # Generic fallback.
    return make("open", "Open", url)


def attach_actions(
    presentation: dict[str, Any],
    use_case: str = "",
    slots: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Inject per-pick ``action`` dicts + a top-level ``actions`` list.

    Mutates and returns ``presentation``. Every list of picks inside the
    known presentation shapes gets an ``action`` on each item; the
    top-level ``actions`` array mirrors them for clients that render a
    single action bar.
    """
    slots = slots or {}
    ptype = presentation.get("type", "")
    actions: list[dict[str, Any]] = []

    def _wire(items: list[Any], case: str) -> None:
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            action = action_for_result(item, case, len(actions), slots)
            item["action"] = action.to_dict()
            actions.append(action.to_dict())

    if ptype == "shopping_top2":
        _wire(presentation.get("picks", []) or [], "shopping")
    elif ptype == "travel_choices":
        _wire(presentation.get("flights", []) or [], "travel")
        _wire(presentation.get("hotels", []) or [], "travel")
        _wire(presentation.get("places", []) or [], "travel")
    elif ptype == "jobs_table":
        _wire(presentation.get("jobs", []) or [], "jobs")
    elif ptype == "youtube_path":
        for items in (presentation.get("levels", {}) or {}).values():
            _wire(items or [], "youtube_learning")
    elif ptype == "local_list":
        _wire(presentation.get("places", []) or [], "local")
    elif ptype == "deep_dive":
        _wire(presentation.get("papers", []) or [], "academic")
        _wire(presentation.get("findings", []) or [], "research")
    elif ptype == "learning_plan":
        for stage in presentation.get("stages", []) or []:
            if isinstance(stage, dict):
                _wire(stage.get("topics", []) or [], "learning")
    else:
        _wire(presentation.get("results", []) or [], use_case)
        _wire(presentation.get("picks", []) or [], use_case)

    presentation["actions"] = actions
    return presentation


__all__ = [
    "Action",
    "action_for_result",
    "attach_actions",
    "flights_search_url",
    "hotels_search_url",
    "is_safe_url",
    "jobs_search_url",
    "maps_search_url",
    "primary_url",
    "scholar_search_url",
    "shopping_search_url",
    "youtube_search_url",
]
