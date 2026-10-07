"""Normalized error hierarchy for SerpApi (PRD Sec 23, 80)."""


class SerpApiError(Exception):
    """Base class for all SerpApi client errors."""


class SerpApiAuthError(SerpApiError):
    """Invalid/missing API key (HTTP 401/403)."""


class SerpApiBadRequestError(SerpApiError):
    """Invalid query or parameters (HTTP 400 / client-side validation)."""


class SerpApiRateLimitError(SerpApiError):
    """Rate limited / quota exhausted (HTTP 429). Retry with backoff."""


class SerpApiTimeoutError(SerpApiError):
    """Request timed out."""


class SerpApiServerError(SerpApiError):
    """Upstream 5xx error. Safe to retry."""


class SerpApiParseError(SerpApiError):
    """Response could not be parsed/normalized."""
