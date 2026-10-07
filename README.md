# SerpApi × Haystack — Universal Web Intelligence Agent & Integration

> **"You ask the question. The agent chooses how to research it."**

Haystack integration + reference application that turns SerpApi's 14 specialized search verticals into composable Haystack tools: shared client → 14 search components → Haystack `ComponentTool` wrappers → logical toolsets → universal agent planner & FastAPI web server.

## What's included

- **14 SerpApi Components**:
  - Web & News: `SerpApiGoogleSearch`, `SerpApiGoogleNews`
  - Commerce & Careers: `SerpApiGoogleShopping`, `SerpApiGoogleJobs`
  - Academic & IP: `SerpApiGoogleScholar`, `SerpApiGooglePatents`, `SerpApiGoogleForums`, `SerpApiGoogleImages`
  - Local, Travel & Finance: `SerpApiGoogleMaps`, `SerpApiGoogleFlights`, `SerpApiGoogleHotels`, `SerpApiGoogleFinance`, `SerpApiGoogleTrends`, `SerpApiGoogleEvents`
- **Normalized Models**: `SearchResult`, `JobResult`, `ProductResult`, `NewsResult`, `ScholarResult`, `PatentResult`, `ForumResult`, `ImageResult`, `PlaceResult`, `FlightResult`, `HotelResult`, `FinanceResult`, `TrendResult`, `EventResult`, `Evidence`.
- **Agent Router & Intent Classifier**: Deterministic rule-based + hybrid LLM intent taxonomy and multi-step planner.
- **FastAPI Web App & API Server**: REST & Streaming endpoints (`src/serpapi_haystack/server.py`).

## Layout

```text
src/serpapi_haystack/
  client/        SerpApiClient, exceptions
  models/        Normalized result dataclasses & evidence tracking
  components/    14 Haystack @component implementations
  tools/         ComponentTool factories + rich when/when-not descriptions
  toolsets/      Research, Media, Academic, Shopping, Careers, Travel, Finance, Local, Universal
  agents/        Intent classifier taxonomy, multi-step planner, Universal Agent factory
  utils/         Cache, retries, normalization, deduplication & ranking weights
  server.py      FastAPI REST & Streaming backend server
tests/           Comprehensive mocked test suite (46/46 passed, no live key required)
examples/        Phase 4, Phase 5, Phase 6 demonstration scripts
docs/            architecture.md (reconnaissance & design notes)
```

## Quickstart

```bash
pip install -e ".[dev,server]"
export SERPAPI_API_KEY=...
python -m pytest

# Run FastAPI Server
uvicorn serpapi_haystack.server:app --reload

# Run Examples
python examples/phase4_media_academic.py
python examples/phase5_travel_finance_local.py
python examples/phase6_universal_app.py
```

## Compatibility: Upstream Integration & Standalone Package

This codebase is structured for dual compatibility:
1. **Upstream PR (`haystack-core-integrations`)**: The components in `src/serpapi_haystack/` map 1-to-1 with deepset's standard integration specification and can be upstreamed directly.
2. **Standalone PyPI Package (`serpapi-haystack`)**: Installable as a standalone Python library and executable API server.
