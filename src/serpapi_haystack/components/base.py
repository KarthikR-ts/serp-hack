"""Shared base for SerpApi Haystack components (PRD Sec 22).

All components share one SerpApiClient; no duplicated auth/HTTP logic.
"""

from __future__ import annotations

from typing import Any

from haystack.utils import Secret

from ..client.client import SerpApiClient, resolve_api_key
from ..utils.cache import build_default_cache


class SerpApiComponentBase:
    """Mixin: resolves Secret -> SerpApiClient, builds serialization dict."""

    def _resolve_client(
        self,
        api_key: Secret | str | None,
        timeout: float,
        max_retries: int,
        cache: Any | None,
    ) -> SerpApiClient:
        if isinstance(api_key, Secret):
            key = api_key.resolve_value()
            if not key:
                raise ValueError("SERPAPI_API_KEY env var is not set.")
        elif isinstance(api_key, str):
            key = resolve_api_key(api_key)
        elif api_key is None:
            key = resolve_api_key(None)
        else:
            raise TypeError("api_key must be Secret, str, or None.")
        return SerpApiClient(
            api_key=key,
            timeout=timeout,
            max_retries=max_retries,
            cache=cache if cache is not None else build_default_cache(),
        )

    @staticmethod
    def _secret_to_dict(api_key: Secret | str) -> dict[str, Any]:
        if isinstance(api_key, Secret):
            return api_key.to_dict()
        return {"type": "env_var", "env_vars": ["SERPAPI_API_KEY"], "strict": False}
