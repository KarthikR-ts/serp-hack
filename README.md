# SerpApi × Haystack — Universal Web Intelligence Agent

> **"You ask the question. The agent chooses how to research it."**

Haystack integration + reference wiring that turns SerpApi's specialized
search verticals into composable Haystack tools: shared client →
Search/Jobs/Shopping components → Haystack tool integration.

## What's included

- Repository reconnaissance notes (`docs/architecture.md`)
- `SerpApiClient` (auth, retries, timeouts, rate-limit, errors, logging, cache hooks)
- `SerpApiGoogleSearch`, `SerpApiGoogleJobs`, `SerpApiGoogleShopping`
- `ComponentTool` wrappers, toolsets, dynamic selection, planner, universal-agent factory

## Layout

```text
src/serpapi_haystack/
  client/        SerpApiClient, exceptions
  models/        SearchResult, JobResult, ProductResult, Evidence
  components/    google_search.py, google_jobs.py, google_shopping.py
  tools/         ComponentTool factories + when/when-not descriptions
  toolsets/      research / shopping / careers / universal + selector
  agents/        intents (taxonomy + classifier), universal (planner + Agent factory)
  utils/         cache (TTL per PRD Sec 77), retry, normalization (dedup+ranking),
                 limits (budgets + parallel), observability
tests/           client, models/utils, components/tools (mocked, no live key)
examples/        basic_search, research_agent, shopping_agent, career_agent, universal_agent
docs/            architecture.md (reconnaissance + design notes)
```

## Quickstart

```bash
pip install -e ".[dev]"
export SERPAPI_API_KEY=...
pytest
python examples/universal_agent.py "Find software engineering internships in Bengaluru"
```

## Design notes (PRD compliance)

- One shared `SerpApiClient`; components never duplicate HTTP/auth (Sec 22).
- Normalized models `SearchResult/JobResult/ProductResult` + `Evidence`
  with `FACT/INFERENCE/RECOMMENDATION/UNCERTAINTY` (Sec 73-74).
- Ranking `0.40/0.20/0.15/0.15/0.10`, dedup via URL canonicalization +
  title similarity (Sec 75-76). Budgets 8/12/10/45s (Sec 78).
- Tools read-only; results framed as untrusted data (Sec 83-84).
- Secrets server-side only; redacted logs; no key in frontend (Sec 81-82).
