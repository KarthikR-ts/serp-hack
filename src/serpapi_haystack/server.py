"""FastAPI Web Application & API Server (Phase 6, PRD Sec 124, 130).

Provides REST and Streaming endpoints for the Universal Web Intelligence Agent.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from serpapi_haystack.agents.intents import QueryAnalysis, classify_query
from serpapi_haystack.agents.universal import build_plan, synthesis_input
from serpapi_haystack.toolsets import TOOL_FACTORIES, toolset_for_analysis, universal_toolset

app = FastAPI(
    title="SerpApi × Haystack — Universal Web Intelligence API",
    description="API server for Universal Web Intelligence Agent composing 14 SerpApi search verticals.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IntentRequest(BaseModel):
    query: str = Field(..., description="User search or discovery query")


class SearchRequest(BaseModel):
    engine: str = Field("google_search", description="Engine name e.g. google_search, google_jobs, google_news, etc.")
    query: str = Field(..., description="Search query")
    num_results: int = Field(10, ge=1, le=10)
    location: str | None = None


class ChatRequest(BaseModel):
    query: str = Field(..., description="Natural language prompt")
    api_key: str | None = Field(None, description="SerpApi key override")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0", "service": "serpapi-haystack-universal-agent"}


@app.get("/api/tools")
def list_tools() -> list[dict[str, str]]:
    """Return all available SerpApi Haystack tool definitions."""
    tools = universal_toolset().tools
    return [{"name": tool.name, "description": tool.description} for tool in tools]


@app.post("/api/intents")
def analyze_intent(req: IntentRequest) -> dict[str, Any]:
    """Analyze query intent and generate execution plan."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    analysis = classify_query(req.query)
    plan = [
        {"id": step.id, "action": step.action, "tool": step.tool, "query": step.query}
        for step in build_plan(analysis, req.query)
    ]
    return {
        "analysis": analysis.to_dict(),
        "plan": plan,
    }


@app.post("/api/search")
def execute_search(req: SearchRequest) -> dict[str, Any]:
    """Execute direct search using a specific SerpApi Haystack tool."""
    if req.engine not in TOOL_FACTORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Engine '{req.engine}' not supported. Allowed: {list(TOOL_FACTORIES.keys())}",
        )
    factory = TOOL_FACTORIES[req.engine]
    tool = factory()
    component = tool.component
    output = component.run(query=req.query, num_results=req.num_results)
    return output


@app.post("/api/chat")
def chat_agent(req: ChatRequest) -> dict[str, Any]:
    """Universal Agent execution endpoint."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    analysis = classify_query(req.query)
    plan = build_plan(analysis, req.query)

    toolset = toolset_for_analysis(analysis)
    tool_outputs: list[dict[str, Any]] = []

    for tool in toolset.tools:
        comp = tool.component
        try:
            res = comp.run(query=req.query)
            tool_outputs.append(res)
        except Exception as e:
            tool_outputs.append({"results": [], "evidence": [], "error": str(e)})

    synth = synthesis_input(req.query, analysis, tool_outputs)

    return {
        "query": req.query,
        "analysis": analysis.to_dict(),
        "plan": [{"id": s.id, "action": s.action, "tool": s.tool, "query": s.query} for s in plan],
        "tools_executed": [t.name for t in toolset.tools],
        "results_count": len(synth["results"]),
        "evidence_count": len(synth["evidence"]),
        "evidence": synth["evidence"],
        "results": synth["results"],
    }
