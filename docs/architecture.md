# Phase 0 — Repository Reconnaissance (PRD Sec 101)

Date: 2026-10-07 · Haystack `haystack-ai==3.3.0` · SerpApi `search.json`.

## Haystack patterns observed

- Component contract: `@component` class + `run()` (+ optional `run_async()`),
  `@component.output_types(...)`, `to_dict()`/`from_dict()` via
  `default_to_dict`/`default_from_dict` for pipeline serialization.
- Secrets: `haystack.utils.Secret` (`from_env_var`, `from_token`, `resolve_value`,
  `to_dict`/`from_dict`). API keys must resolve server-side, never leak to frontend.
- Tools: `haystack.tools.ComponentTool(component, name, description,
  outputs_to_string={source, handler})`; `haystack.tools.Toolset(tools=[...])`.
- Agent: `haystack.components.agents.Agent(chat_generator, tools, system_prompt,
  max_agent_steps, ...)`; supports Toolset, parallel tool calls
  (`tool_concurrency_limit`), streaming callbacks.
- No existing SerpApi integration found in core — new integration justified.

## Integration design (PRD Sec 22)

```text
SerpApiClient (single shared HTTP/auth/retry/rate-limit/cache layer)
  -> SerpApiGoogleSearch / SerpApiGoogleJobs / SerpApiGoogleShopping
  -> ComponentTool (rich when/when-not descriptions + evidence formatter)
  -> Toolset (research / shopping / careers / universal + dynamic selector)
  -> Haystack Agent (one universal agent for MVP, specialists later)
```

## SerpApi mapping (Phase 0-3)

| Capability | engine | result key | normalized model |
|---|---|---|---|
| Google Search | `google` | `organic_results` | `SearchResult` |
| Google Jobs | `google_jobs` | `jobs_results` | `JobResult` |
| Google Shopping | `google_shopping` | `shopping_results` | `ProductResult` |

Phase 4 reserves: `google_news`, `google_scholar`, `google_patents`, forums, images.
Phase 5 reserves: maps, flights, hotels, finance, trends, events.

## Decisions

- `requests.Session` + explicit retry/backoff on 429/5xx/timeout; normalized
  exception hierarchy; request IDs; redacted logging.
- Normalization in components (not tools): dedup (URL canonicalization +
  title similarity) then ranking
  `0.40*relevance + 0.20*constraint + 0.15*freshness + 0.15*quality + 0.10*confidence`.
- Rule-based intent classifier for MVP (deterministic, testable); LLM
  classifier deferred to Phase 6.
- Budgets: max 8 plan steps, 12 SerpApi calls, 10 results/call, 45 s exec.
- Prompt-injection defense: results formatted as `[Untrusted web results]`.
