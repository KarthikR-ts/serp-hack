# SerpApi × Haystack — Universal Web Intelligence Agent & Integration

> **"You ask the question. The agent chooses how to research it."**

Haystack integration + reference application that turns SerpApi's 15 specialized search verticals into composable Haystack tools: shared client → 15 search components → Haystack `ComponentTool` wrappers → logical toolsets → universal agent planner & FastAPI web server.

Two ways to ask: regex-routed **Research** flow, or the autonomous **Agent (LLM)** flow that classifies with an LLM, calls the exact SerpApi endpoints, and returns ranked picks.

## What's included

- **15 SerpApi Components**:
  - Web & News: `SerpApiGoogleSearch`, `SerpApiGoogleNews`
  - Commerce & Careers: `SerpApiGoogleShopping`, `SerpApiGoogleJobs`
  - Academic & IP: `SerpApiGoogleScholar`, `SerpApiGooglePatents`, `SerpApiGoogleForums`, `SerpApiGoogleImages`
  - Local, Travel & Finance: `SerpApiGoogleMaps`, `SerpApiGoogleFlights`, `SerpApiGoogleHotels`, `SerpApiGoogleFinance`, `SerpApiGoogleTrends`, `SerpApiGoogleEvents`
  - Video: `SerpApiYouTube` (`engine=youtube`, `search_query` param per SerpApi docs)
- **Normalized Models**: `SearchResult`, `JobResult`, `ProductResult`, `NewsResult`, `ScholarResult`, `PatentResult`, `ForumResult`, `ImageResult`, `PlaceResult`, `FlightResult`, `HotelResult`, `FinanceResult`, `TrendResult`, `EventResult`, `VideoResult`, `Evidence`.
- **Agent Router & Intent Classifier**: Deterministic rule-based intent taxonomy and multi-step planner, plus an LLM router (OpenRouter) that classifies → calls exact endpoints → ranks best picks.
- **FastAPI Web App & API Server**: REST & Streaming endpoints (`src/serpapi_haystack/server.py`), including `POST /api/agent` for the autonomous flow.

## Layout

```text
src/serpapi_haystack/
  client/        SerpApiClient, exceptions
  models/        Normalized result dataclasses & evidence tracking
  components/    15 Haystack @component implementations
  tools/         ComponentTool factories + rich when/when-not descriptions
  toolsets/      Research, Media, Academic, Shopping, Careers, Travel, Finance, Local, Universal
  agents/        Intent classifier taxonomy, multi-step planner, LLM router, Universal Agent factory
  utils/         Cache, retries, normalization, deduplication & ranking weights
  server.py      FastAPI REST & Streaming backend server
tests/           Comprehensive mocked test suite (no live key required)
examples/        Demonstration scripts
docs/            architecture.md (reconnaissance & design notes)
```

## Quickstart

```bash
pip install -e ".[dev,server]"
export SERPAPI_API_KEY=...
export OPENROUTER_API_KEY=...   # required only for the Agent (LLM) flow
python -m pytest

# Run FastAPI Server
uvicorn serpapi_haystack.server:app --reload

# Run Next.js frontend (new premium UI, port 3000, proxies to :8000)
cd apps/web && npm install && npm run dev

# Run Examples
python examples/phase4_media_academic.py
python examples/phase5_travel_finance_local.py
python examples/phase6_universal_app.py
```

Open http://localhost:3000 — **Research** uses the instant regex router, **Agent (LLM)** runs classify → exact endpoints → ranked picks (shopping top-2 with clickable images, YouTube learning paths, finance snapshots, deep-dive reports, travel choices ready to book — booking itself is out of scope). The legacy static UI is still served by FastAPI at http://127.0.0.1:8000 for reference.

## Compatibility: Upstream Integration & Standalone Package

This codebase is structured for dual compatibility:
1. **Upstream PR (`haystack-core-integrations`)**: The components in `src/serpapi_haystack/` map 1-to-1 with deepset's standard integration specification and can be upstreamed directly.
2. **Standalone PyPI Package (`serpapi-haystack`)**: Installable as a standalone Python library and executable API server.
