"""SerpApi YouTube component.

Engine ``youtube`` per SerpApi docs (serpapi.com/youtube-search-api).
Required query param is ``search_query`` (not ``q``). Response carries
``video_results`` with title/link/thumbnail/channel/views/length.

Use for: video learning paths, tutorials, explainers, talks, reviews.
"""

from __future__ import annotations

from typing import Any

from haystack import component, default_from_dict, default_to_dict
from haystack.utils import Secret

from ..client.client import SerpApiClient
from ..models.results import Evidence, VideoResult
from ..utils.normalization import VERTICAL_WEIGHTS, deduplicate, rank_results
from .base import SerpApiComponentBase


@component
class SerpApiYouTube(SerpApiComponentBase):
    """Live YouTube video search via SerpApi.

    Use for video learning, tutorials, explainers, conference talks, and
    visual reviews. Do NOT use for products (use Google Shopping), jobs,
    papers, or general factual lookup.
    """

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
        """Search YouTube videos.

        :param query: e.g. "diffusion models explained for beginners".
        """
        num_results = max(1, min(int(num_results), 10))
        params: dict[str, Any] = {"hl": hl or self.hl, "gl": gl or self.gl}
        raw = self._get_client().search("youtube", query, query_param="search_query", **params)
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
        videos = raw.get("video_results") or []
        items = [VideoResult.from_serpapi(v).to_dict() for v in videos[:num_results]]
        items = deduplicate(items)
        items = rank_results(items, weights=VERTICAL_WEIGHTS["youtube"])
        evidence = [
            Evidence(
                source_url=r.get("url", ""),
                source_title=r.get("title", ""),
                source_type="video",
                extracted_claim=f"{r.get('title', '')} by {r.get('channel', '')} ({r.get('length', '?')})",
                confidence="medium",
                tool_used="youtube",
                kind="FACT",
            ).to_dict()
            for r in items
        ]
        return {
            "results": items,
            "evidence": evidence,
            "metadata": {
                "engine": "youtube",
                "result_count": len(items),
                "search_metadata": raw.get("search_metadata", {}),
                "search_information": raw.get("search_information", {}),
            },
        }

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
    def from_dict(cls, data: dict[str, Any]) -> "SerpApiYouTube":
        init = data.get("init_parameters", {})
        if "api_key" in init and isinstance(init["api_key"], dict):
            init["api_key"] = Secret.from_dict(init["api_key"])
        return default_from_dict(cls, data)
