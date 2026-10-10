"""Travel helpers for the agentic flow: airport codes + trip dates.

SerpApi's ``google_flights`` engine needs IATA ``departure_id`` /
``arrival_id`` (not free-text queries) and ``google_hotels`` requires
``check_in_date``. The LLM already extracts ``origin`` / ``destination`` /
``dates`` slots as city names and free text; these helpers translate them
into engine-ready parameters. Unresolvable input yields ``None`` / sane
defaults — never invented precision.
"""

from __future__ import annotations

import datetime as _dt
import re

# Major world cities + Indian cities (primary developer base). Values are
# IATA metro/airport codes accepted by SerpApi google_flights.
AIRPORT_CODES: dict[str, str] = {
    # India
    "bengaluru": "BLR", "bangalore": "BLR", "delhi": "DEL", "new delhi": "DEL",
    "mumbai": "BOM", "bombay": "BOM", "hyderabad": "HYD", "chennai": "MAA",
    "madras": "MAA", "kolkata": "CCU", "calcutta": "CCU", "pune": "PNQ",
    "ahmedabad": "AMD", "kochi": "COK", "cochin": "COK", "goa": "GOI",
    "jaipur": "JAI", "lucknow": "LKO", "chandigarh": "IXC", "bhubaneswar": "BBI",
    "indore": "IDR", "nagpur": "NAG", "surat": "STV", "coimbatore": "CJB",
    "kozhikode": "CCJ", "calicut": "CCJ", "trivandrum": "TRV", "thiruvananthapuram": "TRV",
    "varanasi": "VNS", "amritsar": "ATQ", "srinagar": "SXR", "leh": "IXL",
    "guwahati": "GAU", "patna": "PAT", "ranchi": "IXR", "bhopal": "BHO",
    "udaipur": "UDR", "jodhpur": "JDH", "dehradun": "DED", "shimla": "SLV",
    "port blair": "IXZ",
    # Asia-Pacific
    "tokyo": "NRT", "osaka": "KIX", "kyoto": "KIX", "seoul": "ICN", "beijing": "PEK",
    "shanghai": "PVG", "hong kong": "HKG", "singapore": "SIN", "kuala lumpur": "KUL",
    "bangkok": "BKK", "jakarta": "JKT", "manila": "MNL", "sydney": "SYD",
    "melbourne": "MEL", "auckland": "AKL", "taipei": "TPE", "hanoi": "HAN",
    "ho chi minh": "SGN", "denpasar": "DPS", "bali": "DPS", "colombo": "CMB",
    "kathmandu": "KTM", "dhaka": "DAC", "karachi": "KHI", "maldives": "MLE",
    "male": "MLE", "dubai": "DXB", "abu dhabi": "AUH", "doha": "DOH",
    "riyadh": "RUH", "jeddah": "JED", "muscat": "MCT", "istanbul": "IST",
    # Europe
    "london": "LHR", "paris": "CDG", "frankfurt": "FRA", "amsterdam": "AMS",
    "madrid": "MAD", "barcelona": "BCN", "rome": "FCO", "milan": "MXP",
    "zurich": "ZRH", "geneva": "GVA", "berlin": "BER", "munich": "MUC",
    "vienna": "VIE", "prague": "PRG", "athens": "ATH", "lisbon": "LIS",
    "dublin": "DUB", "stockholm": "ARN", "oslo": "OSL", "copenhagen": "CPH",
    "helsinki": "HEL", "warsaw": "WAW", "moscow": "SVO",
    # North America
    "new york": "JFK", "nyc": "JFK", "newark": "EWR", "los angeles": "LAX",
    "san francisco": "SFO", "chicago": "ORD", "washington": "DCA", "boston": "BOS",
    "seattle": "SEA", "miami": "MIA", "dallas": "DFW", "houston": "IAH",
    "atlanta": "ATL", "denver": "DEN", "las vegas": "LAS", "orlando": "MCO",
    "toronto": "YYZ", "vancouver": "YVR", "montreal": "YUL", "mexico city": "MEX",
    # Others
    "sao paulo": "GRU", "rio de janeiro": "GIG", "buenos aires": "EZE",
    "johannesburg": "JNB", "cape town": "CPT", "cairo": "CAI", "nairobi": "NBO",
    "sydney": "SYD", "perth": "PER", "auckland": "AKL",
}

_IATA_RE = re.compile(r"\b([A-Z]{3})\b")


def resolve_airport(text: str | None) -> str | None:
    """Map free text ("Bengaluru", "BLR", "New York") to an IATA code."""
    if not text or not str(text).strip():
        return None
    lowered = str(text).strip().lower()
    earliest: tuple[int, str] | None = None
    for code in set(AIRPORT_CODES.values()):
        match = re.search(rf"\b{re.escape(code.lower())}\b", lowered)
        if match and (earliest is None or match.start() < earliest[0]):
            earliest = (match.start(), code)
    if earliest:
        return earliest[1]
    for city in sorted(AIRPORT_CODES, key=len, reverse=True):
        if city in lowered:
            return AIRPORT_CODES[city]
    return None


_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_ISO_RE = re.compile(r"(20\d{2})-(\d{1,2})-(\d{1,2})")
_MD_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*,?\s*(20\d{2}))?",
    re.I,
)


def _roll_forward(month: int, day: int, year: int | None, today: _dt.date) -> _dt.date | None:
    try:
        candidate = _dt.date(year or today.year, month, min(day, 28))
    except ValueError:
        return None
    if candidate < today:
        try:
            candidate = _dt.date(candidate.year + 1, month, min(day, 28))
        except ValueError:
            return None
    return candidate


def parse_trip_dates(
    dates: str | None, today: _dt.date | None = None, default_stay_nights: int = 3
) -> tuple[str, str]:
    """Turn free-text dates into (check_in, check_out) ``YYYY-MM-DD``.

    Understands ISO dates and "Dec 12" style mentions (rolled forward to
    the next occurrence). Anything else falls back to +30/+33 days so the
    hotels engine always has the required parameters. The chosen dates are
    returned to the UI, so defaults stay visible, never silent.
    """
    today = today or _dt.date.today()
    text = str(dates or "")
    found: list[_dt.date] = []
    for match in _ISO_RE.finditer(text):
        try:
            found.append(_dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3))))
        except ValueError:
            continue
    for match in _MD_RE.finditer(text):
        parsed = _roll_forward(_MONTHS[match.group(1).lower()[:3]], int(match.group(2)),
                               int(match.group(3)) if match.group(3) else None, today)
        if parsed:
            found.append(parsed)
    found = sorted({d for d in found if d >= today})
    if len(found) >= 2:
        check_in, check_out = found[0], found[1]
    elif len(found) == 1:
        check_in = found[0]
        check_out = check_in + _dt.timedelta(days=default_stay_nights)
    else:
        check_in = today + _dt.timedelta(days=30)
        check_out = check_in + _dt.timedelta(days=default_stay_nights)
    return check_in.isoformat(), check_out.isoformat()


def flight_dates(
    dates: str | None, today: _dt.date | None = None
) -> tuple[str, str | None]:
    """Turn free-text dates into (outbound, return_or_None) ``YYYY-MM-DD``.

    SerpApi defaults to round trip (``type=1``) and *requires*
    ``return_date`` there; one-way needs ``type=2``. A return date is only
    ever taken from user text with 2+ explicit dates (or an explicit
    ``return_date`` slot) — never defaulted, so the agent cannot invent a
    return leg. Returns ``(outbound, None)`` for one-way.
    """
    text = str(dates or "")
    explicit = len(_ISO_RE.findall(text)) + len(_MD_RE.findall(text))
    outbound, fallback_return = parse_trip_dates(dates, today)
    if explicit >= 2:
        return outbound, fallback_return
    return outbound, None


__all__ = ["AIRPORT_CODES", "resolve_airport", "parse_trip_dates", "flight_dates"]
