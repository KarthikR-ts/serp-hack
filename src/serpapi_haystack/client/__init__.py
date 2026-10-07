"""SerpApi client package."""
from .client import DEFAULT_TTL_BY_ENGINE, SUPPORTED_ENGINES, SerpApiClient, resolve_api_key
from .exceptions import (
    SerpApiAuthError,
    SerpApiBadRequestError,
    SerpApiError,
    SerpApiParseError,
    SerpApiRateLimitError,
    SerpApiServerError,
    SerpApiTimeoutError,
)

__all__ = [
    "SerpApiClient",
    "resolve_api_key",
    "SUPPORTED_ENGINES",
    "DEFAULT_TTL_BY_ENGINE",
    "SerpApiError",
    "SerpApiAuthError",
    "SerpApiBadRequestError",
    "SerpApiRateLimitError",
    "SerpApiTimeoutError",
    "SerpApiServerError",
    "SerpApiParseError",
]
