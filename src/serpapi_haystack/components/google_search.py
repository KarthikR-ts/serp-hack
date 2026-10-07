"""SerpApi Google Search component (PRD Sec 7, 22-24).

Use for: general research, documentation, websites, comparisons,
factual lookup, discovery.
"""

from __future__ import annotations

from typing import Any, Literal

from haystack import component, default_from_dict, default_to_dict
from haystack.utils import Secret

from ..client.client import SerpApiClient
from ..models.results import Evidence, SearchResult
from ..utils.normalization import VERTICAL_WEIGHTS, deduplicate, rank_results
from .base import SerpApiComponentBase


@component
class SerpApiGoogleSearch(SerpApiComponentBase):
    """Live Google web search via SerpApi.

    Use this when the user needs broad web information, documentation,
    comparisons, or factual lookup. Do NOT use for academic papers
    (use Scholar, Phase 4), jobs (use Google Jobs), flights/hotels
    (use travel tools, Phase 5) when a specialized tool is available.
    """

    def __init__(
        self,
        api_key: Secret | str | None = None,
        location: str | None = None,
        hl: str = "en",
        gl: str = "us",
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
            # Explicit string key: keep a serializable env-var Secret for
            # pipeline persistence; hold the raw token separately for auth.
            # (Haystack forbids serializing token secrets.)
            self.api_key = Secret.from_env_var("SERPAPI_API_KEY", strict=False)
            self._token = str(api_key)
        self.location = location
        self.hl = hl
        self.gl = gl
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
        num_results: int = 10,
        location: str | None = None,
        hl: str | None = None,
        gl: str | None = None,
    ) -> dict[str, Any]:
        """Search live Google web index.

        :param query: natural-language query (non-empty).
        :param num_results: max results (clamped to 10 per PRD Sec 78).
        """
        num_results = max(1, min(int(num_results), 10))
        params: dict[str, Any] = {"num": num_results, "hl": hl or self.hl, "gl": gl or self.gl}
        loc = location or self.location
        if loc:
            params["location"] = loc
        raw = self._get_client().search("google", query, **params)
        return self._normalize(raw, num_results)

    @component.output_types(results=list, evidence=list, metadata=dict)
    async def run_async(
        self,
        query: str,
        num_results: int = 10,
        location: str | None = None,
        hl: str | None = None,
        gl: str | None = None,
    ) -> dict[str, Any]:
        import asyncio

        return await asyncio.to_thread(self.run, query, num_results, location, hl, gl)

    # -- normalization (PRD Sec 73-76) ---------------------------------
    def _normalize(self, raw: dict[str, Any], num_results: int) -> dict[str, Any]:
        organic = raw.get("organic_results") or []
        items = [SearchResult.from_serpapi(o).to_dict() for o in organic[:num_results]]
        items = deduplicate(items)
        items = rank_results(items, weights=VERTICAL_WEIGHTS["search"])
        evidence = [
            Evidence(
                source_url=r.get("url", ""),
                source_title=r.get("title", ""),
                source_type="organic",
                extracted_claim=r.get("snippet", "")[:300],
                confidence="medium",
                tool_used="google_search",
                kind="FACT",
            ).to_dict()
            for r in items
        ]
        metadata = {
            "engine": "google",
            "result_count": len(items),
            "search_metadata": raw.get("search_metadata", {}),
            "search_information": raw.get("search_information", {}),
        }
        return {"results": items, "evidence": evidence, "metadata": metadata}

    def to_dict(self) -> dict[str, Any]:
        return default_to_dict(
            self,
            api_key=self.api_key.to_dict(),
            location=self.location,
            hl=self.hl,
            gl=self.gl,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SerpApiGoogleSearch":
        init = data.get("init_parameters", {})
        if "api_key" in init and isinstance(init["api_key"], dict):
            init["api_key"] = Secret.from_dict(init["api_key"])
        return default_from_dict(cls, data)
