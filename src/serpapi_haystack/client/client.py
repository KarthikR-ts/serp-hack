"""Shared SerpApi HTTP client (PRD Sec 22-23).

Responsibilities (PRD Sec 23):
API key handling, HTTP requests, timeout handling, retries,
rate limiting, error normalization, request logging,
response parsing, serialization, caching hooks.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Callable, Optional

import requests

from .exceptions import (
    SerpApiAuthError,
    SerpApiBadRequestError,
    SerpApiError,
    SerpApiRateLimitError,
    SerpApiServerError,
    SerpApiTimeoutError,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://serpapi.com/search.json"

# Suggested cache TTLs per vertical (PRD Sec 77), seconds.
DEFAULT_TTL_BY_ENGINE: dict[str, int] = {
    "google": 1800,  # general research: moderate
    "google_jobs": 600,  # jobs: short
    "google_shopping": 600,  # shopping: short
    "google_news": 120,  # news: very short (Phase 4, reserved)
    "google_scholar": 86400,  # scholar: longer (Phase 4, reserved)
    "google_flights": 60,  # flights: very short (Phase 5, reserved)
    "youtube": 3600,  # video search: moderate-long
    "default": 900,
}

# Engines officially supported (per SerpApi docs: serpapi.com/search-api).
SUPPORTED_ENGINES = {
    "google",
    "google_jobs",
    "google_shopping",
    "google_news",
    "google_scholar",
    "google_patents",
    "google_forums",
    "google_images",
    "google_maps",
    "google_flights",
    "google_hotels",
    "google_finance",
    "google_trends",
    "google_events",
    "youtube",
}


def _redact(params: dict[str, Any]) -> dict[str, Any]:
    """Copy params with the API key redacted for logging (PRD Sec 82/85)."""
    redacted = dict(params)
    if "api_key" in redacted:
        redacted["api_key"] = "***REDACTED***"
    if "serpapi_api_key" in redacted:
        redacted["serpapi_api_key"] = "***REDACTED***"
    return redacted


@dataclass
class SerpApiClient:
    """Thin, shared HTTP client over SerpApi.

    Conceptual API (PRD Sec 23)::

        client = SerpApiClient(api_key=...)
        result = client.search(engine="google", q="best laptops under 1000")

    All Haystack components must share this client instead of duplicating
    auth/HTTP/retry logic (PRD Sec 22).
    """

    api_key: str
    base_url: str = BASE_URL
    timeout: float = 30.0
    max_retries: int = 3
    backoff_factor: float = 0.5
    min_interval_seconds: float = 0.0  # simple client-side rate limit
    cache: Optional[Any] = None  # injectable; must expose get/set or get_ttl
    session: requests.Session | None = None
    _lock: Lock = field(default_factory=Lock, repr=False, compare=False)
    _last_call: float = field(default=0.0, repr=False, compare=False)
    call_count: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        if not self.api_key or not str(self.api_key).strip():
            raise SerpApiAuthError("SerpApi API key is missing. Set SERPAPI_API_KEY.")
        if self.session is None:
            self.session = requests.Session()

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------
    def search(self, engine: str, q: str = "", query_param: str = "q", **params: Any) -> dict[str, Any]:
        """Execute a SerpApi search for any engine.

        :param engine: SerpApi engine, e.g. ``google``, ``google_jobs``,
            ``google_shopping``, ``youtube``.
        :param q: query string. Required by query-based engines; engines
            with native parameters (e.g. ``google_flights`` with
            ``departure_id``/``arrival_id``) omit it.
        :param query_param: name of the query parameter. Most engines use
            ``q``; YouTube uses ``search_query`` (per SerpApi docs).
        :param params: extra SerpApi parameters (location, hl, gl, num, ...).
        :returns: parsed JSON dict from SerpApi.
        :raises SerpApiError: normalized error hierarchy.
        """
        if q is None:
            q = ""
        if q != "" and not str(q).strip():
            raise SerpApiBadRequestError("Query 'q' must be a non-empty string.")
        if engine not in SUPPORTED_ENGINES:
            logger.warning("Engine '%s' is not in supported set %s.", engine, SUPPORTED_ENGINES)
        request_id = uuid.uuid4().hex[:12]
        payload: dict[str, Any] = {"engine": engine, "api_key": self.api_key, **params}
        if str(q).strip():
            payload[query_param] = q.strip()
        cache_key = self._cache_key(engine, q, params)
        if self.cache is not None:
            try:
                cached = self.cache.get(cache_key)
            except AttributeError:
                cached = None
            if cached is not None:
                logger.debug("[%s] cache hit engine=%s q=%r", request_id, engine, q)
                return cached

        self._respect_rate_limit()
        response_json = self._do_request_with_retry(request_id, payload)
        if self.cache is not None and hasattr(self.cache, "set"):
            try:
                self.cache.set(cache_key, response_json)
            except Exception:  # noqa: BLE001 - cache must never break search
                logger.debug("[%s] cache set failed (ignored)", request_id)
        return response_json

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------
    def _cache_key(self, engine: str, q: str, params: dict[str, Any]) -> str:
        # Cache key (PRD Sec 77): engine + query + location + language +
        # country + filters.
        relevant = {k: params.get(k) for k in ("location", "hl", "gl", "lr", "num", "start", "tbs", "uule")}
        parts = [engine, q.strip().lower(), *[f"{k}={v}" for k, v in sorted(relevant.items())]]
        extra = sorted((k, str(v)) for k, v in params.items() if k not in relevant)
        parts.extend(f"{k}={v}" for k, v in extra)
        return "|".join(parts)

    def _respect_rate_limit(self) -> None:
        if self.min_interval_seconds <= 0:
            return
        with self._lock:
            now = time.monotonic()
            wait = self.min_interval_seconds - (now - self._last_call)
            if wait > 0:
                time.sleep(wait)
            self._last_call = time.monotonic()

    def _do_request_with_retry(self, request_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                logger.debug(
                    "[%s] SerpApi request attempt=%d params=%s",
                    request_id,
                    attempt,
                    _redact(payload),
                )
                assert self.session is not None
                resp = self.session.get(self.base_url, params=payload, timeout=self.timeout)
                self.call_count += 1
                return self._handle_response(request_id, resp)
            except SerpApiRateLimitError as exc:
                last_exc = exc
                # Retry with backoff on 429.
                if attempt < self.max_retries:
                    delay = self.backoff_factor * (2**attempt)
                    logger.warning("[%s] rate limited, retrying in %.2fs", request_id, delay)
                    time.sleep(delay)
                    continue
                raise
            except (SerpApiServerError, SerpApiTimeoutError) as exc:
                last_exc = exc
                if attempt < self.max_retries:
                    delay = self.backoff_factor * (2**attempt)
                    logger.warning("[%s] %s, retrying in %.2fs", request_id, type(exc).__name__, delay)
                    time.sleep(delay)
                    continue
                raise
            except requests.Timeout as exc:
                last_exc = exc
                if attempt < self.max_retries:
                    delay = self.backoff_factor * (2**attempt)
                    time.sleep(delay)
                    continue
                raise SerpApiTimeoutError(f"SerpApi request timed out: {exc}") from exc
            except requests.RequestException as exc:
                raise SerpApiError(f"SerpApi request failed: {exc}") from exc
        raise SerpApiError(f"SerpApi request failed after retries: {last_exc}")

    def _handle_response(self, request_id: str, resp: requests.Response) -> dict[str, Any]:
        if resp.status_code == 200:
            try:
                data = resp.json()
            except ValueError as exc:
                raise SerpApiError("SerpApi returned invalid JSON.") from exc
            if isinstance(data, dict) and "error" in data:
                raise self._classify_api_error(data["error"], resp.status_code)
            logger.debug("[%s] SerpApi OK status=200", request_id)
            return data if isinstance(data, dict) else {"results": data}
        if resp.status_code in (401, 403):
            raise SerpApiAuthError(f"SerpApi auth failed (HTTP {resp.status_code}): {resp.text[:300]}")
        if resp.status_code == 400:
            raise SerpApiBadRequestError(f"SerpApi bad request: {resp.text[:300]}")
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After", "?")
            raise SerpApiRateLimitError(f"SerpApi rate limited (retry-after={retry_after}).")
        if 500 <= resp.status_code < 600:
            raise SerpApiServerError(f"SerpApi server error HTTP {resp.status_code}: {resp.text[:300]}")
        raise SerpApiError(f"SerpApi unexpected HTTP {resp.status_code}: {resp.text[:300]}")

    @staticmethod
    def _classify_api_error(message: Any, status: int) -> SerpApiError:
        text = str(message)
        lowered = text.lower()
        if "api_key" in lowered or "api key" in lowered or "unauthorized" in lowered:
            return SerpApiAuthError(text)
        if "rate" in lowered or "quota" in lowered or "limit" in lowered:
            return SerpApiRateLimitError(text)
        return SerpApiError(f"SerpApi error (HTTP {status}): {text}")

    # Convenience wrappers ------------------------------------------------
    def google_search(self, q: str, num: int = 10, **kwargs: Any) -> dict[str, Any]:
        return self.search("google", q, num=num, **kwargs)

    def google_jobs(self, q: str, **kwargs: Any) -> dict[str, Any]:
        return self.search("google_jobs", q, **kwargs)

    def google_shopping(self, q: str, **kwargs: Any) -> dict[str, Any]:
        return self.search("google_shopping", q, **kwargs)

    def youtube(self, q: str, **kwargs: Any) -> dict[str, Any]:
        return self.search("youtube", q, query_param="search_query", **kwargs)


def resolve_api_key(explicit: str | None = None) -> str:
    """Resolve API key from explicit value or ``SERPAPI_API_KEY`` env var."""
    import os

    key = (explicit or os.getenv("SERPAPI_API_KEY") or "").strip()
    if not key:
        raise SerpApiAuthError("SerpApi API key missing. Pass api_key or set SERPAPI_API_KEY.")
    return key
