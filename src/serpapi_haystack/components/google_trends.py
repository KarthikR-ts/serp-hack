"""SerpApi Google Trends component (Phase 5).

Use for: interest over time, rising topics, regional interest, popularity analysis.
"""

from __future__ import annotations

from typing import Any

from haystack import component, default_from_dict, default_to_dict
from haystack.utils import Secret

from ..client.client import SerpApiClient
from ..models.results import Evidence, TrendResult
from ..utils.normalization import VERTICAL_WEIGHTS, deduplicate, rank_results
from .base import SerpApiComponentBase


@component
class SerpApiGoogleTrends(SerpApiComponentBase):
    """Live Google Trends search via SerpApi."""

    def __init__(
        self,
        api_key: Secret | str | None = None,
        geo: str = "",
        hl: str = "en",
        timeout: float = 30.0,
        max_retries: int = 3,
        cache: Any | None = None,
    ):
        if api_key is None:
            self.api_key = Secret.from_env_var("SERPAPI_API_KEY", strict=False)
            self._token: str | None = None
        elif isinstance(api_key, Secret):
            self.api_key = api_key
            self._token = None
        else:
            self.api_key = Secret.from_env_var("SERPAPI_API_KEY", strict=False)
            self._token = str(api_key)
        self.geo = geo
        self.hl = hl
        self.timeout = timeout
        self.max_retries = max_retries
        self.cache = cache
        self._client: SerpApiClient | None = None

    def _get_client(self) -> SerpApiClient:
        if self._client is None:
            from ..client.client import resolve_api_key

            key = self._token or resolve_api_key(
                self.api_key.resolve_value() if isinstance(self.api_key, Secret) else None
            )
            self._client = SerpApiClient(
                api_key=key,
                timeout=self.timeout,
                max_retries=self.max_retries,
                cache=self.cache,
            )
        return self._client

    @component.output_types(results=list, evidence=list, metadata=dict)
    def run(
        self,
        query: str,
        geo: str | None = None,
        hl: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"q": query, "hl": hl or self.hl, "geo": geo or self.geo}
        raw = self._get_client().search("google_trends", **params)
        return self._normalize(raw, 10)

    @component.output_types(results=list, evidence=list, metadata=dict)
    async def run_async(
        self,
        query: str,
        geo: str | None = None,
        hl: str | None = None,
    ) -> dict[str, Any]:
        import asyncio

        return await asyncio.to_thread(self.run, query, geo, hl)

    def _normalize(self, raw: dict[str, Any], num_results: int) -> dict[str, Any]:
        items = [TrendResult.from_serpapi(raw).to_dict()]
        items = rank_results(items, weights=VERTICAL_WEIGHTS["trends"])
        r = items[0] if items else {}
        evidence = [
            Evidence(
                source_url="",
                source_title=f"Google Trends: {r.get('query', '')}",
                source_type="trends",
                extracted_claim=f"Top rising queries for '{r.get('query', '')}': {', '.join(r.get('rising_queries', [])[:5])}"[:300],
                confidence="medium",
                tool_used="google_trends",
                kind="FACT",
            ).to_dict()
        ]
        metadata = {
            "engine": "google_trends",
            "result_count": len(items),
            "search_metadata": raw.get("search_metadata", {}),
        }
        return {"results": items, "evidence": evidence, "metadata": metadata}

    def to_dict(self) -> dict[str, Any]:
        return default_to_dict(
            self,
            api_key=self.api_key.to_dict(),
            geo=self.geo,
            hl=self.hl,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SerpApiGoogleTrends":
        init = data.get("init_parameters", {})
        if "api_key" in init and isinstance(init["api_key"], dict):
            init["api_key"] = Secret.from_dict(init["api_key"])
        return default_from_dict(cls, data)
