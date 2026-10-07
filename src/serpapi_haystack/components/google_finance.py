"""SerpApi Google Finance component (Phase 5).

Use for: stock prices, market trends, financial summaries, ticker lookup, financial news.
"""

from __future__ import annotations

from typing import Any

from haystack import component, default_from_dict, default_to_dict
from haystack.utils import Secret

from ..client.client import SerpApiClient
from ..models.results import Evidence, FinanceResult
from ..utils.normalization import VERTICAL_WEIGHTS, deduplicate, rank_results
from .base import SerpApiComponentBase


@component
class SerpApiGoogleFinance(SerpApiComponentBase):
    """Live Google Finance search via SerpApi."""

    def __init__(
        self,
        api_key: Secret | str | None = None,
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
            self.api_key = Secret.from_env_var("SERPAPI_API_KEY", strict=False)
            self._token = str(api_key)
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
        hl: str | None = None,
        gl: str | None = None,
    ) -> dict[str, Any]:
        num_results = max(1, min(int(num_results), 10))
        params: dict[str, Any] = {"q": query, "hl": hl or self.hl, "gl": gl or self.gl}
        raw = self._get_client().search("google_finance", **params)
        return self._normalize(raw, num_results)

    @component.output_types(results=list, evidence=list, metadata=dict)
    async def run_async(
        self,
        query: str,
        num_results: int = 10,
        hl: str | None = None,
        gl: str | None = None,
    ) -> dict[str, Any]:
        import asyncio

        return await asyncio.to_thread(self.run, query, num_results, hl, gl)

    def _normalize(self, raw: dict[str, Any], num_results: int) -> dict[str, Any]:
        results = []
        if raw.get("markets") and isinstance(raw["markets"], dict):
            for k, v in raw["markets"].items():
                if isinstance(v, list):
                    results.extend(v)
        if raw.get("news_results") and isinstance(raw["news_results"], list):
            results.extend(raw["news_results"])
        if not results:
            results = [raw]

        items = [FinanceResult.from_serpapi(o).to_dict() for o in results[:num_results]]
        items = deduplicate(items, title_key="symbol", url_key="stock_name")
        items = rank_results(items, weights=VERTICAL_WEIGHTS["finance"])
        evidence = [
            Evidence(
                source_url=r.get("url", ""),
                source_title=f"{r.get('stock_name', '')} ({r.get('symbol', '')})",
                source_type="finance",
                extracted_claim=f"{r.get('stock_name', '')} ({r.get('symbol', '')}): price {r.get('price', '')} {r.get('currency', '')} ({r.get('percent_change', '')})"[:300],
                confidence="high",
                tool_used="google_finance",
                kind="FACT",
            ).to_dict()
            for r in items
        ]
        metadata = {
            "engine": "google_finance",
            "result_count": len(items),
            "search_metadata": raw.get("search_metadata", {}),
        }
        return {"results": items, "evidence": evidence, "metadata": metadata}

    def to_dict(self) -> dict[str, Any]:
        return default_to_dict(
            self,
            api_key=self.api_key.to_dict(),
            hl=self.hl,
            gl=self.gl,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SerpApiGoogleFinance":
        init = data.get("init_parameters", {})
        if "api_key" in init and isinstance(init["api_key"], dict):
            init["api_key"] = Secret.from_dict(init["api_key"])
        return default_from_dict(cls, data)
