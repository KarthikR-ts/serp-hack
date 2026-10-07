"""SerpApi Google Jobs component (PRD Sec 11, flagship workflow)."""

from __future__ import annotations

from typing import Any

from haystack import component, default_from_dict, default_to_dict
from haystack.utils import Secret

from ..client.client import SerpApiClient
from ..models.results import Evidence, JobResult
from ..utils.normalization import VERTICAL_WEIGHTS, deduplicate, rank_results
from .base import SerpApiComponentBase


@component
class SerpApiGoogleJobs(SerpApiComponentBase):
    """Live Google Jobs search via SerpApi.

    Use for job/internship discovery, filtering by role, location,
    eligibility, compensation, and deadlines. Extracts company, location,
    compensation, eligibility, deadline; deduplicates and ranks.
    Do NOT use for general web research (use Google Search) or products.
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
        """Search jobs.

        :param query: e.g. "software engineering internships".
        :param location: e.g. "Bengaluru, India" (overrides default).
        """
        num_results = max(1, min(int(num_results), 10))
        params: dict[str, Any] = {"hl": hl or self.hl, "gl": gl or self.gl}
        loc = location or self.location
        if loc:
            params["location"] = loc
        raw = self._get_client().search("google_jobs", query, **params)
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

    def _normalize(self, raw: dict[str, Any], num_results: int) -> dict[str, Any]:
        jobs = raw.get("jobs_results") or []
        items = [JobResult.from_serpapi(j).to_dict() for j in jobs[:num_results]]
        # Dedup on title+company via url fallback: use application_url as url key.
        for it, raw_j in zip(items, jobs[:num_results]):
            it["url"] = it.get("application_url", "")
        items = deduplicate(items)
        items = rank_results(items, weights=VERTICAL_WEIGHTS["jobs"])
        evidence = [
            Evidence(
                source_url=r.get("application_url", ""),
                source_title=f"{r.get('title', '')} @ {r.get('company', '')}",
                source_type="job",
                extracted_claim=f"{r.get('title', '')} at {r.get('company', '')}, {r.get('location', '')}",
                confidence="medium",
                tool_used="google_jobs",
                kind="FACT",
            ).to_dict()
            for r in items
        ]
        return {
            "results": items,
            "evidence": evidence,
            "metadata": {
                "engine": "google_jobs",
                "result_count": len(items),
                "search_metadata": raw.get("search_metadata", {}),
            },
        }

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
    def from_dict(cls, data: dict[str, Any]) -> "SerpApiGoogleJobs":
        init = data.get("init_parameters", {})
        if "api_key" in init and isinstance(init["api_key"], dict):
            init["api_key"] = Secret.from_dict(init["api_key"])
        return default_from_dict(cls, data)
